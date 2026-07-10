export const CHALLENGE_BANDS = [1, 2, 3, 4] as const;

export type ChallengeBand = (typeof CHALLENGE_BANDS)[number];

export type LearningEvidenceKind =
    | 'independent_new'
    | 'independent_same_delayed'
    | 'correction'
    | 'review'
    | 'guided';

export type LearningResponseState = 'answered' | 'unknown' | 'blank';

export type LearningReadinessStatus =
    | 'unassessed'
    | 'verification_needed'
    | 'support_candidate'
    | 'recent_confirmed';

export type ContentCoverageStatus = 'sufficient' | 'content_gap';

export type ProblemResponseOutcome =
    | 'confident_full_correct'
    | 'failure'
    | 'uncertain_or_incomplete'
    | 'blank';

export type ReadinessExclusionReason =
    | 'future_observation'
    | 'challenge_band_mismatch'
    | 'analysis_excluded'
    | 'blank'
    | 'not_independent_new'
    | 'uncertain_or_incomplete';

export interface LearningEvidenceAttempt {
    observationId: string;
    problemId: string;
    equivalenceKey: string;
    observedOn: string;
    challengeBand: ChallengeBand;
    evidenceKind: LearningEvidenceKind;
    analysisEligible: boolean;
    expectedPartCount: number;
    partKey: string;
    responseState: LearningResponseState;
    correct: boolean | null;
    unsure: boolean;
}

export interface ProblemEvidenceObservation {
    observationId: string;
    problemId: string;
    equivalenceKey: string;
    observedOn: string;
    challengeBand: ChallengeBand;
    evidenceKind: LearningEvidenceKind;
    analysisEligible: boolean;
    expectedPartCount: number;
    recordedPartCount: number;
    analyzedPartCount: number;
    responseOutcome: ProblemResponseOutcome;
    trendScore: number | null;
}

export interface EvaluatedProblemEvidenceObservation extends ProblemEvidenceObservation {
    readinessOutcome: 'success' | 'failure' | 'not_eligible';
    readinessExclusionReason: ReadinessExclusionReason | null;
}

export interface LearningEvidenceContentInput {
    /** Number of approved, mutually distinct equivalence keys at the target challenge band. */
    approvedDistinctEquivalenceCount: number;
    requiredDistinctEquivalenceCount?: number;
}

export interface EvaluateLearningEvidenceInput {
    attempts: readonly LearningEvidenceAttempt[];
    targetChallengeBand: ChallengeBand;
    asOf: string;
    verificationIntervalDays?: number;
    content: LearningEvidenceContentInput;
}

export interface LearningEvidenceEvaluation {
    readiness: {
        status: LearningReadinessStatus;
        verificationDue: boolean;
        verificationDueOn: string | null;
        lastConfirmedOn: string | null;
        decisiveObservationIds: string[];
        countedEvidenceRoundCount: number;
    };
    trend: {
        averageScore: number | null;
        recentAverageScore: number | null;
        firstIndependentScore: number | null;
        latestIndependentScore: number | null;
        direction: 'improving' | 'stable' | 'declining' | 'insufficient';
        observationCount: number;
    };
    content: {
        status: ContentCoverageStatus;
        approvedDistinctEquivalenceCount: number;
        requiredDistinctEquivalenceCount: number;
        missingDistinctEquivalenceCount: number;
    };
    observations: EvaluatedProblemEvidenceObservation[];
}

type ObservationGroup = {
    metadata: Omit<
        LearningEvidenceAttempt,
        'partKey' | 'responseState' | 'correct' | 'unsure' | 'analysisEligible'
    >;
    parts: LearningEvidenceAttempt[];
};

type ReadinessEvent = {
    observationId: string;
    problemId: string;
    equivalenceKey: string;
    observedOn: string;
    outcome: 'success' | 'failure';
};

type ReadinessRound = {
    observedOn: string;
    outcome: 'success' | 'failure' | 'mixed';
    events: ReadinessEvent[];
};

type ReadinessEpisode = {
    outcome: 'success' | 'failure';
    rounds: ReadinessRound[];
};

type DistinctEvidencePair = readonly [ReadinessEvent, ReadinessEvent];

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_REQUIRED_DISTINCT_EQUIVALENCE_COUNT = 2;
const DEFAULT_VERIFICATION_INTERVAL_DAYS = 21;

