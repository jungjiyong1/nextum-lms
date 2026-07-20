import { describe, expect, it } from 'vitest';

import {
    getEligibleWorksheetItems,
    resolveInclusionRole,
    type SkillEvidenceSummary,
} from './worksheet-eligibility';

function skill(overrides: Partial<SkillEvidenceSummary> = {}): SkillEvidenceSummary {
    return {
        analysisSkillId: 'skill-1',
        skillName: '일차함수 그래프 해석',
        status: 'verification_needed',
        contentStatus: 'sufficient',
        lastConfirmedOn: null,
        lastCorrectionOn: null,
        highestIndependentSuccessBand: 2,
        lastPracticedBand: null,
        ...overrides,
    };
}

describe('getEligibleWorksheetItems', () => {
    it('rejects invalid asOf dates', () => {
        expect(() => getEligibleWorksheetItems({ skills: [], asOf: '2026-13-01' })).toThrow();
        expect(() => getEligibleWorksheetItems({ skills: [], asOf: 'today' })).toThrow();
    });

    it('proposes verification immediately when no correction gate exists', () => {
        const result = getEligibleWorksheetItems({ skills: [skill()], asOf: '2026-07-20' });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            purpose: 'verification',
            state: 'eligible',
            eligibleAfter: null,
            suggestedChallengeBand: 2,
            suggestedItemCount: 2,
        });
        expect(result.excluded).toHaveLength(0);
    });

    it('locks verification until the minimum days after correction pass', () => {
        const locked = getEligibleWorksheetItems({
            skills: [skill({ lastCorrectionOn: '2026-07-19' })],
            asOf: '2026-07-20',
        });
        expect(locked.items[0]).toMatchObject({
            state: 'locked',
            eligibleAfter: '2026-07-21',
            daysUntilEligible: 1,
        });

        const eligible = getEligibleWorksheetItems({
            skills: [skill({ lastCorrectionOn: '2026-07-18' })],
            asOf: '2026-07-20',
        });
        expect(eligible.items[0]).toMatchObject({
            state: 'eligible',
            eligibleAfter: '2026-07-20',
            daysSinceEligible: 0,
        });
    });

    it('marks verification delayed after the delay window passes', () => {
        const onBoundary = getEligibleWorksheetItems({
            skills: [skill({ lastCorrectionOn: '2026-05-19' })],
            asOf: '2026-06-20',
        });
        expect(onBoundary.items[0].state).toBe('eligible');
        expect(onBoundary.items[0].daysSinceEligible).toBe(30);

        const delayed = getEligibleWorksheetItems({
            skills: [skill({ lastCorrectionOn: '2026-05-18' })],
            asOf: '2026-06-20',
        });
        expect(delayed.items[0].state).toBe('delayed');
        expect(delayed.items[0].daysSinceEligible).toBe(31);
    });

    it('gates review on the confirmed-to-review interval', () => {
        const base = skill({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-07-07',
            highestIndependentSuccessBand: 3,
        });

        const locked = getEligibleWorksheetItems({ skills: [base], asOf: '2026-07-20' });
        expect(locked.items[0]).toMatchObject({
            purpose: 'review',
            state: 'locked',
            eligibleAfter: '2026-07-21',
        });

        const eligible = getEligibleWorksheetItems({ skills: [base], asOf: '2026-07-21' });
        expect(eligible.items[0]).toMatchObject({
            purpose: 'review',
            state: 'eligible',
            suggestedChallengeBand: 3,
            suggestedItemCount: 2,
        });
    });

    it('emits practice plus gated verification for support candidates', () => {
        const result = getEligibleWorksheetItems({
            skills: [
                skill({
                    status: 'support_candidate',
                    lastCorrectionOn: '2026-07-19',
                    highestIndependentSuccessBand: 3,
                }),
            ],
            asOf: '2026-07-20',
        });

        const purposes = result.items.map((item) => `${item.purpose}:${item.state}`);
        expect(purposes).toEqual(['practice:eligible', 'verification:locked']);
        const practice = result.items.find((item) => item.purpose === 'practice');
        expect(practice).toMatchObject({ suggestedChallengeBand: 2, suggestedItemCount: 3 });
    });

    it('keeps practice at band 1 when the target is already the lowest band', () => {
        const result = getEligibleWorksheetItems({
            skills: [skill({ status: 'support_candidate', highestIndependentSuccessBand: 1 })],
            asOf: '2026-07-20',
        });
        const practice = result.items.find((item) => item.purpose === 'practice');
        expect(practice?.suggestedChallengeBand).toBe(1);
    });

    it('caps auto recommendation at the maximum auto band', () => {
        const result = getEligibleWorksheetItems({
            skills: [skill({ highestIndependentSuccessBand: 4 })],
            asOf: '2026-07-20',
        });
        expect(result.items[0].suggestedChallengeBand).toBe(3);
    });

    it('falls back to the last practiced band when no independent success exists', () => {
        const result = getEligibleWorksheetItems({
            skills: [skill({ highestIndependentSuccessBand: null, lastPracticedBand: 2 })],
            asOf: '2026-07-20',
        });
        expect(result.items[0].suggestedChallengeBand).toBe(2);
    });

    it('excludes content gaps and skills without any evidence basis', () => {
        const result = getEligibleWorksheetItems({
            skills: [
                skill({ analysisSkillId: 'gap', contentStatus: 'content_gap' }),
                skill({ analysisSkillId: 'cold', status: 'unassessed' }),
                skill({
                    analysisSkillId: 'no-band',
                    highestIndependentSuccessBand: null,
                    lastPracticedBand: null,
                }),
            ],
            asOf: '2026-07-20',
        });

        expect(result.items).toHaveLength(0);
        expect(result.excluded.map((entry) => `${entry.analysisSkillId}:${entry.reason}`)).toEqual([
            'gap:content_gap',
            'cold:insufficient_data',
            'no-band:insufficient_data',
        ]);
    });

    it('orders items by urgency then purpose', () => {
        const result = getEligibleWorksheetItems({
            skills: [
                skill({
                    analysisSkillId: 'delayed-review',
                    status: 'recent_confirmed',
                    lastConfirmedOn: '2026-01-01',
                }),
                skill({ analysisSkillId: 'fresh-verification' }),
                skill({
                    analysisSkillId: 'locked-review',
                    status: 'recent_confirmed',
                    lastConfirmedOn: '2026-07-19',
                }),
            ],
            asOf: '2026-07-20',
        });

        expect(result.items.map((item) => item.analysisSkillId)).toEqual([
            'delayed-review',
            'fresh-verification',
            'locked-review',
        ]);
    });
});

describe('resolveInclusionRole', () => {
    it('keeps eligible and delayed verification as verification evidence', () => {
        expect(resolveInclusionRole('verification', 'eligible')).toEqual({
            role: 'verification',
            evidenceEligible: true,
        });
        expect(resolveInclusionRole('verification', 'delayed')).toEqual({
            role: 'verification',
            evidenceEligible: true,
        });
    });

    it('downgrades force-included locked verification to practice', () => {
        expect(resolveInclusionRole('verification', 'locked')).toEqual({
            role: 'practice',
            evidenceEligible: false,
        });
    });

    it('maps practice and review to their evidence semantics', () => {
        expect(resolveInclusionRole('practice', 'eligible')).toEqual({
            role: 'practice',
            evidenceEligible: false,
        });
        expect(resolveInclusionRole('review', 'eligible')).toEqual({
            role: 'review',
            evidenceEligible: true,
        });
    });
});
