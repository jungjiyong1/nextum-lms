import { describe, expect, it } from 'vitest';

import {
    buildSkillEvidenceSummaries,
    computeWorksheetCart,
    normalizeEvidenceKind,
    type ApprovedTagRow,
    type EvidenceBaseRow,
} from './worksheet-cart-domain';
import type { SkillEvidenceSummary } from './worksheet-eligibility';

function evidenceRow(overrides: Partial<EvidenceBaseRow> = {}): EvidenceBaseRow {
    return {
        sessionId: 'session-1',
        problemId: 'p1',
        subLabel: null,
        correct: true,
        unsure: false,
        responseState: 'answered',
        evidenceKind: 'independent_new',
        analysisEligible: true,
        observedOn: '2026-07-01',
        skillId: 'skill-1',
        challengeBand: 2,
        equivalenceKey: null,
        ...overrides,
    };
}

function tag(problemId: string, band: 1 | 2 | 3 | 4, skillId = 'skill-1'): ApprovedTagRow {
    return { problemId, skillId, challengeBand: band, equivalenceKey: null };
}

const SKILL_NAMES = new Map([['skill-1', '일차함수'], ['skill-2', '연립방정식']]);

describe('normalizeEvidenceKind', () => {
    it('keeps known kinds and folds legacy kinds into guided', () => {
        expect(normalizeEvidenceKind('independent_new')).toBe('independent_new');
        expect(normalizeEvidenceKind('correction')).toBe('correction');
        expect(normalizeEvidenceKind('legacy_qualified')).toBe('guided');
        expect(normalizeEvidenceKind('legacy_ambiguous')).toBe('guided');
    });
});

describe('buildSkillEvidenceSummaries', () => {
    it('derives correction dates, bands, and readiness per skill', () => {
        const rows: EvidenceBaseRow[] = [
            evidenceRow({ sessionId: 's1', problemId: 'p1', observedOn: '2026-06-01' }),
            evidenceRow({
                sessionId: 's2',
                problemId: 'p2',
                observedOn: '2026-06-02',
                challengeBand: 3,
            }),
            evidenceRow({
                sessionId: 's3',
                problemId: 'p3',
                observedOn: '2026-07-10',
                evidenceKind: 'correction',
                analysisEligible: false,
                correct: false,
            }),
        ];

        const summaries = buildSkillEvidenceSummaries({
            rows,
            skillNames: SKILL_NAMES,
            approvedTags: [tag('p1', 3), tag('p2', 3), tag('p9', 3)],
            expectedParts: new Map(),
            asOf: '2026-07-20',
        });

        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toMatchObject({
            analysisSkillId: 'skill-1',
            skillName: '일차함수',
            highestIndependentSuccessBand: 3,
            lastCorrectionOn: '2026-07-10',
            lastPracticedBand: 2,
        });
    });

    it('marks skills without usable bands as unassessed', () => {
        const summaries = buildSkillEvidenceSummaries({
            rows: [evidenceRow({ challengeBand: null })],
            skillNames: SKILL_NAMES,
            approvedTags: [],
            expectedParts: new Map(),
            asOf: '2026-07-20',
        });
        expect(summaries[0]).toMatchObject({
            status: 'unassessed',
            highestIndependentSuccessBand: null,
        });
    });

    it('degrades a skill with corrupt data instead of failing the cart', () => {
        const rows: EvidenceBaseRow[] = [
            evidenceRow(),
            // 같은 관찰(session+problem)에 같은 partKey 중복 → 집계 오류 유발
            evidenceRow({ correct: false }),
            evidenceRow({ sessionId: 'ok', problemId: 'p2', skillId: 'skill-2' }),
        ];
        const summaries = buildSkillEvidenceSummaries({
            rows,
            skillNames: SKILL_NAMES,
            approvedTags: [],
            expectedParts: new Map(),
            asOf: '2026-07-20',
        });

        const bad = summaries.find((summary) => summary.analysisSkillId === 'skill-1');
        const good = summaries.find((summary) => summary.analysisSkillId === 'skill-2');
        expect(bad?.status).toBe('unassessed');
        expect(good?.status).not.toBe('unassessed');
    });
});