function assertNonEmpty(value: string, fieldName: string): void {
    if (value.trim().length === 0) {
        throw new Error(`${fieldName} must not be empty`);
    }
}

function dateOnlyTimestamp(value: string, fieldName: string): number {
    if (!DATE_ONLY_PATTERN.test(value)) {
        throw new Error(`${fieldName} must use YYYY-MM-DD`);
    }

    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        throw new Error(`${fieldName} must be a valid calendar date`);
    }

    return timestamp;
}

function assertChallengeBand(value: number, fieldName: string): asserts value is ChallengeBand {
    if (!CHALLENGE_BANDS.includes(value as ChallengeBand)) {
        throw new Error(`${fieldName} must be an integer from 1 to 4`);
    }
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${fieldName} must be a non-negative integer`);
    }
}

function assertPositiveInteger(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${fieldName} must be a positive integer`);
    }
}

function assertCompatibleMetadata(group: ObservationGroup, attempt: LearningEvidenceAttempt): void {
    const metadata = group.metadata;
    const fields: Array<keyof typeof metadata> = [
        'problemId',
        'equivalenceKey',
        'observedOn',
        'challengeBand',
        'evidenceKind',
        'expectedPartCount',
    ];

    for (const field of fields) {
        if (metadata[field] !== attempt[field]) {
            throw new Error(`observation ${attempt.observationId} has inconsistent ${field}`);
        }
    }
}

function validateAttempt(attempt: LearningEvidenceAttempt): void {
    assertNonEmpty(attempt.observationId, 'observationId');
    assertNonEmpty(attempt.problemId, 'problemId');
    assertNonEmpty(attempt.equivalenceKey, 'equivalenceKey');
    assertNonEmpty(attempt.partKey, 'partKey');
    dateOnlyTimestamp(attempt.observedOn, 'observedOn');
    assertChallengeBand(attempt.challengeBand, 'challengeBand');
    assertPositiveInteger(attempt.expectedPartCount, 'expectedPartCount');

    if (attempt.responseState === 'answered') {
        if (typeof attempt.correct !== 'boolean') {
            throw new Error('answered attempts require a boolean correct value');
        }
    } else if (attempt.responseState === 'unknown') {
        if (attempt.correct !== false || attempt.unsure !== true) {
            throw new Error('unknown attempts require correct=false and unsure=true');
        }
    } else if (
        attempt.correct !== false ||
        attempt.unsure !== false ||
        attempt.analysisEligible !== false
    ) {
        throw new Error(
            'blank attempts require correct=false, unsure=false, and analysisEligible=false',
        );
    }
}

function scorePart(attempt: LearningEvidenceAttempt): number | null {
    if (attempt.responseState === 'blank') return null;
    if (attempt.responseState === 'unknown') return 0;
    if (!attempt.correct) return 0;
    return attempt.unsure ? 0.5 : 1;
}

function aggregateGroup(group: ObservationGroup): ProblemEvidenceObservation {
    const { metadata, parts } = group;
    if (parts.length > metadata.expectedPartCount) {
        throw new Error(
            `observation ${metadata.observationId} has more parts than expectedPartCount`,
        );
    }

    const nonBlankParts = parts.filter((part) => part.responseState !== 'blank');
    const hasMixedNonBlankEligibility =
        nonBlankParts.some((part) => part.analysisEligible) &&
        nonBlankParts.some((part) => !part.analysisEligible);
    if (hasMixedNonBlankEligibility) {
        throw new Error(
            `observation ${metadata.observationId} mixes eligible and excluded non-blank parts`,
        );
    }

    const eligibleParts = parts.filter((part) => part.analysisEligible);
    const partScores = eligibleParts.map(scorePart);
    const analyzedScores = partScores.filter((score): score is number => score !== null);
    const trendScore = analyzedScores.length
        ? analyzedScores.reduce((sum, score) => sum + score, 0) / analyzedScores.length
        : null;
    const hasFailure = eligibleParts.some(
        (part) =>
            part.responseState === 'unknown' ||
            (part.responseState === 'answered' && part.correct === false),
    );
    const isConfidentFullCorrect =
        parts.length === metadata.expectedPartCount &&
        parts.every(
            (part) =>
                part.analysisEligible &&
                part.responseState === 'answered' && part.correct === true && part.unsure === false,
        );

    let responseOutcome: ProblemResponseOutcome = 'uncertain_or_incomplete';
    if (parts.every((part) => part.responseState === 'blank')) responseOutcome = 'blank';
    else if (hasFailure) responseOutcome = 'failure';
    else if (isConfidentFullCorrect) responseOutcome = 'confident_full_correct';

    return {
        observationId: metadata.observationId,
        problemId: metadata.problemId,
        equivalenceKey: metadata.equivalenceKey,
        observedOn: metadata.observedOn,
        challengeBand: metadata.challengeBand,
        evidenceKind: metadata.evidenceKind,
        analysisEligible: eligibleParts.length > 0,
        expectedPartCount: metadata.expectedPartCount,
        recordedPartCount: parts.length,
        analyzedPartCount: analyzedScores.length,
        responseOutcome,
        trendScore,
    };
}

