import type { ChallengeBand } from './learning-evidence';

export const WORKSHEET_ITEM_ROLES = [
    'verification',
    'practice',
    'review',
    'exam_prep',
    'teacher_added',
] as const;

export type WorksheetItemRole = (typeof WORKSHEET_ITEM_ROLES)[number];

/**
 * Recommendation defaults are pilot-tunable and must stay configurable; every
 * consumer takes the config as a parameter so academy-level overrides from
 * lms.settings can be injected without touching the pure functions.
 */
export interface WorksheetRecommendationConfig {
    /** 교정 활동 후 독립 확인 자격까지의 최소 경과일 */
    correctionToVerificationDays: number;
    /** 독립 확인 성공 후 유지 복습 자격까지의 최소 경과일 */
    confirmedToReviewDays: number;
    /** 자격 발생 후 이 일수를 초과하면 지연으로 표시 */
    delayedAfterDays: number;
    /** 자동 추천이 한 학습지에 담는 취약 유형 상한 */
    maxAutoSkills: number;
    /** 자동 추천 학습지 총 문항 범위 */
    minAutoTotalItems: number;
    maxAutoTotalItems: number;
    /** 역할별 제안 문항 수 */
    verificationItemCount: number;
    practiceItemCountMin: number;
    practiceItemCountMax: number;
    reviewItemCount: number;
    /** 자동 추천이 목표로 삼는 난이도 상한 (4단계는 교사 수동 전용) */
    maxAutoChallengeBand: ChallengeBand;
    /** practice/review 반복 방지 제외 기간 */
    recentExclusionDays: number;
    /** 교사 수동 모드 상한 */
    manualMaxItemsPerType: number;
    manualMaxTotalItems: number;
}

export const DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG: WorksheetRecommendationConfig = {
    correctionToVerificationDays: 2,
    confirmedToReviewDays: 14,
    delayedAfterDays: 30,
    maxAutoSkills: 2,
    minAutoTotalItems: 8,
    maxAutoTotalItems: 12,
    verificationItemCount: 2,
    practiceItemCountMin: 2,
    practiceItemCountMax: 3,
    reviewItemCount: 2,
    maxAutoChallengeBand: 3,
    recentExclusionDays: 30,
    manualMaxItemsPerType: 3,
    manualMaxTotalItems: 40,
};
