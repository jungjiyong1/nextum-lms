export const LEARNING_ANALYSIS_DRAFT_STORAGE_KEY = 'nextum:learning-analysis-assignment-draft:v1';

const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

export interface LearningAnalysisAssignmentDraft {
    version: 1;
    createdAt: string;
    title: string;
    actionIds: string[];
    studentIds: string[];
    skillNames: string[];
    actions: LearningAnalysisDraftAction[];
}

export interface LearningAnalysisDraftAction {
    id: string;
    studentId: string;
    skillId: string;
    skillName: string;
}

interface DraftStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function uniqueNonEmpty(values: readonly string[], maximum = MAX_ITEMS): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, maximum);
}

export function buildLearningAnalysisAssignmentDraft(
    actions: readonly LearningAnalysisDraftAction[],
    now = new Date(),
): LearningAnalysisAssignmentDraft {
    if (actions.length === 0) throw new Error('과제 초안으로 만들 조치 항목이 없습니다.');
    if (actions.length > MAX_ITEMS) throw new Error(`한 번에 최대 ${MAX_ITEMS}개 항목을 선택할 수 있습니다.`);

    const normalizedActions = actions.map((action) => ({
        id: action.id.trim(),
        studentId: action.studentId.trim(),
        skillId: action.skillId.trim(),
        skillName: action.skillName.trim(),
    }));
    if (normalizedActions.some((action) =>
        !action.id
        || !action.studentId
        || !action.skillId
        || !action.skillName
        || action.id !== `${action.studentId}::${action.skillId}`
    )) {
        throw new Error('선택한 조치 항목의 학생·유형 정보를 확인해 주세요.');
    }

    const actionsById = new Map(normalizedActions.map((action) => [action.id, action]));
    const uniqueActions = [...actionsById.values()];
    const actionIds = uniqueActions.map((action) => action.id);
    const studentIds = uniqueNonEmpty(uniqueActions.map((action) => action.studentId));
    const skillNames = uniqueNonEmpty(uniqueActions.map((action) => action.skillName), 50);

    const skillSetsByStudent = new Map<string, Set<string>>();
    for (const action of uniqueActions) {
        const skillIds = skillSetsByStudent.get(action.studentId) ?? new Set<string>();
        skillIds.add(action.skillId);
        skillSetsByStudent.set(action.studentId, skillIds);
    }
    const signatures = [...skillSetsByStudent.values()].map((skillIds) =>
        [...skillIds].sort().join('|'),
    );
    if (new Set(signatures).size > 1) {
        throw new Error('학생마다 필요한 유형이 다릅니다. 같은 유형 조합의 학생끼리 선택해 과제를 만들어 주세요.');
    }

    const title = skillNames.length === 1
        ? `${skillNames[0]} 확인 과제`
        : `학습 분석 확인 과제 (${skillNames.length}개 유형)`;

    return {
        version: 1,
        createdAt: now.toISOString(),
        title,
        actionIds,
        studentIds,
        skillNames,
        actions: uniqueActions,
    };
}

export function parseLearningAnalysisAssignmentDraft(
    value: string | null,
    now = new Date(),
): LearningAnalysisAssignmentDraft | null {
    if (!value) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const row = parsed as Record<string, unknown>;
    if (row.version !== 1 || typeof row.createdAt !== 'string' || typeof row.title !== 'string') {
        return null;
    }
    if (!Array.isArray(row.actions)) {
        return null;
    }
    const actions = row.actions.flatMap((item): LearningAnalysisDraftAction[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const action = item as Record<string, unknown>;
        if (
            typeof action.id !== 'string'
            || typeof action.studentId !== 'string'
            || typeof action.skillId !== 'string'
            || typeof action.skillName !== 'string'
        ) return [];
        return [{
            id: action.id,
            studentId: action.studentId,
            skillId: action.skillId,
            skillName: action.skillName,
        }];
    });
    if (actions.length !== row.actions.length) {
        return null;
    }

    const createdAt = new Date(row.createdAt);
    if (!Number.isFinite(createdAt.getTime())) return null;
    const age = now.getTime() - createdAt.getTime();
    if (age < -5 * 60 * 1000 || age > MAX_DRAFT_AGE_MS) return null;

    const title = row.title.trim().slice(0, 120);
    if (!title) return null;

    try {
        return {
            ...buildLearningAnalysisAssignmentDraft(actions, createdAt),
            title,
        };
    } catch {
        return null;
    }
}

export function saveLearningAnalysisAssignmentDraft(
    storage: DraftStorage,
    draft: LearningAnalysisAssignmentDraft,
): void {
    storage.setItem(LEARNING_ANALYSIS_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function readLearningAnalysisAssignmentDraft(
    storage: DraftStorage,
    now = new Date(),
): LearningAnalysisAssignmentDraft | null {
    const draft = parseLearningAnalysisAssignmentDraft(
        storage.getItem(LEARNING_ANALYSIS_DRAFT_STORAGE_KEY),
        now,
    );
    if (!draft) storage.removeItem(LEARNING_ANALYSIS_DRAFT_STORAGE_KEY);
    return draft;
}

export function clearLearningAnalysisAssignmentDraft(storage: DraftStorage): void {
    storage.removeItem(LEARNING_ANALYSIS_DRAFT_STORAGE_KEY);
}