export function aggregateProblemEvidence(
    attempts: readonly LearningEvidenceAttempt[],
): ProblemEvidenceObservation[] {
    const groups = new Map<string, ObservationGroup>();

    for (const attempt of attempts) {
        validateAttempt(attempt);
        const existing = groups.get(attempt.observationId);

        if (existing) {
            assertCompatibleMetadata(existing, attempt);
            if (existing.parts.some((part) => part.partKey === attempt.partKey)) {
                throw new Error(
                    `observation ${attempt.observationId} has duplicate partKey ${attempt.partKey}`,
                );
            }
            existing.parts.push({ ...attempt });
        } else {
            groups.set(attempt.observationId, {
                metadata: {
                    observationId: attempt.observationId,
                    problemId: attempt.problemId,
                    equivalenceKey: attempt.equivalenceKey,
                    observedOn: attempt.observedOn,
                    challengeBand: attempt.challengeBand,
                    evidenceKind: attempt.evidenceKind,
                    expectedPartCount: attempt.expectedPartCount,
                },
                parts: [{ ...attempt }],
            });
        }
    }

    return [...groups.values()]
        .map(aggregateGroup)
        .sort(
            (left, right) =>
                left.observedOn.localeCompare(right.observedOn) ||
                left.observationId.localeCompare(right.observationId),
        );
}

function evaluateObservation(
    observation: ProblemEvidenceObservation,
    targetChallengeBand: ChallengeBand,
    asOf: string,
): EvaluatedProblemEvidenceObservation {
    let readinessOutcome: EvaluatedProblemEvidenceObservation['readinessOutcome'] = 'not_eligible';
    let readinessExclusionReason: ReadinessExclusionReason | null = null;

    if (observation.observedOn > asOf) readinessExclusionReason = 'future_observation';
    else if (observation.challengeBand !== targetChallengeBand) {
        readinessExclusionReason = 'challenge_band_mismatch';
    } else if (observation.responseOutcome === 'blank') readinessExclusionReason = 'blank';
    else if (!observation.analysisEligible) {
        readinessExclusionReason = 'analysis_excluded';
    }
    else if (observation.evidenceKind !== 'independent_new') {
        readinessExclusionReason = 'not_independent_new';
    } else if (observation.responseOutcome === 'confident_full_correct') {
        readinessOutcome = 'success';
    } else if (observation.responseOutcome === 'failure') {
        readinessOutcome = 'failure';
    } else {
        readinessExclusionReason = 'uncertain_or_incomplete';
    }

    return {
        ...observation,
        readinessOutcome,
        readinessExclusionReason,
    };
}

function dailyEvidenceRounds(events: readonly ReadinessEvent[]): ReadinessRound[] {
    const eventsByDate = new Map<string, ReadinessEvent[]>();
    for (const event of events) {
        const dateEvents = eventsByDate.get(event.observedOn) ?? [];
        dateEvents.push(event);
        eventsByDate.set(event.observedOn, dateEvents);
    }

    return [...eventsByDate.entries()]
        .map(([observedOn, dateEvents]): ReadinessRound => {
            const sortedEvents = [...dateEvents].sort((left, right) =>
                left.observationId.localeCompare(right.observationId),
            );
            const hasSuccess = sortedEvents.some((event) => event.outcome === 'success');
            const hasFailure = sortedEvents.some((event) => event.outcome === 'failure');
            return {
                observedOn,
                outcome: hasSuccess && hasFailure ? 'mixed' : hasFailure ? 'failure' : 'success',
                events: sortedEvents,
            };
        })
        .sort((left, right) => left.observedOn.localeCompare(right.observedOn));
}

