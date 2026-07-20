import type { ChallengeBand } from './learning-evidence';
import {
    DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG,
    type WorksheetRecommendationConfig,
} from './worksheet-config';
import type { EligiblePurpose } from './worksheet-eligibility';

export interface CandidateProblem {
    problemId: string;
    challengeBand: ChallengeBand;
    /** 없으면 problem_id 자체가 임시 동형 그룹이다. */
    similarityGroupId?: string | null;
}

/** 기존 과제·PDF 매칭·학습지 경로를 합친 통합 배정/풀이 이력 한 건. */
export interface ProblemHistoryRecord {
    problemId: string;
    similarityGroupId?: string | null;
    lastSeenOn: string;
}

export interface MergedProblemHistory {
    problemId: string;
    similarityGroupId: string;
    lastSeenOn: string;
}

export type SelectionWarningCode =
    | 'band_shortage'
    | 'reused_recent_problems'
    | 'count_shortage';

export interface SelectionWarning {
    code: SelectionWarningCode;
    detail: string;
}

export interface SelectedProblem {
    problemId: string;
    challengeBand: ChallengeBand;
    similarityGroupId: string;
}

export interface WorksheetSelectionInput {
    purpose: EligiblePurpose;
    targetChallengeBand: ChallengeBand;
    itemCount: number;
    candidates: readonly CandidateProblem[];
    history: readonly ProblemHistoryRecord[];
    /** 같은 학습지에 이미 담긴 문제 (동일 문제지 내 중복 절대 금지) */
    excludedProblemIds?: readonly string[];
    asOf: string;
    seed: string;
    config?: WorksheetRecommendationConfig;
}

