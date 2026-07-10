import { describe, expect, it } from 'vitest';

import {
    aggregateProblemEvidence,
    evaluateLearningEvidence,
    type ChallengeBand,
    type LearningEvidenceAttempt,
    type LearningEvidenceKind,
} from './learning-evidence';

const DEFAULT_CONTENT = { approvedDistinctEquivalenceCount: 2 };

function attempt(
    overrides: Partial<LearningEvidenceAttempt> = {},
): LearningEvidenceAttempt {
    return {
        observationId: 'observation-1',
        problemId: 'problem-1',
        equivalenceKey: 'equivalence-1',
        observedOn: '2026-06-01',
        challengeBand: 2,
        evidenceKind: 'independent_new',
        analysisEligible: true,
        expectedPartCount: 1,
        partKey: 'root',
        responseState: 'answered',
        correct: true,
        unsure: false,
        ...overrides,
    };
}

function correctObservation(
    observationId: string,
    observedOn: string,
    equivalenceKey: string,
    overrides: Partial<LearningEvidenceAttempt> = {},
): LearningEvidenceAttempt {
    return attempt({
        observationId,
        problemId: `problem-${observationId}`,
        equivalenceKey,
        observedOn,
        ...overrides,
    });
}

function evaluate(
    attempts: readonly LearningEvidenceAttempt[],
    overrides: {
        asOf?: string;
        targetChallengeBand?: ChallengeBand;
        approvedDistinctEquivalenceCount?: number;
        verificationIntervalDays?: number;
    } = {},
) {
    return evaluateLearningEvidence({
        attempts,
        targetChallengeBand: overrides.targetChallengeBand ?? 2,
        asOf: overrides.asOf ?? '2026-07-01',
        verificationIntervalDays: overrides.verificationIntervalDays,
        content: {
            ...DEFAULT_CONTENT,
            approvedDistinctEquivalenceCount:
                overrides.approvedDistinctEquivalenceCount ??
                DEFAULT_CONTENT.approvedDistinctEquivalenceCount,
        },
    });
}

describe('aggregateProblemEvidence', () => {
    it('combines subparts into one problem observation and only fully confident correctness succeeds', () => {
        const rows = [
            attempt({
                observationId: 'partial',
                expectedPartCount: 2,
                partKey: 'a',
            }),
            attempt({
                observationId: 'partial',
                expectedPartCount: 2,
                partKey: 'b',
                correct: false,
            }),
            attempt({
                observationId: 'complete',
                problemId: 'problem-2',
                equivalenceKey: 'equivalence-2',
                expectedPartCount: 2,
                partKey: 'a',
            }),
            attempt({
                observationId: 'complete',
                problemId: 'problem-2',
                equivalenceKey: 'equivalence-2',
                expectedPartCount: 2,
                partKey: 'b',
            }),
        ];

        const observations = aggregateProblemEvidence(rows);

        expect(observations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    observationId: 'partial',
                    responseOutcome: 'failure',
                    trendScore: 0.5,
                    recordedPartCount: 2,
                }),
                expect.objectContaining({
                    observationId: 'complete',
                    responseOutcome: 'confident_full_correct',
                    trendScore: 1,
                    recordedPartCount: 2,
                }),
            ]),
        );
    });

    it('keeps a partially answered independent problem analyzable when blank subparts are excluded', () => {
        const rows = [
            attempt({
                observationId: 'mixed-eligibility',
                expectedPartCount: 2,
                partKey: 'a',
                analysisEligible: true,
            }),
            attempt({
                observationId: 'mixed-eligibility',
                expectedPartCount: 2,
                partKey: 'b',
                responseState: 'blank',
                correct: false,
                analysisEligible: false,
            }),
        ];

        expect(aggregateProblemEvidence(rows)).toEqual([
            expect.objectContaining({
                observationId: 'mixed-eligibility',
                analysisEligible: true,
                analyzedPartCount: 1,
                responseOutcome: 'uncertain_or_incomplete',
                trendScore: 1,
            }),
        ]);
        const result = evaluate(rows);
        expect(result.readiness.status).toBe('unassessed');
        expect(result.trend).toMatchObject({ averageScore: 1, observationCount: 1 });
    });

    it('does not treat a missing subpart as a full-problem confirmation', () => {
        const [observation] = aggregateProblemEvidence([
            attempt({ expectedPartCount: 2, partKey: 'a' }),
        ]);

        expect(observation).toMatchObject({
            responseOutcome: 'uncertain_or_incomplete',
            trendScore: 1,
            expectedPartCount: 2,
            recordedPartCount: 1,
        });
    });

    it('rejects duplicate subpart rows instead of double-counting them', () => {
        expect(() => aggregateProblemEvidence([attempt(), attempt()])).toThrow(
            'duplicate partKey',
        );
    });

    it('rejects mixed eligibility across non-blank subparts', () => {
        expect(() =>
            aggregateProblemEvidence([
                attempt({ expectedPartCount: 2, partKey: 'a', analysisEligible: true }),
                attempt({
                    expectedPartCount: 2,
                    partKey: 'b',
                    analysisEligible: false,
                    correct: false,
                }),
            ]),
        ).toThrow('mixes eligible and excluded non-blank parts');
    });

    it('enforces the database response-state contract at runtime', () => {
        expect(() =>
            aggregateProblemEvidence([
                attempt({ responseState: 'unknown', correct: true, unsure: false }),
            ]),
        ).toThrow('unknown attempts require correct=false and unsure=true');
        expect(() =>
            aggregateProblemEvidence([
                attempt({
                    responseState: 'blank',
                    correct: false,
                    unsure: false,
                    analysisEligible: true,
                }),
            ]),
        ).toThrow('blank attempts require');
    });
});