function buildReadinessEpisodes(rounds: readonly ReadinessRound[]): ReadinessEpisode[] {
    const episodes: ReadinessEpisode[] = [];
    let current: ReadinessEpisode | null = null;

    for (const round of rounds) {
        if (round.outcome === 'mixed') {
            current = null;
            continue;
        }

        if (!current || current.outcome !== round.outcome) {
            current = { outcome: round.outcome, rounds: [round] };
            episodes.push(current);
        } else {
            current.rounds.push(round);
        }
    }

    return episodes;
}

function eventPairIsDistinct(left: ReadinessEvent, right: ReadinessEvent): boolean {
    return (
        left.problemId !== right.problemId &&
        left.equivalenceKey !== right.equivalenceKey
    );
}

function findDistinctEvidencePair(
    rounds: readonly ReadinessRound[],
    order: 'earliest' | 'latest',
): DistinctEvidencePair | null {
    if (rounds.length < 2) return null;

    const laterIndexes = [...rounds.keys()].slice(1);
    if (order === 'latest') laterIndexes.reverse();

    for (const laterIndex of laterIndexes) {
        const earlierIndexes = [...Array(laterIndex).keys()];
        if (order === 'latest') earlierIndexes.reverse();

        for (const earlierIndex of earlierIndexes) {
            const earlierEvents = rounds[earlierIndex].events;
            const laterEvents = rounds[laterIndex].events;
            for (const later of laterEvents) {
                for (const earlier of earlierEvents) {
                    if (eventPairIsDistinct(earlier, later)) return [earlier, later];
                }
            }
        }
    }

    return null;
}

function countDistinctEpisodeRounds(episodes: readonly ReadinessEpisode[]): number {
    let count = 0;

    for (const episode of episodes) {
        const acceptedEvents: ReadinessEvent[] = [];
        for (const round of episode.rounds) {
            const next = round.events.find((event) =>
                acceptedEvents.every((accepted) => eventPairIsDistinct(accepted, event)),
            );
            if (!next) continue;
            acceptedEvents.push(next);
            count += 1;
        }
    }

    return count;
}

function observationIds(events: readonly ReadinessEvent[]): string[] {
    return [...new Set(events.map((event) => event.observationId))];
}

function addCalendarDays(date: string, days: number): string {
    const timestamp = dateOnlyTimestamp(date, 'date') + days * MILLISECONDS_PER_DAY;
    return new Date(timestamp).toISOString().slice(0, 10);
}

