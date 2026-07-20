import type {
    ChallengeBand,
    ContentCoverageStatus,
    LearningReadinessStatus,
} from './learning-evidence';
import {
    DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG,
    type WorksheetItemRole,
    type WorksheetRecommendationConfig,
} from './worksheet-config';

/**
 * Per student × skill facts assembled from the learning-evidence evaluation
 * and the unified assignment/attempt history. Eligibility is always derived
 * from these inputs at call time; nothing here is persisted state.
 */
export interface SkillEvidenceSummary {
    analysisSkillId: string;
    skillName: string;
    status: LearningReadinessStatus;
    contentStatus: ContentCoverageStatus;
    /** 마지막 독립 확인 성공일 (learning-evidence lastConfirmedOn) */
    lastConfirmedOn: string | null;
    /** 마지막 교정·연습 활동일 (correction/guided attempts, practice worksheet) */
    lastCorrectionOn: string | null;
    /** 최근 독립 성공한 최고 난이도 */
    highestIndependentSuccessBand: ChallengeBand | null;
    /** 마지막 교정·연습에 사용한 난이도 */
    lastPracticedBand: ChallengeBand | null;
}

export type EligiblePurpose = 'verification' | 'practice' | 'review';

export type EligibleItemState = 'eligible' | 'delayed' | 'locked';

export interface EligibleWorksheetItem {
    analysisSkillId: string;
    skillName: string;
    purpose: EligiblePurpose;
    state: EligibleItemState;
    /** null이면 즉시 자격 (대기 조건 없음) */
    eligibleAfter: string | null;
    daysUntilEligible: number | null;
    daysSinceEligible: number | null;
    suggestedChallengeBand: ChallengeBand;
    suggestedItemCount: number;
    basisSummary: string;
}

export type SkillExclusionReason = 'insufficient_data' | 'content_gap';

export interface ExcludedSkill {
    analysisSkillId: string;
    skillName: string;
    reason: SkillExclusionReason;
}

export interface EligibleWorksheetItemsInput {
    skills: readonly SkillEvidenceSummary[];
    asOf: string;
    config?: WorksheetRecommendationConfig;
}

