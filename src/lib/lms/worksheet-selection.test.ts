import { describe, expect, it } from 'vitest';

import type { ChallengeBand } from './learning-evidence';
import {
    buildPresetBandPlan,
    mergeProblemHistory,
    selectWorksheetProblems,
    type CandidateProblem,
    type ProblemHistoryRecord,
    type WorksheetSelectionInput,
} from './worksheet-selection';

function candidates(
    count: number,
    band: ChallengeBand,
    prefix = `band${band}`,
): CandidateProblem[] {
    return Array.from({ length: count }, (_, index) => ({
        problemId: `${prefix}-p${index + 1}`,
        challengeBand: band,
    }));
}

function selection(overrides: Partial<WorksheetSelectionInput> = {}) {
    return selectWorksheetProblems({
        purpose: 'verification',
        targetChallengeBand: 2,
        itemCount: 2,
        candidates: [...candidates(5, 2), ...candidates(5, 1)],
        history: [],
        asOf: '2026-07-20',
        seed: 'seed-1',
        ...overrides,
    });
}

describe('mergeProblemHistory', () => {
    it('keeps the most recent sighting per problem and defaults the group', () => {
        const merged = mergeProblemHistory([
            { problemId: 'p1', lastSeenOn: '2026-06-01' },
            { problemId: 'p1', lastSeenOn: '2026-07-01', similarityGroupId: 'g1' },
            { problemId: 'p1', lastSeenOn: '2026-05-01' },
            { problemId: 'p2', lastSeenOn: '2026-06-15' },
        ]);

        expect(merged.get('p1')).toEqual({
            problemId: 'p1',
            similarityGroupId: 'g1',
            lastSeenOn: '2026-07-01',
        });
        expect(merged.get('p2')?.similarityGroupId).toBe('p2');
    });

    it('rejects malformed dates', () => {
        expect(() => mergeProblemHistory([{ problemId: 'p1', lastSeenOn: 'yesterday' }])).toThrow();
    });
});