export function evaluateLearningEvidence(
    input: EvaluateLearningEvidenceInput,
): LearningEvidenceEvaluation {
    const asOfTimestamp = dateOnlyTimestamp(input.asOf, 'asOf');
    assertChallengeBand(input.targetChallengeBand, 'targetChallengeBand');

    const verificationIntervalDays =
        input.verificationIntervalDays ?? DEFAULT_VERIFICATION_INTERVAL_DAYS;
    assertPositiveInteger(verificationIntervalDays, 'verificationIntervalDays');

    const requiredDistinctEquivalenceCount =
        input.content.requiredDistinctEquivalenceCount ??
        DEFAULT_REQUIRED_DISTINCT_EQUIVALENCE_COUNT;
    assertPositiveInteger(
        requiredDistinctEquivalenceCount,
        'requiredDistinctEquivalenceCount',
    );
    assertNonNegativeInteger(
        input.content.approvedDistinctEquivalenceCount,
        'approvedDistinctEquivalenceCount',
    );

    const observations = aggregateProblemEvidence(input.attempts).map((observation) =>
        evaluateObservation(observation, input.targetChallengeBand, input.asOf),
    );
    const targetTrendObservations = observations
        .filter(
            (observation) =>
                observation.observedOn <= input.asOf &&
                observation.challengeBand === input.targetChallengeBand &&
                observation.analysisEligible &&
                (observation.evidenceKind === 'independent_new' ||
                    observation.evidenceKind === 'independent_same_delayed') &&
                observation.trendScore !== null,
        );
    const targetTrendScores = targetTrendObservations.map(
        (observation) => observation.trendScore as number,
    );
    const independentTrendObservations = targetTrendObservations.filter(
        (observation) => observation.evidenceKind === 'independent_new',
    );
    const firstIndependentScore = independentTrendObservations.at(0)?.trendScore ?? null;
    const latestIndependentScore = independentTrendObservations.at(-1)?.trendScore ?? null;
    const recentTrendScores = targetTrendScores.slice(-3);
    let trendDirection: LearningEvidenceEvaluation['trend']['direction'] = 'insufficient';
    if (firstIndependentScore !== null && latestIndependentScore !== null) {
        if (independentTrendObservations.length >= 2) {
            trendDirection =
                latestIndependentScore > firstIndependentScore
                    ? 'improving'
                    : latestIndependentScore < firstIndependentScore
                      ? 'declining'
                      : 'stable';
        }
    }

    const readinessEvents: ReadinessEvent[] = observations.flatMap((observation) => {
        if (observation.readinessOutcome === 'not_eligible') return [];
        return [
            {
                observationId: observation.observationId,
                problemId: observation.problemId,
                equivalenceKey: observation.equivalenceKey,
                observedOn: observation.observedOn,
                outcome: observation.readinessOutcome,
            },
        ];
    });
    const rounds = dailyEvidenceRounds(readinessEvents);
    const episodes = buildReadinessEpisodes(rounds);
    const latestRound = rounds.at(-1) ?? null;
    const currentEpisode =
        latestRound && latestRound.outcome !== 'mixed'
            ? (episodes.at(-1) ?? null)
            : null;
    const currentPair = currentEpisode
        ? findDistinctEvidencePair(currentEpisode.rounds, 'latest')
        : null;

    let status: LearningReadinessStatus = 'unassessed';
    if (latestRound?.outcome === 'mixed') {
        status = 'verification_needed';
    } else if (currentEpisode?.outcome === 'failure') {
        status = currentPair ? 'support_candidate' : 'verification_needed';
    } else if (currentEpisode?.outcome === 'success') {
        status = currentPair ? 'recent_confirmed' : 'verification_needed';
    }

    let lastConfirmedOn: string | null = null;
    for (const episode of episodes) {
        if (episode.outcome !== 'success') continue;
        const pair = findDistinctEvidencePair(episode.rounds, 'earliest');
        if (pair) lastConfirmedOn = pair[1].observedOn;
    }

    let verificationDueOn: string | null = null;
    let verificationDue = false;
    let decisivePair = currentPair;
    if (status === 'recent_confirmed' && currentEpisode && lastConfirmedOn) {
        while (true) {
            verificationDueOn = addCalendarDays(
                lastConfirmedOn,
                verificationIntervalDays,
            );
            if (asOfTimestamp < dateOnlyTimestamp(verificationDueOn, 'date')) break;

            const renewalRounds = currentEpisode.rounds.filter(
                (round) => round.observedOn >= verificationDueOn!,
            );
            const renewalPair = findDistinctEvidencePair(renewalRounds, 'earliest');
            if (!renewalPair) {
                verificationDue = true;
                break;
            }

            lastConfirmedOn = renewalPair[1].observedOn;
            decisivePair = renewalPair;
        }
    }

    let decisiveObservationIds: string[] = [];
    if (decisivePair) {
        decisiveObservationIds = observationIds(decisivePair);
    } else if (latestRound) {
        decisiveObservationIds = observationIds(latestRound.events);
    }
    const missingDistinctEquivalenceCount = Math.max(
        0,
        requiredDistinctEquivalenceCount - input.content.approvedDistinctEquivalenceCount,
    );

    return {
        readiness: {
            status,
            verificationDue,
            verificationDueOn,
            lastConfirmedOn,
            decisiveObservationIds,
            countedEvidenceRoundCount: countDistinctEpisodeRounds(episodes),
        },
        trend: {
            averageScore: targetTrendScores.length
                ? targetTrendScores.reduce((sum, score) => sum + score, 0) /
                  targetTrendScores.length
                : null,
            recentAverageScore: recentTrendScores.length
                ? recentTrendScores.reduce((sum, score) => sum + score, 0) /
                  recentTrendScores.length
                : null,
            firstIndependentScore,
            latestIndependentScore,
            direction: trendDirection,
            observationCount: targetTrendScores.length,
        },
        content: {
            status: missingDistinctEquivalenceCount > 0 ? 'content_gap' : 'sufficient',
            approvedDistinctEquivalenceCount:
                input.content.approvedDistinctEquivalenceCount,
            requiredDistinctEquivalenceCount,
            missingDistinctEquivalenceCount,
        },
        observations,
    };
}
