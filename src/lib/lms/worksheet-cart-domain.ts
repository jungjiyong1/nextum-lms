import {
    aggregateProblemEvidence,
    evaluateLearningEvidence,
    type ChallengeBand,
    type LearningEvidenceAttempt,
    type LearningEvidenceKind,
    type LearningResponseState,
} from './learning-evidence';
import {
    DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG,
    type WorksheetRecommendationConfig,
} from './worksheet-config';
import {
    getEligibleWorksheetItems,
    type EligibleWorksheetItem,
    type ExcludedSkill,
    type SkillEvidenceSummary,
} from './worksheet-eligibility';
import {
    selectWorksheetProblems,
    type ProblemHistoryRecord,
    type SelectedProblem,
    type SelectionWarning,
} from './worksheet-selection';

/** reporting.v_learning_evidence_base 한 행의 정규화된 형태 */
export interface EvidenceBaseRow {
    sessionId: string;
    problemId: string;
    subLabel: string | null;
    correct: boolean;
    unsure: boolean;
    responseState: LearningResponseState;
    evidenceKind: string;
    analysisEligible: boolean;
    /** YYYY-MM-DD (Asia/Seoul) */
    observedOn: string;
    skillId: string;
    challengeBand: ChallengeBand | null;
    equivalenceKey: string | null;
}

export interface ApprovedTagRow {
    problemId: string;
    skillId: string;
    challengeBand: ChallengeBand | null;
    equivalenceKey: string | null;
}

export interface CartItemComputation extends EligibleWorksheetItem {
    verificationBlocked: boolean;
    selected: SelectedProblem[];
    alternates: SelectedProblem[];
    warnings: SelectionWarning[];
}

export interface CartComputationResult {
    items: CartItemComputation[];
    excluded: ExcludedSkill[];
}

const KNOWN_EVIDENCE_KINDS: readonly LearningEvidenceKind[] = [
    'independent_new',
    'independent_same_delayed',
    'correction',
    'review',
    'guided',
];

const CORRECTION_LIKE_KINDS = new Set<LearningEvidenceKind>(['correction', 'review', 'guided']);

/**
 * Legacy attempt rows predate the evidence taxonomy. They are never
 * independent evidence, so folding them into `guided` keeps readiness and
 * repeat-prevention semantics intact without widening the engine's type.
 */
export function normalizeEvidenceKind(value: string): LearningEvidenceKind {
    return (KNOWN_EVIDENCE_KINDS as readonly string[]).includes(value)
        ? (value as LearningEvidenceKind)
        : 'guided';
}

function toEngineAttempt(
    row: EvidenceBaseRow,
    expectedPartCount: number,
): LearningEvidenceAttempt | null {
    if (row.challengeBand === null) return null;
    const responseState = row.responseState;
    const blank = responseState === 'blank';
    const unknown = responseState === 'unknown';
    return {
        observationId: `${row.sessionId}:${row.problemId}`,
        problemId: row.problemId,
        equivalenceKey: row.equivalenceKey ?? row.problemId,
        observedOn: row.observedOn,
        challengeBand: row.challengeBand,
        evidenceKind: normalizeEvidenceKind(row.evidenceKind),
        analysisEligible: blank ? false : row.analysisEligible,
        expectedPartCount,
        partKey: row.subLabel ?? 'root',
        responseState,
        correct: blank || unknown ? false : row.correct,
        unsure: unknown ? true : blank ? false : row.unsure,
    };
}

export interface BuildSkillSummariesInput {
    rows: readonly EvidenceBaseRow[];
    skillNames: ReadonlyMap<string, string>;
    approvedTags: readonly ApprovedTagRow[];
    /** problemId → 기대 파트 수 (answer_key 기반) */
    expectedParts: ReadonlyMap<string, number>;
    asOf: string;
}

/**
 * Groups evidence rows per skill and derives the summary the eligibility
 * engine consumes. A skill whose rows cannot be aggregated (legacy data
 * quirks) degrades to `unassessed` instead of failing the whole cart.
 */