describe('computeWorksheetCart', () => {
    const verificationSummary: SkillEvidenceSummary = {
        analysisSkillId: 'skill-1',
        skillName: '일차함수',
        status: 'verification_needed',
        contentStatus: 'sufficient',
        lastConfirmedOn: null,
        lastCorrectionOn: null,
        highestIndependentSuccessBand: 2,
        lastPracticedBand: null,
    };

    it('selects problems with deterministic alternates from the same seed', () => {
        const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => tag(id, 2));
        const first = computeWorksheetCart({
            summaries: [verificationSummary],
            approvedTags: tags,
            history: [],
            asOf: '2026-07-20',
            seed: 'seed-x',
        });
        const second = computeWorksheetCart({
            summaries: [verificationSummary],
            approvedTags: tags,
            history: [],
            asOf: '2026-07-20',
            seed: 'seed-x',
        });

        expect(first.items[0].selected).toEqual(second.items[0].selected);
        expect(first.items[0].alternates).toEqual(second.items[0].alternates);
        expect(first.items[0].selected).toHaveLength(2);
        expect(first.items[0].alternates.length).toBeGreaterThan(0);

        const selectedIds = first.items[0].selected.map((problem) => problem.problemId);
        for (const alternate of first.items[0].alternates) {
            expect(selectedIds).not.toContain(alternate.problemId);
        }
    });

    it('never shares problems or alternates across cart items', () => {
        const summaries: SkillEvidenceSummary[] = [
            verificationSummary,
            { ...verificationSummary, analysisSkillId: 'skill-2', skillName: '연립방정식' },
        ];
        // 두 유형이 같은 문제 풀을 공유하는 최악의 경우
        const sharedTags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].flatMap((id) => [
            tag(id, 2, 'skill-1'),
            tag(id, 2, 'skill-2'),
        ]);
        const result = computeWorksheetCart({
            summaries,
            approvedTags: sharedTags,
            history: [],
            asOf: '2026-07-20',
            seed: 'seed-y',
        });

        const allIds = result.items.flatMap((item) => [
            ...item.selected.map((problem) => problem.problemId),
            ...item.alternates.map((problem) => problem.problemId),
        ]);
        expect(new Set(allIds).size).toBe(allIds.length);
    });

    it('propagates verification blocking when unseen problems run out', () => {
        const result = computeWorksheetCart({
            summaries: [verificationSummary],
            approvedTags: [tag('a', 2), tag('b', 2)],
            history: [{ problemId: 'a', lastSeenOn: '2026-01-01' }],
            asOf: '2026-07-20',
            seed: 'seed-z',
        });

        expect(result.items[0].verificationBlocked).toBe(true);
        expect(result.items[0].selected).toHaveLength(0);
    });

    it('applies band-plan overrides and reports availability', () => {
        const tags = [
            ...['a1', 'a2', 'a3'].map((id) => tag(id, 1)),
            ...['b1', 'b2', 'b3'].map((id) => tag(id, 2)),
            ...['c1', 'c2'].map((id) => tag(id, 3)),
        ];
        const result = computeWorksheetCart({
            summaries: [verificationSummary],
            approvedTags: tags,
            history: [],
            asOf: '2026-07-20',
            seed: 'seed-o',
            bandPlanOverrides: new Map([['skill-1:verification', { 1: 1, 3: 2 }]]),
        });

        const bands = result.items[0].selected.map((problem) => problem.challengeBand).sort();
        expect(bands).toEqual([1, 3, 3]);
        expect(result.items[0].bandAvailability).toEqual({ 1: 3, 2: 3, 3: 2, 4: 0 });
        // 교체 후보도 같은 구성 규칙으로 뽑되 이미 뽑힌 문제는 제외된다
        const alternateIds = result.items[0].alternates.map((problem) => problem.problemId);
        for (const problem of result.items[0].selected) {
            expect(alternateIds).not.toContain(problem.problemId);
        }
    });

    it('passes excluded skills through', () => {
        const result = computeWorksheetCart({
            summaries: [{
                ...verificationSummary,
                analysisSkillId: 'skill-3',
                status: 'unassessed',
                highestIndependentSuccessBand: null,
            }],
            approvedTags: [],
            history: [],
            asOf: '2026-07-20',
            seed: 'seed',
        });
        expect(result.items).toHaveLength(0);
        expect(result.excluded[0]).toMatchObject({
            analysisSkillId: 'skill-3',
            reason: 'insufficient_data',
        });
    });
});
