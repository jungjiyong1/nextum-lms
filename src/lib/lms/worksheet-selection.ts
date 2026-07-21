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

/** 난이도별 요청 문항 수. 예: { 2: 1, 3: 2 } = 중 1 + 상 2 */
export type WorksheetBandPlan = Partial<Record<ChallengeBand, number>>;

export type WorksheetDifficultyPreset = 'easier' | 'recommended' | 'harder';

export interface WorksheetSelectionInput {
    purpose: EligiblePurpose;
    targetChallengeBand: ChallengeBand;
    itemCount: number;
    /** 지정 시 itemCount 대신 계획의 합이 총 문항 수가 된다. */
    bandPlan?: WorksheetBandPlan;
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
    /** 난이도별 선택 가능 후보 수 (최근 제외 규칙 적용 후, 선택 전) */
    bandAvailability: Record<ChallengeBand, number>;
}

function oneBandEasier(band: ChallengeBand): ChallengeBand {
    return (band > 1 ? band - 1 : band + 1) as ChallengeBand;
}

function mergeIntoPlan(plan: WorksheetBandPlan, band: ChallengeBand, count: number): void {
    if (count <= 0) return;
    plan[band] = (plan[band] ?? 0) + count;
}

/**
 * 프리셋을 난이도 계획으로 바꾼다. '추천'은 기본 규칙(목표 2/3 + 한 단계
 * 아래 1/3)이고, '더 쉽게'는 무게중심을 한 단계 내리며, '더 어렵게'는 목표
 * 위주에 한 단계 위 문항을 1/3 섞는다. 프리셋은 자동 상한(기본 3)을 넘지
 * 않는다 — 최상(4)은 직접 조정에서만 선택한다.
 */
export function buildPresetBandPlan(
    preset: WorksheetDifficultyPreset,
    targetChallengeBand: ChallengeBand,
    itemCount: number,
    config: WorksheetRecommendationConfig = DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG,
): WorksheetBandPlan {
    if (!Number.isInteger(itemCount) || itemCount <= 0) {
        throw new Error('itemCount must be a positive integer');
    }
    const plan: WorksheetBandPlan = {};
    const majority = Math.ceil((itemCount * 2) / 3);

    if (preset === 'easier') {
        if (targetChallengeBand === 1) {
            mergeIntoPlan(plan, 1, itemCount);
            return plan;
        }
        const easier = (targetChallengeBand - 1) as ChallengeBand;
        mergeIntoPlan(plan, easier, majority);
        mergeIntoPlan(plan, oneBandEasier(easier), itemCount - majority);
        return plan;
    }

    if (preset === 'harder') {
        const harder = Math.min(
            targetChallengeBand + 1,
            config.maxAutoChallengeBand,
        ) as ChallengeBand;
        mergeIntoPlan(plan, targetChallengeBand, majority);
        mergeIntoPlan(plan, harder, itemCount - majority);
        return plan;
    }

    mergeIntoPlan(plan, targetChallengeBand, majority);
    mergeIntoPlan(plan, oneBandEasier(targetChallengeBand), itemCount - majority);
    return plan;
}

function normalizeBandPlan(plan: WorksheetBandPlan): Array<[ChallengeBand, number]> {
    const entries: Array<[ChallengeBand, number]> = [];
    for (const band of [1, 2, 3, 4] as const) {
        const count = plan[band];
        if (count === undefined || count === 0) continue;
        if (!Number.isInteger(count) || count < 0) {
            throw new Error('bandPlan counts must be non-negative integers');
        }
        entries.push([band, count]);
    }
    if (entries.length === 0) {
        throw new Error('bandPlan must request at least one problem');
    }
    return entries;
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

function countByBand(pool: readonly NormalizedCandidate[]): Record<ChallengeBand, number> {
    const counts: Record<ChallengeBand, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const candidate of pool) counts[candidate.challengeBand] += 1;
    return counts;
}

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
    if (!input.bandPlan && (!Number.isInteger(input.itemCount) || input.itemCount <= 0)) {
        throw new Error('itemCount must be a positive integer');
    }
    if (input.seed.trim().length === 0) {
        throw new Error('seed must not be empty');
    }
    const planEntries = normalizeBandPlan(
        input.bandPlan
            ?? buildPresetBandPlan('recommended', input.targetChallengeBand, input.itemCount, config),
    );
    const totalCount = planEntries.reduce((sum, [, count]) => sum + count, 0);

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
        if (freshPool.length < totalCount) {
            return {
                selected: [],
                warnings,
                verificationBlocked: true,
                bandAvailability: countByBand(freshPool),
            };
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

    const bandAvailability = countByBand(freshPool);

    // 계획된 난이도를 목표에 가까운 순서로 채운다.
    const orderedPlan = [...planEntries].sort(
        (left, right) =>
            Math.abs(left[0] - input.targetChallengeBand) - Math.abs(right[0] - input.targetChallengeBand)
            || left[0] - right[0],
    );
    for (const [band, count] of orderedPlan) {
        takeFromBand(freshPool, band, count, picked, pickedIds, pickedGroups);
    }

    if (picked.length < totalCount) {
        // 계획이 남긴 부족분은 목표 난이도에서 먼저 다시 채운다.
        takeFromBand(
            freshPool,
            input.targetChallengeBand,
            totalCount - picked.length,
            picked,
            pickedIds,
            pickedGroups,
        );
        let filledFromOtherBands = 0;
        for (const band of bandFillOrder(input.targetChallengeBand)) {
            if (picked.length >= totalCount) break;
            filledFromOtherBands += takeFromBand(
                freshPool, band, totalCount - picked.length, picked, pickedIds, pickedGroups,
            );
        }
        if (filledFromOtherBands > 0) {
            warnings.push({
                code: 'band_shortage',
                detail: '요청한 난이도의 문항이 부족해 가까운 난이도로 보충했습니다.',
            });
        }
    }

    if (picked.length < totalCount && input.purpose !== 'verification') {
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
            return { selected: [], warnings: [], verificationBlocked: true, bandAvailability };
        }
        warnings.push({
            code: 'count_shortage',
            detail: `요청 ${totalCount}문항 중 ${picked.length}문항만 선택할 수 있습니다.`,
        });
    }

    return { selected: picked, warnings, verificationBlocked: false, bandAvailability };
}