describe('selectWorksheetProblems', () => {
    it('is reproducible for the same seed and changes with the seed', () => {
        const first = selection({ seed: 'fixed' });
        const second = selection({ seed: 'fixed' });
        expect(first.selected).toEqual(second.selected);

        const seeds = ['a', 'b', 'c', 'd', 'e'];
        const outcomes = new Set(
            seeds.map((seed) =>
                selection({ seed }).selected.map((problem) => problem.problemId).join(','),
            ),
        );
        expect(outcomes.size).toBeGreaterThan(1);
    });

    it('splits counts as ceil(2/3) at the target band and the rest one band easier', () => {
        const result = selection({ itemCount: 6, purpose: 'practice' });
        const bands = result.selected.map((problem) => problem.challengeBand);
        expect(bands.filter((band) => band === 2)).toHaveLength(4);
        expect(bands.filter((band) => band === 1)).toHaveLength(2);
        expect(result.warnings).toHaveLength(0);
    });

    it('uses one band harder as the secondary band at the lowest target', () => {
        const result = selection({
            purpose: 'practice',
            targetChallengeBand: 1,
            itemCount: 3,
            candidates: [...candidates(5, 1), ...candidates(5, 2)],
        });
        const bands = result.selected.map((problem) => problem.challengeBand);
        expect(bands.filter((band) => band === 1)).toHaveLength(2);
        expect(bands.filter((band) => band === 2)).toHaveLength(1);
    });

    it('permanently excludes every problem or clone group the student ever saw for verification', () => {
        const history: ProblemHistoryRecord[] = [
            { problemId: 'band2-p1', lastSeenOn: '2025-01-01' },
            { problemId: 'other', similarityGroupId: 'shared-group', lastSeenOn: '2025-01-01' },
        ];
        const result = selectWorksheetProblems({
            purpose: 'verification',
            targetChallengeBand: 2,
            itemCount: 2,
            candidates: [
                { problemId: 'band2-p1', challengeBand: 2 },
                { problemId: 'band2-p2', challengeBand: 2, similarityGroupId: 'shared-group' },
                { problemId: 'band2-p3', challengeBand: 2 },
                { problemId: 'band2-p4', challengeBand: 2 },
            ],
            history,
            asOf: '2026-07-20',
            seed: 'seed',
        });

        const ids = result.selected.map((problem) => problem.problemId).sort();
        expect(ids).toEqual(['band2-p3', 'band2-p4']);
        expect(result.verificationBlocked).toBe(false);
    });

    it('blocks verification instead of degrading when unseen problems run out', () => {
        const result = selection({
            candidates: candidates(3, 2),
            history: [
                { problemId: 'band2-p1', lastSeenOn: '2020-01-01' },
                { problemId: 'band2-p2', lastSeenOn: '2020-01-01' },
            ],
        });
        expect(result.verificationBlocked).toBe(true);
        expect(result.selected).toHaveLength(0);
    });

    it('blocks verification when unseen candidates collapse into one clone group', () => {
        const result = selection({
            candidates: [
                { problemId: 'a', challengeBand: 2, similarityGroupId: 'g' },
                { problemId: 'b', challengeBand: 2, similarityGroupId: 'g' },
                { problemId: 'c', challengeBand: 2, similarityGroupId: 'g' },
            ],
        });
        expect(result.verificationBlocked).toBe(true);
        expect(result.selected).toHaveLength(0);
    });

    it('excludes recently seen problems for practice and re-admits oldest first with a warning', () => {
        const result = selectWorksheetProblems({
            purpose: 'practice',
            targetChallengeBand: 2,
            itemCount: 3,
            candidates: candidates(4, 2),
            history: [
                { problemId: 'band2-p1', lastSeenOn: '2026-07-15' },
                { problemId: 'band2-p2', lastSeenOn: '2026-07-01' },
                { problemId: 'band2-p3', lastSeenOn: '2026-07-10' },
            ],
            asOf: '2026-07-20',
            seed: 'seed',
        });

        expect(result.selected.map((problem) => problem.problemId)).toEqual([
            'band2-p4',
            'band2-p2',
            'band2-p3',
        ]);
        expect(result.warnings.map((warning) => warning.code)).toContain('reused_recent_problems');
    });

    it('treats problems outside the exclusion window as fresh for practice', () => {
        const result = selectWorksheetProblems({
            purpose: 'practice',
            targetChallengeBand: 2,
            itemCount: 2,
            candidates: candidates(2, 2),
            history: [
                { problemId: 'band2-p1', lastSeenOn: '2026-06-19' },
                { problemId: 'band2-p2', lastSeenOn: '2026-06-21' },
            ],
            asOf: '2026-07-20',
            seed: 'seed',
        });

        expect(result.selected).toHaveLength(2);
        const codes = result.warnings.map((warning) => warning.code);
        expect(codes).toContain('reused_recent_problems');
        expect(codes).not.toContain('count_shortage');
    });

    it('fills band shortages from the nearest band with a warning', () => {
        const result = selectWorksheetProblems({
            purpose: 'practice',
            targetChallengeBand: 3,
            itemCount: 3,
            candidates: [...candidates(1, 3), ...candidates(1, 2), ...candidates(3, 4)],
            history: [],
            asOf: '2026-07-20',
            seed: 'seed',
        });

        expect(result.selected).toHaveLength(3);
        expect(result.warnings.map((warning) => warning.code)).toContain('band_shortage');
    });

    it('reports a count shortage when the whole pool is smaller than the request', () => {
        const result = selectWorksheetProblems({
            purpose: 'review',
            targetChallengeBand: 2,
            itemCount: 4,
            candidates: candidates(2, 2),
            history: [],
            asOf: '2026-07-20',
            seed: 'seed',
        });

        expect(result.selected).toHaveLength(2);
        expect(result.warnings.map((warning) => warning.code)).toContain('count_shortage');
    });

    it('never selects problems already placed in the same worksheet', () => {
        const result = selection({
            purpose: 'practice',
            itemCount: 3,
            candidates: candidates(4, 2),
            excludedProblemIds: ['band2-p1', 'band2-p2'],
        });

        const ids = result.selected.map((problem) => problem.problemId);
        expect(ids).not.toContain('band2-p1');
        expect(ids).not.toContain('band2-p2');
    });

    it('validates inputs', () => {
        expect(() => selection({ itemCount: 0 })).toThrow();
        expect(() => selection({ seed: '  ' })).toThrow();
        expect(() => selection({ asOf: 'not-a-date' })).toThrow();
    });

    it('honors an explicit band plan exactly when the pool allows', () => {
        const result = selection({
            purpose: 'practice',
            bandPlan: { 1: 1, 2: 2, 3: 1 },
            candidates: [...candidates(4, 1), ...candidates(4, 2), ...candidates(4, 3)],
        });
        const counts = result.selected.reduce<Record<number, number>>((acc, problem) => {
            acc[problem.challengeBand] = (acc[problem.challengeBand] ?? 0) + 1;
            return acc;
        }, {});
        expect(counts).toEqual({ 1: 1, 2: 2, 3: 1 });
        expect(result.warnings).toHaveLength(0);
    });

    it('fills band-plan shortages from nearby bands with a warning', () => {
        const result = selection({
            purpose: 'practice',
            bandPlan: { 3: 3 },
            targetChallengeBand: 3,
            candidates: [...candidates(1, 3), ...candidates(5, 2)],
        });
        expect(result.selected).toHaveLength(3);
        expect(result.warnings.map((warning) => warning.code)).toContain('band_shortage');
    });

    it('blocks verification when unseen problems cannot cover the plan total', () => {
        const result = selection({
            purpose: 'verification',
            bandPlan: { 2: 3 },
            candidates: candidates(2, 2),
        });
        expect(result.verificationBlocked).toBe(true);
    });

    it('reports per-band availability of the selectable pool', () => {
        const result = selection({
            purpose: 'practice',
            itemCount: 2,
            candidates: [...candidates(3, 1), ...candidates(2, 2)],
            history: [{ problemId: 'band1-p1', lastSeenOn: '2026-07-15' }],
        });
        expect(result.bandAvailability).toEqual({ 1: 2, 2: 2, 3: 0, 4: 0 });
    });

    it('rejects invalid band plans', () => {
        expect(() => selection({ bandPlan: {} })).toThrow();
        expect(() => selection({ bandPlan: { 2: -1 } })).toThrow();
        expect(() => selection({ bandPlan: { 2: 1.5 } })).toThrow();
    });
});

describe('buildPresetBandPlan', () => {
    it('matches the default split for the recommended preset', () => {
        expect(buildPresetBandPlan('recommended', 2, 3)).toEqual({ 2: 2, 1: 1 });
        expect(buildPresetBandPlan('recommended', 1, 3)).toEqual({ 1: 2, 2: 1 });
    });

    it('shifts the center of gravity down for easier', () => {
        expect(buildPresetBandPlan('easier', 3, 3)).toEqual({ 2: 2, 1: 1 });
        expect(buildPresetBandPlan('easier', 1, 4)).toEqual({ 1: 4 });
    });

    it('adds a harder tail capped at the auto band limit', () => {
        expect(buildPresetBandPlan('harder', 2, 3)).toEqual({ 2: 2, 3: 1 });
        // 목표가 이미 자동 상한이면 전부 목표 난이도로
        expect(buildPresetBandPlan('harder', 3, 3)).toEqual({ 3: 3 });
    });

    it('rejects invalid counts', () => {
        expect(() => buildPresetBandPlan('recommended', 2, 0)).toThrow();
    });
});