export interface WorksheetSelectionResult {
    selected: SelectedProblem[];
    warnings: SelectionWarning[];
    /** 확인용 미풀이 문항이 부족해 확인을 제안할 수 없는 상태 */
    verificationBlocked: boolean;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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

/** 여러 이력 소스를 문제 단위로 병합한다. 최신 날짜가 남는다. */
export function mergeProblemHistory(
    records: readonly ProblemHistoryRecord[],
): Map<string, MergedProblemHistory> {
    const merged = new Map<string, MergedProblemHistory>();
    for (const record of records) {
        dateOnlyTimestamp(record.lastSeenOn, 'lastSeenOn');
        const similarityGroupId = record.similarityGroupId ?? record.problemId;
        const existing = merged.get(record.problemId);
        if (!existing || existing.lastSeenOn < record.lastSeenOn) {
            merged.set(record.problemId, {
                problemId: record.problemId,
                similarityGroupId,
                lastSeenOn: record.lastSeenOn,
            });
        }
    }
    return merged;
}

function hashSeed(seed: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function mulberry32(state: number): () => number {
    let current = state;
    return () => {
        current = (current + 0x6d2b79f5) | 0;
        let t = Math.imul(current ^ (current >>> 15), 1 | current);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seededShuffle<T>(values: readonly T[], random: () => number): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function bandFillOrder(target: ChallengeBand): ChallengeBand[] {
    // 가까운 난이도순, 같은 거리면 쉬운 쪽 우선
    return ([1, 2, 3, 4] as const)
        .filter((band) => band !== target)
        .sort(
            (left, right) =>
                Math.abs(left - target) - Math.abs(right - target) || left - right,
        );
}

type NormalizedCandidate = SelectedProblem & { lastSeenOn: string | null };

function takeFromBand(
    pool: NormalizedCandidate[],
    band: ChallengeBand | null,
    count: number,
    picked: SelectedProblem[],
    pickedIds: Set<string>,
    pickedGroups: Set<string>,
): number {
    let taken = 0;
    for (const candidate of pool) {
        if (taken >= count) break;
        if (band !== null && candidate.challengeBand !== band) continue;
        if (pickedIds.has(candidate.problemId)) continue;
        if (pickedGroups.has(candidate.similarityGroupId)) continue;
        picked.push({
            problemId: candidate.problemId,
            challengeBand: candidate.challengeBand,
            similarityGroupId: candidate.similarityGroupId,
        });
        pickedIds.add(candidate.problemId);
        pickedGroups.add(candidate.similarityGroupId);
        taken += 1;
    }
    return taken;
}

/**
 * Deterministic problem selection for one eligible item. Verification only
 * ever uses problems the student has never been assigned or attempted (in the
 * same temporary similarity group either); running short blocks verification
 * instead of degrading it. Practice/review exclude the recent window first
 * and re-admit oldest problems with a warning when the pool runs dry.
 */
export function selectWorksheetProblems(
    input: WorksheetSelectionInput,
): WorksheetSelectionResult {
    const config = input.config ?? DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG;
    const asOfTimestamp = dateOnlyTimestamp(input.asOf, 'asOf');
    if (!Number.isInteger(input.itemCount) || input.itemCount <= 0) {
        throw new Error('itemCount must be a positive integer');
    }
    if (input.seed.trim().length === 0) {
        throw new Error('seed must not be empty');
    }

    const history = mergeProblemHistory(input.history);
    const seenGroups = new Set(
        [...history.values()].map((record) => record.similarityGroupId),
    );
    const alreadyInSheet = new Set(input.excludedProblemIds ?? []);
    const recentCutoff = asOfTimestamp - config.recentExclusionDays * MILLISECONDS_PER_DAY;

    const uniqueCandidates = new Map<string, NormalizedCandidate>();
    for (const candidate of input.candidates) {
        if (alreadyInSheet.has(candidate.problemId)) continue;
        if (uniqueCandidates.has(candidate.problemId)) continue;
        uniqueCandidates.set(candidate.problemId, {
            problemId: candidate.problemId,
            challengeBand: candidate.challengeBand,
            similarityGroupId: candidate.similarityGroupId ?? candidate.problemId,
            lastSeenOn: history.get(candidate.problemId)?.lastSeenOn ?? null,
        });
    }

    const random = mulberry32(hashSeed(input.seed));
    const shuffled = seededShuffle(
        [...uniqueCandidates.values()].sort((left, right) =>
            left.problemId.localeCompare(right.problemId),
        ),
        random,
    );

    const warnings: SelectionWarning[] = [];
    const picked: SelectedProblem[] = [];
    const pickedIds = new Set<string>();
    const pickedGroups = new Set<string>();

    let freshPool: NormalizedCandidate[];
    let stalePool: NormalizedCandidate[] = [];

    if (input.purpose === 'verification') {
        freshPool = shuffled.filter(
            (candidate) =>
                candidate.lastSeenOn === null &&
                !seenGroups.has(candidate.similarityGroupId),
        );
        if (freshPool.length < input.itemCount) {
            return { selected: [], warnings, verificationBlocked: true };
        }
    } else {
        freshPool = shuffled.filter(
            (candidate) =>
                candidate.lastSeenOn === null ||
                dateOnlyTimestamp(candidate.lastSeenOn, 'lastSeenOn') < recentCutoff,
        );
        stalePool = shuffled
            .filter(
                (candidate) =>
                    candidate.lastSeenOn !== null &&
                    dateOnlyTimestamp(candidate.lastSeenOn, 'lastSeenOn') >= recentCutoff,
            )
            .sort((left, right) => left.lastSeenOn!.localeCompare(right.lastSeenOn!));
    }

    const primaryCount = Math.ceil((input.itemCount * 2) / 3);
    const secondaryBand =
        input.targetChallengeBand > 1
            ? ((input.targetChallengeBand - 1) as ChallengeBand)
            : ((input.targetChallengeBand + 1) as ChallengeBand);

    takeFromBand(freshPool, input.targetChallengeBand, primaryCount, picked, pickedIds, pickedGroups);
    takeFromBand(
        freshPool,
        secondaryBand,
        input.itemCount - picked.length,
        picked,
        pickedIds,
        pickedGroups,
    );

    if (picked.length < input.itemCount) {
        for (const band of bandFillOrder(input.targetChallengeBand)) {
            if (picked.length >= input.itemCount) break;
            takeFromBand(freshPool, band, input.itemCount - picked.length, picked, pickedIds, pickedGroups);
        }
        if (picked.length > 0) {
            warnings.push({
                code: 'band_shortage',
                detail: `목표 난이도 ${input.targetChallengeBand} 문항이 부족해 가까운 난이도로 보충했습니다.`,
            });
        }
    }

    if (picked.length < input.itemCount && input.purpose !== 'verification') {
        const before = picked.length;
        takeFromBand(stalePool, null, input.itemCount - picked.length, picked, pickedIds, pickedGroups);
        if (picked.length > before) {
            warnings.push({
                code: 'reused_recent_problems',
                detail: `최근 ${config.recentExclusionDays}일 안에 다룬 문제를 오래된 순으로 다시 포함했습니다.`,
            });
        }
    }

    if (picked.length < input.itemCount) {
        // 미풀이 후보가 동형 그룹으로 겹쳐 실제 선택 수가 모자라면 확인은 성립하지 않는다.
        if (input.purpose === 'verification') {
            return { selected: [], warnings: [], verificationBlocked: true };
        }
        warnings.push({
            code: 'count_shortage',
            detail: `요청 ${input.itemCount}문항 중 ${picked.length}문항만 선택할 수 있습니다.`,
        });
    }

    return { selected: picked, warnings, verificationBlocked: false };
}