describe('evaluateLearningEvidence', () => {
    it('excludes blank responses from both trend and readiness', () => {
        const result = evaluate([
            attempt({
                responseState: 'blank',
                correct: false,
                unsure: false,
                analysisEligible: false,
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'unassessed',
            countedEvidenceRoundCount: 0,
        });
        expect(result.trend).toMatchObject({ averageScore: null, observationCount: 0 });
        expect(result.observations[0]).toMatchObject({
            readinessOutcome: 'not_eligible',
            readinessExclusionReason: 'blank',
        });
    });

    it('counts explicit unknown as negative independent evidence', () => {
        const firstUnknown = attempt({
            responseState: 'unknown',
            correct: false,
            unsure: true,
        });
        const secondUnknown = attempt({
            observationId: 'observation-2',
            problemId: 'problem-2',
            equivalenceKey: 'equivalence-2',
            observedOn: '2026-06-02',
            responseState: 'unknown',
            correct: false,
            unsure: true,
        });

        expect(evaluate([firstUnknown]).readiness.status).toBe('verification_needed');

        const result = evaluate([firstUnknown, secondUnknown]);
        expect(result.readiness).toMatchObject({
            status: 'support_candidate',
            countedEvidenceRoundCount: 2,
        });
        expect(result.trend.averageScore).toBe(0);
    });

    it.each<LearningEvidenceKind>([
        'correction',
        'review',
        'guided',
    ])('does not use %s evidence for confirmation or trend', (evidenceKind) => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'equivalence-1', { evidenceKind }),
            correctObservation('two', '2026-06-02', 'equivalence-2', { evidenceKind }),
        ]);

        expect(result.readiness.status).toBe('unassessed');
        expect(result.readiness.countedEvidenceRoundCount).toBe(0);
        expect(result.trend).toMatchObject({ averageScore: null, observationCount: 0 });
        expect(
            result.observations.every(
                (observation) =>
                    observation.readinessExclusionReason === 'not_independent_new',
            ),
        ).toBe(true);
    });

    it('includes delayed same-item evidence in trend but never in confirmation', () => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'equivalence-1', {
                evidenceKind: 'independent_same_delayed',
            }),
            correctObservation('two', '2026-06-02', 'equivalence-2', {
                evidenceKind: 'independent_same_delayed',
            }),
        ]);

        expect(result.readiness.status).toBe('unassessed');
        expect(result.readiness.countedEvidenceRoundCount).toBe(0);
        expect(result.trend).toMatchObject({ averageScore: 1, observationCount: 2 });
    });

    it('excludes analysis-ineligible observations from readiness and trend', () => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'equivalence-1', {
                analysisEligible: false,
            }),
            correctObservation('two', '2026-06-02', 'equivalence-2', {
                analysisEligible: false,
                evidenceKind: 'independent_same_delayed',
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'unassessed',
            countedEvidenceRoundCount: 0,
        });
        expect(result.trend).toMatchObject({ averageScore: null, observationCount: 0 });
        expect(
            result.observations.every(
                (observation) =>
                    observation.readinessExclusionReason === 'analysis_excluded',
            ),
        ).toBe(true);
    });

    it('scores correct-but-unsure as 0.5 for trend without confirming readiness', () => {
        const result = evaluate([attempt({ unsure: true })]);

        expect(result.trend).toMatchObject({ averageScore: 0.5, observationCount: 1 });
        expect(result.readiness.status).toBe('unassessed');
        expect(result.observations[0]).toMatchObject({
            responseOutcome: 'uncertain_or_incomplete',
            readinessExclusionReason: 'uncertain_or_incomplete',
        });
    });

    it('requires all subparts to be correct before the problem can count as confirmation', () => {
        const partial = [
            attempt({ expectedPartCount: 2, partKey: 'a' }),
            attempt({ expectedPartCount: 2, partKey: 'b', unsure: true }),
        ];
        const complete = [
            attempt({
                observationId: 'observation-2',
                problemId: 'problem-2',
                equivalenceKey: 'equivalence-2',
                observedOn: '2026-06-02',
                expectedPartCount: 2,
                partKey: 'a',
            }),
            attempt({
                observationId: 'observation-2',
                problemId: 'problem-2',
                equivalenceKey: 'equivalence-2',
                observedOn: '2026-06-02',
                expectedPartCount: 2,
                partKey: 'b',
            }),
        ];

        const result = evaluate([...partial, ...complete]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            countedEvidenceRoundCount: 1,
        });
        expect(result.trend.averageScore).toBe(0.875);
    });

    it('deduplicates otherwise qualifying evidence from the same date', () => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'equivalence-1'),
            correctObservation('two', '2026-06-01', 'equivalence-2'),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            countedEvidenceRoundCount: 1,
        });
    });

    it('treats a mixed success/failure date as inconclusive instead of a failure streak', () => {
        const result = evaluate([
            correctObservation('same-day-success', '2026-06-01', 'equivalence-1'),
            correctObservation('same-day-failure', '2026-06-01', 'equivalence-2', {
                correct: false,
            }),
            correctObservation('next-day-failure', '2026-06-02', 'equivalence-3', {
                correct: false,
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            decisiveObservationIds: ['next-day-failure'],
        });
    });

    it('deduplicates the same equivalence key across different dates', () => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'same-equivalence'),
            correctObservation('two', '2026-06-02', 'same-equivalence'),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            countedEvidenceRoundCount: 1,
        });
    });

    it('requires two different problem ids even if inconsistent tags supply different keys', () => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'equivalence-1', {
                problemId: 'same-problem',
            }),
            correctObservation('two', '2026-06-02', 'equivalence-2', {
                problemId: 'same-problem',
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            countedEvidenceRoundCount: 1,
        });
    });

    it('only uses observations at the exact target challenge band', () => {
        const result = evaluate([
            correctObservation('target-one', '2026-06-01', 'equivalence-1'),
            correctObservation('higher', '2026-06-02', 'equivalence-2', {
                challengeBand: 3,
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            countedEvidenceRoundCount: 1,
        });
        expect(result.observations.find((row) => row.observationId === 'higher')).toMatchObject({
            readinessExclusionReason: 'challenge_band_mismatch',
        });
        expect(result.trend).toMatchObject({ averageScore: 1, observationCount: 1 });
    });

    it('becomes recent_confirmed after two distinct new items on two dates', () => {
        const result = evaluate([
            correctObservation('one', '2026-06-01', 'equivalence-1'),
            correctObservation('two', '2026-06-02', 'equivalence-2'),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-06-02',
            decisiveObservationIds: ['one', 'two'],
            countedEvidenceRoundCount: 2,
        });
    });

    it('uses one independent failure for verification_needed and two for support_candidate', () => {
        const firstFailure = correctObservation('failure-one', '2026-06-03', 'failure-1', {
            correct: false,
        });
        const secondFailure = correctObservation('failure-two', '2026-06-04', 'failure-2', {
            correct: false,
        });

        expect(evaluate([firstFailure]).readiness.status).toBe('verification_needed');
        expect(evaluate([firstFailure, secondFailure]).readiness).toMatchObject({
            status: 'support_candidate',
            decisiveObservationIds: ['failure-one', 'failure-two'],
        });
    });

    it('uses the current consecutive evidence streak rather than permanently accumulating failures', () => {
        const result = evaluate([
            correctObservation('failure-one', '2026-06-01', 'failure-1', { correct: false }),
            correctObservation('failure-two', '2026-06-02', 'failure-2', { correct: false }),
            correctObservation('success-one', '2026-06-03', 'success-1'),
            correctObservation('success-two', '2026-06-04', 'success-2'),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-06-04',
            decisiveObservationIds: ['success-one', 'success-two'],
        });
    });

    it('can show improvement with the same finite taxonomy after an outcome changes', () => {
        const result = evaluate([
            correctObservation('failure-one', '2026-06-01', 'equivalence-1', {
                problemId: 'problem-1',
                correct: false,
            }),
            correctObservation('failure-two', '2026-06-02', 'equivalence-2', {
                problemId: 'problem-2',
                correct: false,
            }),
            correctObservation('success-one', '2026-06-10', 'equivalence-1', {
                problemId: 'problem-3',
            }),
            correctObservation('success-two', '2026-06-11', 'equivalence-2', {
                problemId: 'problem-4',
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-06-11',
            decisiveObservationIds: ['success-one', 'success-two'],
            countedEvidenceRoundCount: 4,
        });
    });

    it('does not refresh confirmation with a repeated equivalent success', () => {
        const result = evaluate(
            [
                correctObservation('success-one', '2026-06-01', 'equivalence-1', {
                    problemId: 'problem-1',
                }),
                correctObservation('success-two', '2026-06-02', 'equivalence-2', {
                    problemId: 'problem-2',
                }),
                correctObservation('repeated-success', '2026-06-20', 'equivalence-1', {
                    problemId: 'problem-3',
                }),
            ],
            { asOf: '2026-06-23' },
        );

        expect(result.readiness).toMatchObject({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-06-02',
            verificationDueOn: '2026-06-23',
            verificationDue: true,
            countedEvidenceRoundCount: 2,
        });
    });

    it('lets a later opposite outcome reset readiness even with a reused equivalence key', () => {
        const result = evaluate([
            correctObservation('success-one', '2026-06-01', 'equivalence-1', {
                problemId: 'problem-1',
            }),
            correctObservation('success-two', '2026-06-02', 'equivalence-2', {
                problemId: 'problem-2',
            }),
            correctObservation('later-failure', '2026-06-20', 'equivalence-1', {
                problemId: 'problem-3',
                correct: false,
            }),
        ]);

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            decisiveObservationIds: ['later-failure'],
            countedEvidenceRoundCount: 3,
        });
    });

    it('raises verificationDue after 21 days without downgrading recent_confirmed', () => {
        const attempts = [
            correctObservation('one', '2026-06-01', 'equivalence-1'),
            correctObservation('two', '2026-06-02', 'equivalence-2'),
        ];

        expect(evaluate(attempts, { asOf: '2026-06-22' }).readiness).toMatchObject({
            status: 'recent_confirmed',
            verificationDue: false,
            verificationDueOn: '2026-06-23',
        });
        expect(evaluate(attempts, { asOf: '2026-06-23' }).readiness).toMatchObject({
            status: 'recent_confirmed',
            verificationDue: true,
            verificationDueOn: '2026-06-23',
        });
    });

    it('requires two new distinct rounds after the due date to renew confirmation', () => {
        const initial = [
            correctObservation('initial-one', '2026-06-01', 'equivalence-1'),
            correctObservation('initial-two', '2026-06-02', 'equivalence-2'),
        ];
        const oneRenewal = correctObservation(
            'renewal-one',
            '2026-06-23',
            'equivalence-3',
        );
        const twoRenewal = correctObservation(
            'renewal-two',
            '2026-06-24',
            'equivalence-4',
        );

        expect(
            evaluate([...initial, oneRenewal], { asOf: '2026-06-23' }).readiness,
        ).toMatchObject({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-06-02',
            verificationDue: true,
        });
        expect(
            evaluate([...initial, oneRenewal, twoRenewal], {
                asOf: '2026-06-24',
            }).readiness,
        ).toMatchObject({
            status: 'recent_confirmed',
            lastConfirmedOn: '2026-06-24',
            verificationDueOn: '2026-07-15',
            verificationDue: false,
            decisiveObservationIds: ['renewal-one', 'renewal-two'],
        });
    });

    it('reports first-to-latest improvement separately from the all-time average', () => {
        const result = evaluate([
            correctObservation('first', '2026-06-01', 'equivalence-1', {
                correct: false,
            }),
            correctObservation('second', '2026-06-02', 'equivalence-2', {
                correct: false,
            }),
            correctObservation('third', '2026-06-03', 'equivalence-3'),
            correctObservation('latest', '2026-06-04', 'equivalence-4'),
        ]);

        expect(result.trend).toMatchObject({
            averageScore: 0.5,
            recentAverageScore: 2 / 3,
            firstIndependentScore: 0,
            latestIndependentScore: 1,
            direction: 'improving',
            observationCount: 4,
        });
    });

    it('reports content gaps independently from student readiness', () => {
        const result = evaluate(
            [
                correctObservation('one', '2026-06-01', 'equivalence-1'),
                correctObservation('two', '2026-06-02', 'equivalence-2'),
            ],
            { approvedDistinctEquivalenceCount: 1 },
        );

        expect(result.readiness.status).toBe('recent_confirmed');
        expect(result.content).toEqual({
            status: 'content_gap',
            approvedDistinctEquivalenceCount: 1,
            requiredDistinctEquivalenceCount: 2,
            missingDistinctEquivalenceCount: 1,
        });
    });

    it('ignores future observations relative to the evaluation date', () => {
        const result = evaluate(
            [
                correctObservation('past', '2026-06-01', 'equivalence-1'),
                correctObservation('future', '2026-06-02', 'equivalence-2'),
            ],
            { asOf: '2026-06-01' },
        );

        expect(result.readiness).toMatchObject({
            status: 'verification_needed',
            countedEvidenceRoundCount: 1,
        });
        expect(result.observations.find((row) => row.observationId === 'future')).toMatchObject({
            readinessExclusionReason: 'future_observation',
        });
    });
});