export interface EligibleWorksheetItemsResult {
    items: EligibleWorksheetItem[];
    excluded: ExcludedSkill[];
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

function addCalendarDays(date: string, days: number): string {
    const timestamp = dateOnlyTimestamp(date, 'date') + days * MILLISECONDS_PER_DAY;
    return new Date(timestamp).toISOString().slice(0, 10);
}

function diffCalendarDays(from: string, to: string): number {
    return Math.round(
        (dateOnlyTimestamp(to, 'to') - dateOnlyTimestamp(from, 'from')) / MILLISECONDS_PER_DAY,
    );
}

function clampToAutoBand(
    band: ChallengeBand,
    config: WorksheetRecommendationConfig,
): ChallengeBand {
    return (band > config.maxAutoChallengeBand ? config.maxAutoChallengeBand : band) as ChallengeBand;
}

function oneBandEasier(band: ChallengeBand): ChallengeBand {
    return (band > 1 ? band - 1 : band) as ChallengeBand;
}

function gatedState(
    eligibleAfter: string | null,
    asOf: string,
    config: WorksheetRecommendationConfig,
): Pick<EligibleWorksheetItem, 'state' | 'eligibleAfter' | 'daysUntilEligible' | 'daysSinceEligible'> {
    if (eligibleAfter === null) {
        return { state: 'eligible', eligibleAfter: null, daysUntilEligible: null, daysSinceEligible: null };
    }
    const days = diffCalendarDays(eligibleAfter, asOf);
    if (days < 0) {
        return {
            state: 'locked',
            eligibleAfter,
            daysUntilEligible: -days,
            daysSinceEligible: null,
        };
    }
    return {
        state: days > config.delayedAfterDays ? 'delayed' : 'eligible',
        eligibleAfter,
        daysUntilEligible: null,
        daysSinceEligible: days,
    };
}

function targetBand(
    skill: SkillEvidenceSummary,
    config: WorksheetRecommendationConfig,
): ChallengeBand | null {
    const band = skill.highestIndependentSuccessBand ?? skill.lastPracticedBand;
    return band === null ? null : clampToAutoBand(band, config);
}

const STATE_ORDER: Record<EligibleItemState, number> = { delayed: 0, eligible: 1, locked: 2 };
const PURPOSE_ORDER: Record<EligiblePurpose, number> = { verification: 0, practice: 1, review: 2 };

/**
 * Pull-based recommendation: given the evidence summary of every skill the
 * student has touched, return the items that qualify for the next worksheet
 * as of the given date. Pure and side-effect free.
 */
export function getEligibleWorksheetItems(
    input: EligibleWorksheetItemsInput,
): EligibleWorksheetItemsResult {
    dateOnlyTimestamp(input.asOf, 'asOf');
    const config = input.config ?? DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG;

    const items: EligibleWorksheetItem[] = [];
    const excluded: ExcludedSkill[] = [];

    for (const skill of input.skills) {
        if (skill.contentStatus === 'content_gap') {
            excluded.push({
                analysisSkillId: skill.analysisSkillId,
                skillName: skill.skillName,
                reason: 'content_gap',
            });
            continue;
        }

        const band = targetBand(skill, config);
        if (skill.status === 'unassessed' || band === null) {
            excluded.push({
                analysisSkillId: skill.analysisSkillId,
                skillName: skill.skillName,
                reason: 'insufficient_data',
            });
            continue;
        }

        if (skill.status === 'verification_needed' || skill.status === 'support_candidate') {
            const verificationEligibleAfter = skill.lastCorrectionOn
                ? addCalendarDays(skill.lastCorrectionOn, config.correctionToVerificationDays)
                : null;
            const gate = gatedState(verificationEligibleAfter, input.asOf, config);
            items.push({
                analysisSkillId: skill.analysisSkillId,
                skillName: skill.skillName,
                purpose: 'verification',
                ...gate,
                suggestedChallengeBand: band,
                suggestedItemCount: config.verificationItemCount,
                basisSummary:
                    gate.state === 'locked'
                        ? `교정 후 ${diffCalendarDays(skill.lastCorrectionOn!, input.asOf)}일 · 최소 ${config.correctionToVerificationDays}일 필요`
                        : skill.lastCorrectionOn
                          ? `교정 후 ${diffCalendarDays(skill.lastCorrectionOn, input.asOf)}일 경과`
                          : '독립 확인 필요',
            });
        }

        if (skill.status === 'support_candidate') {
            items.push({
                analysisSkillId: skill.analysisSkillId,
                skillName: skill.skillName,
                purpose: 'practice',
                state: 'eligible',
                eligibleAfter: null,
                daysUntilEligible: null,
                daysSinceEligible: null,
                suggestedChallengeBand: oneBandEasier(band),
                suggestedItemCount: config.practiceItemCountMax,
                basisSummary: '반복 어려움 관찰 · 설명 후 연습 권장',
            });
        }

        if (skill.status === 'recent_confirmed' && skill.lastConfirmedOn) {
            const reviewEligibleAfter = addCalendarDays(
                skill.lastConfirmedOn,
                config.confirmedToReviewDays,
            );
            const gate = gatedState(reviewEligibleAfter, input.asOf, config);
            items.push({
                analysisSkillId: skill.analysisSkillId,
                skillName: skill.skillName,
                purpose: 'review',
                ...gate,
                suggestedChallengeBand: band,
                suggestedItemCount: config.reviewItemCount,
                basisSummary:
                    gate.state === 'locked'
                        ? `확인 후 ${diffCalendarDays(skill.lastConfirmedOn, input.asOf)}일 · 최소 ${config.confirmedToReviewDays}일 필요`
                        : `확인 후 ${diffCalendarDays(skill.lastConfirmedOn, input.asOf)}일 경과`,
            });
        }
    }

    items.sort(
        (left, right) =>
            STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
            PURPOSE_ORDER[left.purpose] - PURPOSE_ORDER[right.purpose] ||
            left.analysisSkillId.localeCompare(right.analysisSkillId),
    );

    return { items, excluded };
}

export interface ResolvedInclusionRole {
    role: WorksheetItemRole;
    evidenceEligible: boolean;
}

/**
 * Maps a cart inclusion to the item role stored on worksheet_items. Forcing a
 * locked verification item keeps teacher discretion but downgrades it to
 * practice so verification evidence is never polluted.
 */
export function resolveInclusionRole(
    purpose: EligiblePurpose,
    state: EligibleItemState,
): ResolvedInclusionRole {
    if (purpose === 'verification') {
        if (state === 'locked') return { role: 'practice', evidenceEligible: false };
        return { role: 'verification', evidenceEligible: true };
    }
    if (purpose === 'review') return { role: 'review', evidenceEligible: true };
    return { role: 'practice', evidenceEligible: false };
}
