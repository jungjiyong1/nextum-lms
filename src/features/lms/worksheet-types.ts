export type WorksheetCartPurpose = 'verification' | 'practice' | 'review';

export type WorksheetCartItemState = 'eligible' | 'delayed' | 'locked';

export interface WorksheetCartProblem {
    problemId: string;
    challengeBand: number;
    pagePrinted: number | null;
    number: string | null;
    bookTitle: string | null;
    /** 짧은 만료의 서명 URL. 미리보기 전용이며 저장하지 않는다. */
    imageUrl: string | null;
}

export interface WorksheetCartWarning {
    code: string;
    detail: string;
}

export interface WorksheetCartItem {
    analysisSkillId: string;
    skillName: string;
    purpose: WorksheetCartPurpose;
    state: WorksheetCartItemState;
    eligibleAfter: string | null;
    daysUntilEligible: number | null;
    daysSinceEligible: number | null;
    suggestedChallengeBand: number;
    suggestedItemCount: number;
    basisSummary: string;
    /** 미풀이 문항 부족으로 확인을 제안할 수 없는 상태 */
    verificationBlocked: boolean;
    problems: WorksheetCartProblem[];
    alternates: WorksheetCartProblem[];
    warnings: WorksheetCartWarning[];
}

export interface WorksheetCartExcludedSkill {
    analysisSkillId: string;
    skillName: string;
    reason: 'insufficient_data' | 'content_gap';
}

export interface WorksheetCartConfigSummary {
    maxAutoSkills: number;
    minAutoTotalItems: number;
    maxAutoTotalItems: number;
    manualMaxTotalItems: number;
}

export interface WorksheetCart {
    studentId: string;
    studentName: string;
    asOf: string;
    seed: string;
    problemBankGranted: boolean;
    items: WorksheetCartItem[];
    excluded: WorksheetCartExcludedSkill[];
    config: WorksheetCartConfigSummary;
}

export interface WorksheetDraftSelectionChange {
    problemId: string;
    event: 'replaced' | 'removed';
    reasonCode?: string;
    reasonText?: string;
}

export interface WorksheetDraftSelectionInput {
    analysisSkillId: string;
    purpose: WorksheetCartPurpose;
    problemIds: string[];
    changeLog?: WorksheetDraftSelectionChange[];
}

export interface CreateWorksheetDraftInput {
    academyId: string;
    studentId: string;
    asOf: string;
    seed: string;
    selections: WorksheetDraftSelectionInput[];
}

export interface WorksheetDraftCreated {
    draftId: string;
    variantId: string;
    versionCode: string;
    itemCount: number;
}

export interface WorksheetRenderArtifact {
    kind: 'student_pdf' | 'answer_key' | 'zip';
    variantId: string | null;
    versionCode: string | null;
    pageCount: number | null;
    byteSize: number;
    /** 짧은 만료의 서명 URL (검수·인쇄용) */
    url: string | null;
}

export interface WorksheetRenderResult {
    draftId: string;
    status: 'ready';
    artifacts: WorksheetRenderArtifact[];
    warnings: string[];
}

export interface WorksheetPublishedVariant {
    variantId: string;
    assignmentId: string;
    versionCode: string;
}

export interface WorksheetPublishResult {
    draftId: string;
    published: WorksheetPublishedVariant[];
}

export interface ProblemBankGrantSummary {
    id: string;
    academyId: string;
    academyName: string;
    status: 'active' | 'revoked';
    note: string | null;
    grantedAt: string;
    revokedAt: string | null;
}

export interface ProblemBankGrantAcademyOption {
    academyId: string;
    academyName: string;
    granted: boolean;
}

export interface ProblemBankGrantOverview {
    grants: ProblemBankGrantSummary[];
    academies: ProblemBankGrantAcademyOption[];
}