export function buildSkillEvidenceSummaries(
    input: BuildSkillSummariesInput,
): SkillEvidenceSummary[] {
    const rowsBySkill = new Map<string, EvidenceBaseRow[]>();
    for (const row of input.rows) {
        const rows = rowsBySkill.get(row.skillId) ?? [];
        rows.push(row);
        rowsBySkill.set(row.skillId, rows);
    }

    const equivalenceBySkillBand = new Map<string, Set<string>>();
    for (const tag of input.approvedTags) {
        if (tag.challengeBand === null) continue;
        const key = `${tag.skillId}:${tag.challengeBand}`;
        const keys = equivalenceBySkillBand.get(key) ?? new Set<string>();
        keys.add(tag.equivalenceKey ?? tag.problemId);
        equivalenceBySkillBand.set(key, keys);
    }

    const summaries: SkillEvidenceSummary[] = [];
    for (const [skillId, rows] of rowsBySkill) {
        const skillName = input.skillNames.get(skillId) ?? skillId;
        const fallback: SkillEvidenceSummary = {
            analysisSkillId: skillId,
            skillName,
            status: 'unassessed',
            contentStatus: 'sufficient',
            lastConfirmedOn: null,
            lastCorrectionOn: null,
            highestIndependentSuccessBand: null,
            lastPracticedBand: null,
        };

        try {
            const attempts = rows
                .map((row) => toEngineAttempt(row, input.expectedParts.get(row.problemId) ?? 1))
                .filter((attempt): attempt is LearningEvidenceAttempt => attempt !== null);
            if (attempts.length === 0) {
                summaries.push(fallback);
                continue;
            }

            const observations = aggregateProblemEvidence(attempts);

            let highestIndependentSuccessBand: ChallengeBand | null = null;
            let lastCorrectionOn: string | null = null;
            let lastPracticedBand: ChallengeBand | null = null;
            for (const observation of observations) {
                if (observation.observedOn > input.asOf) continue;
                if (
                    observation.evidenceKind === 'independent_new' &&
                    observation.analysisEligible &&
                    observation.responseOutcome === 'confident_full_correct' &&
                    (highestIndependentSuccessBand === null ||
                        observation.challengeBand > highestIndependentSuccessBand)
                ) {
                    highestIndependentSuccessBand = observation.challengeBand;
                }
                if (CORRECTION_LIKE_KINDS.has(observation.evidenceKind)) {
                    if (lastCorrectionOn === null || observation.observedOn > lastCorrectionOn) {
                        lastCorrectionOn = observation.observedOn;
                        lastPracticedBand = observation.challengeBand;
                    }
                }
            }

            const targetBand = highestIndependentSuccessBand ?? lastPracticedBand;
            if (targetBand === null) {
                summaries.push({ ...fallback, lastCorrectionOn });
                continue;
            }

            const approvedDistinctEquivalenceCount =
                equivalenceBySkillBand.get(`${skillId}:${targetBand}`)?.size ?? 0;
            const evaluation = evaluateLearningEvidence({
                attempts,
                targetChallengeBand: targetBand,
                asOf: input.asOf,
                content: { approvedDistinctEquivalenceCount },
            });

            summaries.push({
                analysisSkillId: skillId,
                skillName,
                status: evaluation.readiness.status,
                contentStatus: evaluation.content.status,
                lastConfirmedOn: evaluation.readiness.lastConfirmedOn,
                lastCorrectionOn,
                highestIndependentSuccessBand,
                lastPracticedBand,
            });
        } catch (error) {
            console.warn(`[Worksheet] skill ${skillId} evidence aggregation failed:`, error);
            summaries.push(fallback);
        }
    }

    return summaries.sort((left, right) =>
        left.analysisSkillId.localeCompare(right.analysisSkillId),
    );
}

export interface ComputeCartInput {
    summaries: readonly SkillEvidenceSummary[];
    approvedTags: readonly ApprovedTagRow[];
    history: readonly ProblemHistoryRecord[];
    asOf: string;
    seed: string;
    alternateCount?: number;
    config?: WorksheetRecommendationConfig;
}

/**
 * Runs eligibility and per-item problem selection with sheet-wide duplicate
 * prevention. Alternates are the deterministic next picks of the same seed so
 * a swap in the cart never re-rolls the whole selection.
 */
export function computeWorksheetCart(input: ComputeCartInput): CartComputationResult {
    const config = input.config ?? DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG;
    const alternateCount = input.alternateCount ?? 3;
    const eligibility = getEligibleWorksheetItems({
        skills: input.summaries,
        asOf: input.asOf,
        config,
    });

    const candidatesBySkill = new Map<string, ApprovedTagRow[]>();
    for (const tag of input.approvedTags) {
        if (tag.challengeBand === null) continue;
        const tags = candidatesBySkill.get(tag.skillId) ?? [];
        tags.push(tag);
        candidatesBySkill.set(tag.skillId, tags);
    }

    const usedProblemIds: string[] = [];
    const items: CartItemComputation[] = eligibility.items.map((item) => {
        const candidates = (candidatesBySkill.get(item.analysisSkillId) ?? []).map((tag) => ({
            problemId: tag.problemId,
            challengeBand: tag.challengeBand as ChallengeBand,
        }));
        const baseInput = {
            purpose: item.purpose,
            targetChallengeBand: item.suggestedChallengeBand,
            candidates,
            history: input.history,
            excludedProblemIds: [...usedProblemIds],
            asOf: input.asOf,
            seed: `${input.seed}:${item.analysisSkillId}:${item.purpose}`,
            config,
        };

        const authoritative = selectWorksheetProblems({
            ...baseInput,
            itemCount: item.suggestedItemCount,
        });
        if (authoritative.verificationBlocked) {
            return {
                ...item,
                verificationBlocked: true,
                selected: [],
                alternates: [],
                warnings: [],
            };
        }

        const extended = selectWorksheetProblems({
            ...baseInput,
            itemCount: item.suggestedItemCount + alternateCount,
        });
        const selectedIds = authoritative.selected.map((problem) => problem.problemId);
        const extendedIds = extended.selected.map((problem) => problem.problemId);
        const prefixMatches =
            !extended.verificationBlocked &&
            selectedIds.every((problemId, index) => extendedIds[index] === problemId);
        const alternates = prefixMatches
            ? extended.selected.slice(authoritative.selected.length)
            : [];

        // 예비 문제까지 예약해 두어야 교체가 학습지 내 중복을 만들 수 없다.
        usedProblemIds.push(...selectedIds, ...alternates.map((problem) => problem.problemId));
        return {
            ...item,
            verificationBlocked: false,
            selected: authoritative.selected,
            alternates,
            warnings: authoritative.warnings,
        };
    });

    return { items, excluded: eligibility.excluded };
}
