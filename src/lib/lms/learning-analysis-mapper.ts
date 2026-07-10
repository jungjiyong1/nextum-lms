import type {
    ChallengeBand,
    CreateLearningPlanInput,
    LearningActionQueueItem,
    LearningAnalysisData,
    LearningEvidenceCountSummary,
    LearningEvidenceEvent,
    LearningEvidenceOutcome,
    LearningEvidenceStatus,
    LearningTrackSummary,
    StudentExamEvidenceSummary,
    StudyTrackKind,
} from '@/features/lms/learning-analysis-types';
import {
    evaluateLearningEvidence,
    type EvaluatedProblemEvidenceObservation,
    type LearningEvidenceAttempt,
    type LearningEvidenceEvaluation,
    type LearningEvidenceKind,
    type LearningResponseState,
} from './learning-evidence';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAINTENANCE_INTERVALS = new Set([7, 14, 21, 30]);
const DEFAULT_RECHECK_INTERVAL_DAYS = 21;
const REQUIRED_EQUIVALENCE_COUNT = 2;

export interface AnalysisClassroomRow {
    id: string;
    name: string;
}

export interface AnalysisStudentRow {
    id: string;
    name: string;
    classIds: string[];
}

export interface AnalysisSkillRow {
    id: string;
    name: string;
    unitLabel: string;
    sortOrder: number;
}

export interface AnalysisMaterialRow {
    id: string;
    name: string;
    description: string | null;
}

export interface AnalysisPlanRow {
    id: string;
    classroomId: string;
    name: string;
    planType: 'study_track' | 'exam';
    trackKind: StudyTrackKind | null;
    targetBand: ChallengeBand;
    maintenanceIntervalDays: 7 | 14 | 21 | 30 | null;
    examDate: string | null;
    recheckIntervalDays: number | null;
    taxonomyRevisionId: string;
}

export interface AnalysisPlanScopeRow {
    planId: string;
    skillId: string;
    targetBand: ChallengeBand | null;
    sortOrder: number;
}

export interface AnalysisPlanMaterialRow {
    planId: string;
    bookId: string | null;
}

export interface AnalysisPlanStudentOverrideRow {
    planId: string;
    studentId: string;
    included: boolean;
    targetBand: ChallengeBand | null;
    maintenanceIntervalDays: 7 | 14 | 21 | 30 | null;
    recheckIntervalDays: number | null;
}

export interface AnalysisProblemTagRow {
    problemId: string;
    skillId: string;
    challengeBand: ChallengeBand | null;
    equivalenceKey: string | null;
}

export interface AnalysisAttemptRow {
    id: string;
    sessionId: string;
    studentId: string;
    problemId: string;
    subLabel: string | null;
    correct: boolean;
    unsure: boolean;
    responseState: LearningResponseState;
    evidenceKind: string;
    analysisEligible: boolean;
    submittedAt: string;
    skillId: string;
    challengeBand: ChallengeBand | null;
    equivalenceKey: string | null;
}

export interface AnalysisProblemRow {
    id: string;
    bookId: string | null;
    pagePrinted: number | null;
    number: string | null;
    expectedPartCount: number;
}

export interface AnalysisAssignedActionRow {
    actionId: string;
    assignedAt: string;
}

export interface LearningAnalysisSnapshot {
    asOfDate: string;
    selectedExamPlanId: string | null;
    classrooms: AnalysisClassroomRow[];
    students: AnalysisStudentRow[];
    skills: AnalysisSkillRow[];
    catalogSkillIds: string[];
    materials: AnalysisMaterialRow[];
    plans: AnalysisPlanRow[];
    scopes: AnalysisPlanScopeRow[];
    planMaterials: AnalysisPlanMaterialRow[];
    studentOverrides: AnalysisPlanStudentOverrideRow[];
    tags: AnalysisProblemTagRow[];
    attempts: AnalysisAttemptRow[];
    problems: AnalysisProblemRow[];
    assignedActions?: AnalysisAssignedActionRow[];
}

export interface NormalizedCreateLearningPlan {
    kind: 'current' | 'advance' | 'maintenance' | 'exam';
    classroomId: string;
    name: string;
    targetBand: ChallengeBand;
    examDate: string | null;
    maintenanceIntervalDays: 7 | 14 | 21 | 30 | null;
    scopeSkillIds: string[];
    materialBookIds: string[];
    studentOverrides: Array<{
        studentId: string;
        targetBand: ChallengeBand;
    }>;
}

export class LearningAnalysisValidationError extends Error {
    constructor(
        message: string,
        public readonly fieldErrors: Record<string, string[]> = {},
    ) {
        super(message);
        this.name = 'LearningAnalysisValidationError';
    }
}

interface CellEvaluation {
    plan: AnalysisPlanRow;
    student: AnalysisStudentRow;
    skill: AnalysisSkillRow;
    status: LearningEvidenceStatus;
    evaluation: LearningEvidenceEvaluation;
    events: LearningEvidenceEvent[];
    dueAt: string | null;
    reason: string;
    lastEvidenceAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: string): boolean {
    return UUID_PATTERN.test(value);
}

function isChallengeBand(value: unknown): value is ChallengeBand {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4;
}

function validDateOnly(value: string): boolean {
    if (!DATE_ONLY_PATTERN.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function uniqueUuidArray(value: unknown, fieldName: string, maximum: number): string[] {
    if (!Array.isArray(value)) {
        throw new LearningAnalysisValidationError(`${fieldName} 목록이 올바르지 않습니다.`, {
            [fieldName]: ['목록 형식이어야 합니다.'],
        });
    }
    const normalized = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : ''))];
    if (normalized.some((item) => !isUuid(item))) {
        throw new LearningAnalysisValidationError(`${fieldName}에 올바르지 않은 ID가 있습니다.`, {
            [fieldName]: ['모든 값이 UUID여야 합니다.'],
        });
    }
    if (normalized.length > maximum) {
        throw new LearningAnalysisValidationError(`${fieldName}은 최대 ${maximum}개까지 선택할 수 있습니다.`, {
            [fieldName]: [`최대 ${maximum}개까지 선택할 수 있습니다.`],
        });
    }
    return normalized;
}

function normalizeStudentOverrides(value: unknown): NormalizedCreateLearningPlan['studentOverrides'] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 1000) {
        throw new LearningAnalysisValidationError('학생별 목표 예외 목록이 올바르지 않습니다.', {
            studentOverrides: ['최대 1,000개의 목록 형식이어야 합니다.'],
        });
    }

    const byStudent = new Map<string, { studentId: string; targetBand: ChallengeBand }>();
    for (const item of value) {
        if (!isRecord(item)) {
            throw new LearningAnalysisValidationError('학생별 목표 예외를 확인해 주세요.', {
                studentOverrides: ['각 항목은 학생과 목표 단계가 필요합니다.'],
            });
        }
        const studentId = typeof item.studentId === 'string' ? item.studentId.trim() : '';
        if (!isUuid(studentId) || !isChallengeBand(item.targetBand)) {
            throw new LearningAnalysisValidationError('학생별 목표 예외를 확인해 주세요.', {
                studentOverrides: ['학생 ID와 1~4 목표 단계가 필요합니다.'],
            });
        }
        if (byStudent.has(studentId)) {
            throw new LearningAnalysisValidationError('한 학생의 목표 예외가 중복되었습니다.', {
                studentOverrides: ['학생별로 하나의 목표 단계만 선택해 주세요.'],
            });
        }
        byStudent.set(studentId, { studentId, targetBand: item.targetBand });
    }
    return [...byStudent.values()];
}

export function normalizeCreateLearningPlanInput(
    value: unknown,
    today: string,
): NormalizedCreateLearningPlan {
    if (!validDateOnly(today)) throw new Error('today must use YYYY-MM-DD');
    if (!isRecord(value)) {
        throw new LearningAnalysisValidationError('학습 계획 입력값이 올바르지 않습니다.');
    }

    const kind = value.kind;
    if (kind !== 'current' && kind !== 'advance' && kind !== 'maintenance' && kind !== 'exam') {
        throw new LearningAnalysisValidationError('계획 종류를 확인해 주세요.', {
            kind: ['현행, 선행, 유지 복습, 시험 중 하나여야 합니다.'],
        });
    }
    const classroomId = typeof value.classroomId === 'string' ? value.classroomId.trim() : '';
    if (!isUuid(classroomId)) {
        throw new LearningAnalysisValidationError('반을 다시 선택해 주세요.', {
            classroomId: ['올바른 반을 선택해 주세요.'],
        });
    }
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 120) {
        throw new LearningAnalysisValidationError('계획 이름은 1~120자로 입력해 주세요.', {
            name: ['계획 이름은 1~120자여야 합니다.'],
        });
    }
    if (!isChallengeBand(value.targetBand)) {
        throw new LearningAnalysisValidationError('목표 도전 단계를 확인해 주세요.', {
            targetBand: ['1~4 중 하나여야 합니다.'],
        });
    }

    const scopeSkillIds = uniqueUuidArray(value.scopeSkillIds, 'scopeSkillIds', 500);
    if (scopeSkillIds.length === 0) {
        throw new LearningAnalysisValidationError('범위 유형을 하나 이상 선택해 주세요.', {
            scopeSkillIds: ['하나 이상의 공통 유형이 필요합니다.'],
        });
    }
    const materialBookIds = uniqueUuidArray(value.materialBookIds ?? [], 'materialBookIds', 100);
    const studentOverrides = normalizeStudentOverrides(value.studentOverrides);

    let examDate: string | null = null;
    let maintenanceIntervalDays: 7 | 14 | 21 | 30 | null = null;
    if (kind === 'exam') {
        examDate = typeof value.examDate === 'string' ? value.examDate.trim() : '';
        if (!validDateOnly(examDate) || examDate < today) {
            throw new LearningAnalysisValidationError('시험일은 오늘 이후의 날짜로 입력해 주세요.', {
                examDate: ['오늘 이후의 올바른 날짜가 필요합니다.'],
            });
        }
    } else {
        const interval = Number(value.maintenanceIntervalDays);
        if (!MAINTENANCE_INTERVALS.has(interval)) {
            throw new LearningAnalysisValidationError('유지 확인 주기를 확인해 주세요.', {
                maintenanceIntervalDays: ['7일, 14일, 21일, 30일 중 하나여야 합니다.'],
            });
        }
        maintenanceIntervalDays = interval as 7 | 14 | 21 | 30;
    }

    return {
        kind,
        classroomId,
        name,
        targetBand: value.targetBand,
        examDate,
        maintenanceIntervalDays,
        scopeSkillIds,
        materialBookIds,
        studentOverrides,
    };
}

export function toSeoulDate(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((candidate) => candidate.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizeEvidenceKind(value: string): {
    kind: LearningEvidenceKind;
    eligibleOverride: boolean | null;
} {
    if (value === 'independent_new'
        || value === 'independent_same_delayed'
        || value === 'correction'
        || value === 'review'
        || value === 'guided') {
        return { kind: value, eligibleOverride: null };
    }
    if (value === 'legacy_qualified') {
        return { kind: 'independent_same_delayed', eligibleOverride: true };
    }
    return { kind: 'review', eligibleOverride: false };
}

function rowKey(...values: string[]): string {
    return values.join('::');
}

function maximumDate(values: Array<string | null | undefined>): string | null {
    const dates = values.filter((value): value is string => Boolean(value));
    return dates.length ? dates.sort().at(-1) ?? null : null;
}

function earliestDate(values: Array<string | null | undefined>): string | null {
    const dates = values.filter((value): value is string => Boolean(value));
    return dates.length ? dates.sort()[0] ?? null : null;
}

function evidenceKindLabel(kind: string): string {
    const labels: Record<string, string> = {
        independent_new: '새 문항 독립 풀이',
        independent_same_delayed: '지연 재인출',
        correction: '교정 풀이',
        review: '복습 풀이',
        guided: '도움받은 풀이',
        legacy_qualified: '이전 독립 풀이',
        legacy_ambiguous: '이전 문맥 불명확',
    };
    return labels[kind] ?? '기타 풀이';
}

function exclusionReason(observation: EvaluatedProblemEvidenceObservation): string {
    if (observation.readinessOutcome !== 'not_eligible') {
        return '목표 단계의 독립 풀이 근거에 반영했습니다.';
    }
    if (observation.evidenceKind === 'independent_same_delayed'
        && observation.analysisEligible
        && observation.trendScore !== null) {
        return '준비 확인에는 제외하고 학습 추세에만 반영했습니다.';
    }
    const reasons: Record<string, string> = {
        future_observation: '조회 기준일 이후의 기록이라 제외했습니다.',
        challenge_band_mismatch: '계획의 목표 도전 단계와 달라 제외했습니다.',
        analysis_excluded: '교정·복습 등 독립 확인이 아닌 풀이여서 제외했습니다.',
        blank: '미응답은 실력 분석에서 제외했습니다.',
        not_independent_new: '새 문항 독립 풀이가 아니어서 준비 확인에서 제외했습니다.',
        uncertain_or_incomplete: '확신이 없거나 소문항 풀이가 완전하지 않아 확인 근거에서 제외했습니다.',
    };
    return observation.readinessExclusionReason
        ? reasons[observation.readinessExclusionReason] ?? '분석 기준에 맞지 않아 제외했습니다.'
        : '분석 기준에 맞지 않아 제외했습니다.';
}

function eventOutcome(rows: AnalysisAttemptRow[], observation: EvaluatedProblemEvidenceObservation): LearningEvidenceOutcome {
    const nonBlank = rows.filter((row) => row.responseState !== 'blank');
    if (nonBlank.length === 0) return 'blank';
    if (observation.responseOutcome === 'confident_full_correct') return 'correct';
    const correctCount = nonBlank.filter((row) => row.responseState === 'answered' && row.correct).length;
    if (correctCount > 0) return 'partial';
    if (nonBlank.every((row) => row.responseState === 'unknown')) return 'unknown';
    return 'incorrect';
}

function dedupeEvents(events: LearningEvidenceEvent[]): LearningEvidenceEvent[] {
    const byId = new Map<string, LearningEvidenceEvent>();
    for (const event of events) byId.set(event.id, event);
    return [...byId.values()].sort(
        (left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id),
    );
}

function toEvidenceAttempts(
    rows: AnalysisAttemptRow[],
    problemById: ReadonlyMap<string, AnalysisProblemRow>,
): {
    attempts: LearningEvidenceAttempt[];
    rowsByObservation: Map<string, AnalysisAttemptRow[]>;
} {
    const validRows = rows.filter((row) =>
        isChallengeBand(row.challengeBand)
        && Boolean(row.equivalenceKey?.trim())
        && Number.isFinite(new Date(row.submittedAt).getTime()),
    );
    const rowsByObservation = new Map<string, AnalysisAttemptRow[]>();
    for (const row of validRows) {
        const observationId = rowKey(row.sessionId, row.problemId);
        const grouped = rowsByObservation.get(observationId) ?? [];
        grouped.push(row);
        rowsByObservation.set(observationId, grouped);
    }

    const attempts: LearningEvidenceAttempt[] = [];
    for (const [observationId, grouped] of rowsByObservation) {
        const recordedPartCount = new Set(grouped.map((row) => row.subLabel ?? '__whole__')).size;
        const expectedPartCount = Math.max(
            recordedPartCount,
            problemById.get(grouped[0]?.problemId ?? '')?.expectedPartCount ?? recordedPartCount,
        );
        for (const row of grouped) {
            const normalizedKind = normalizeEvidenceKind(row.evidenceKind);
            attempts.push({
                observationId,
                problemId: row.problemId,
                equivalenceKey: row.equivalenceKey as string,
                observedOn: toSeoulDate(row.submittedAt),
                challengeBand: row.challengeBand as ChallengeBand,
                evidenceKind: normalizedKind.kind,
                analysisEligible: normalizedKind.eligibleOverride ?? row.analysisEligible,
                expectedPartCount,
                partKey: row.subLabel ?? '__whole__',
                responseState: row.responseState,
                correct: row.correct,
                unsure: row.unsure,
            });
        }
    }
    return { attempts, rowsByObservation };
}

function statusForEvaluation(evaluation: LearningEvidenceEvaluation): LearningEvidenceStatus {
    if (evaluation.content.status === 'content_gap') return 'content_gap';
    if (evaluation.readiness.status === 'support_candidate') return 'support_candidate';
    if (evaluation.readiness.status === 'recent_confirmed' && !evaluation.readiness.verificationDue) {
        return 'recently_confirmed';
    }
    return 'needs_check';
}

function actionReason(status: LearningEvidenceStatus, evaluation: LearningEvidenceEvaluation): string {
    if (status === 'support_candidate') {
        return '서로 다른 독립 풀이에서 연속 어려움이 관찰되어 지원 검토가 필요합니다.';
    }
    if (evaluation.readiness.verificationDue) return '유지 확인 주기가 지나 새 문항 확인이 필요합니다.';
    if (evaluation.trend.direction === 'improving') {
        return '처음보다 최근 독립 풀이가 나아졌지만 확인 근거가 더 필요합니다.';
    }
    if (evaluation.readiness.status === 'unassessed') return '목표 단계의 독립 풀이 근거가 아직 없습니다.';
    return '독립 풀이 근거가 한 번뿐이거나 결과가 엇갈려 추가 확인이 필요합니다.';
}

function summaryFromStatuses(statuses: LearningEvidenceStatus[], scope: number): LearningEvidenceCountSummary {
    return {
        scope,
        analyzable: statuses.filter((status) => status !== 'content_gap').length,
        recentlyConfirmed: statuses.filter((status) => status === 'recently_confirmed').length,
        needsCheck: statuses.filter((status) => status === 'needs_check').length,
        supportCandidate: statuses.filter((status) => status === 'support_candidate').length,
        contentGap: statuses.filter((status) => status === 'content_gap').length,
    };
}

function overallStudentStatus(statuses: LearningEvidenceStatus[]): LearningEvidenceStatus {
    if (statuses.includes('support_candidate')) return 'support_candidate';
    if (statuses.includes('needs_check')) return 'needs_check';
    if (statuses.includes('recently_confirmed')) return 'recently_confirmed';
    return 'content_gap';
}

function trackKind(plan: AnalysisPlanRow): StudyTrackKind {
    return plan.trackKind === 'advance' || plan.trackKind === 'maintenance' ? plan.trackKind : 'current';
}

export function buildLearningAnalysisData(snapshot: LearningAnalysisSnapshot): LearningAnalysisData {
    if (!validDateOnly(snapshot.asOfDate)) throw new Error('asOfDate must use YYYY-MM-DD');

    const classroomById = new Map(snapshot.classrooms.map((row) => [row.id, row]));
    const skillById = new Map(snapshot.skills.map((row) => [row.id, row]));
    const problemById = new Map(snapshot.problems.map((row) => [row.id, row]));
    const materialById = new Map(snapshot.materials.map((row) => [row.id, row]));
    const scopesByPlan = new Map<string, AnalysisPlanScopeRow[]>();
    const materialsByPlan = new Map<string, AnalysisPlanMaterialRow[]>();
    const overridesByPlanStudent = new Map<string, AnalysisPlanStudentOverrideRow>();
    const attemptsByStudentSkill = new Map<string, AnalysisAttemptRow[]>();
    const equivalenceBySkillBand = new Map<string, Set<string>>();
    const assignedAtByAction = new Map<string, string>();

    for (const marker of snapshot.assignedActions ?? []) {
        if (!marker.actionId || !Number.isFinite(new Date(marker.assignedAt).getTime())) continue;
        const current = assignedAtByAction.get(marker.actionId);
        if (!current || new Date(marker.assignedAt).getTime() > new Date(current).getTime()) {
            assignedAtByAction.set(marker.actionId, marker.assignedAt);
        }
    }

    for (const scope of snapshot.scopes) {
        const rows = scopesByPlan.get(scope.planId) ?? [];
        rows.push(scope);
        scopesByPlan.set(scope.planId, rows);
    }
    for (const material of snapshot.planMaterials) {
        const rows = materialsByPlan.get(material.planId) ?? [];
        rows.push(material);
        materialsByPlan.set(material.planId, rows);
    }
    for (const override of snapshot.studentOverrides) {
        overridesByPlanStudent.set(rowKey(override.planId, override.studentId), override);
    }
    for (const attempt of snapshot.attempts) {
        const key = rowKey(attempt.studentId, attempt.skillId);
        const rows = attemptsByStudentSkill.get(key) ?? [];
        rows.push(attempt);
        attemptsByStudentSkill.set(key, rows);
    }
    for (const tag of snapshot.tags) {
        if (!isChallengeBand(tag.challengeBand) || !tag.equivalenceKey?.trim()) continue;
        const key = rowKey(tag.skillId, String(tag.challengeBand));
        const values = equivalenceBySkillBand.get(key) ?? new Set<string>();
        values.add(tag.equivalenceKey);
        equivalenceBySkillBand.set(key, values);
    }

    const cellByPlan = new Map<string, CellEvaluation[]>();
    const allCells: CellEvaluation[] = [];
    for (const plan of snapshot.plans) {
        const classroom = classroomById.get(plan.classroomId);
        if (!classroom) continue;
        const scopes = (scopesByPlan.get(plan.id) ?? [])
            .filter((scope) => skillById.has(scope.skillId))
            .sort((left, right) => left.sortOrder - right.sortOrder || left.skillId.localeCompare(right.skillId));
        const students = snapshot.students.filter((student) => student.classIds.includes(plan.classroomId));
        const planCells: CellEvaluation[] = [];

        for (const student of students) {
            const override = overridesByPlanStudent.get(rowKey(plan.id, student.id));
            if (override?.included === false) continue;
            for (const scope of scopes) {
                const skill = skillById.get(scope.skillId);
                if (!skill) continue;
                const targetBand = override?.targetBand ?? scope.targetBand ?? plan.targetBand;
                const interval = plan.planType === 'exam'
                    ? override?.recheckIntervalDays ?? plan.recheckIntervalDays ?? DEFAULT_RECHECK_INTERVAL_DAYS
                    : override?.maintenanceIntervalDays
                        ?? plan.maintenanceIntervalDays
                        ?? DEFAULT_RECHECK_INTERVAL_DAYS;
                const sourceRows = attemptsByStudentSkill.get(rowKey(student.id, skill.id)) ?? [];
                const converted = toEvidenceAttempts(sourceRows, problemById);
                const approvedDistinctEquivalenceCount = equivalenceBySkillBand
                    .get(rowKey(skill.id, String(targetBand)))?.size ?? 0;
                const evaluation = evaluateLearningEvidence({
                    attempts: converted.attempts,
                    targetChallengeBand: targetBand,
                    asOf: snapshot.asOfDate,
                    verificationIntervalDays: interval,
                    content: {
                        approvedDistinctEquivalenceCount,
                        requiredDistinctEquivalenceCount: REQUIRED_EQUIVALENCE_COUNT,
                    },
                });
                const events = evaluation.observations.map((observation): LearningEvidenceEvent => {
                    const rows = converted.rowsByObservation.get(observation.observationId) ?? [];
                    const first = rows[0];
                    const problem = first ? problemById.get(first.problemId) : null;
                    const material = problem?.bookId ? materialById.get(problem.bookId) : null;
                    const included = observation.readinessOutcome !== 'not_eligible'
                        || (observation.evidenceKind === 'independent_same_delayed'
                            && observation.analysisEligible
                            && observation.trendScore !== null);
                    const occurredAt = maximumDate(rows.map((row) => row.submittedAt))
                        ?? `${observation.observedOn}T00:00:00+09:00`;
                    const labelParts = [
                        problem?.pagePrinted != null ? `p.${problem.pagePrinted}` : null,
                        problem?.number ? `${problem.number}번` : null,
                    ].filter(Boolean);
                    return {
                        id: observation.observationId,
                        problemId: observation.problemId,
                        problemLabel: labelParts.join(' ') || `문제 ${observation.problemId.slice(0, 8)}`,
                        skillName: skill.name,
                        occurredAt,
                        sourceLabel: material?.name ?? 'Grade App',
                        outcome: eventOutcome(rows, observation),
                        included,
                        reason: exclusionReason(observation),
                        challengeBand: observation.challengeBand,
                        evidenceKindLabel: first ? evidenceKindLabel(first.evidenceKind) : null,
                    };
                });
                const status = statusForEvaluation(evaluation);
                const dueAt = status === 'needs_check' || status === 'support_candidate'
                    ? evaluation.readiness.verificationDueOn
                        ?? (plan.planType === 'exam' ? plan.examDate : snapshot.asOfDate)
                    : null;
                const cell: CellEvaluation = {
                    plan,
                    student,
                    skill,
                    status,
                    evaluation,
                    events: dedupeEvents(events),
                    dueAt,
                    reason: actionReason(status, evaluation),
                    lastEvidenceAt: maximumDate(events.map((event) => event.occurredAt)),
                };
                planCells.push(cell);
                allCells.push(cell);
            }
        }
        cellByPlan.set(plan.id, planCells);
    }

    const isSuppressedByAssignment = (actionId: string, events: LearningEvidenceEvent[]): boolean => {
        const assignedAt = assignedAtByAction.get(actionId);
        if (!assignedAt) return false;
        const latestIncludedEvidenceAt = maximumDate(
            events.filter((event) => event.included).map((event) => event.occurredAt),
        );
        return latestIncludedEvidenceAt === null
            || new Date(latestIncludedEvidenceAt).getTime() <= new Date(assignedAt).getTime();
    };

    const tracks: LearningTrackSummary[] = snapshot.plans
        .filter((plan) => plan.planType === 'study_track')
        .map((plan) => {
            const cells = cellByPlan.get(plan.id) ?? [];
            const actionCells = cells.filter((cell) =>
                (cell.status === 'needs_check' || cell.status === 'support_candidate')
                && !isSuppressedByAssignment(rowKey(cell.student.id, cell.skill.id), cell.events),
            );
            return {
                id: plan.id,
                kind: trackKind(plan),
                classroomId: plan.classroomId,
                classroomName: classroomById.get(plan.classroomId)?.name ?? '알 수 없는 반',
                name: plan.name,
                targetBand: plan.targetBand,
                maintenanceIntervalDays: plan.maintenanceIntervalDays ?? 21,
                scopeSkillCount: (scopesByPlan.get(plan.id) ?? []).length,
                materialCount: (materialsByPlan.get(plan.id) ?? []).length,
                dueStudentCount: new Set(actionCells.map((cell) => cell.student.id)).size,
                actionCount: actionCells.length,
                lastEvidenceAt: maximumDate(cells.map((cell) => cell.lastEvidenceAt)),
            };
        })
        .sort((left, right) => left.classroomName.localeCompare(right.classroomName, 'ko') || left.name.localeCompare(right.name, 'ko'));

    const actionMap = new Map<string, {
        status: 'needs_check' | 'support_candidate';
        student: AnalysisStudentRow;
        skill: AnalysisSkillRow;
        classroomNames: Set<string>;
        planNames: Set<string>;
        dueDates: string[];
        events: LearningEvidenceEvent[];
        reasons: string[];
    }>();
    for (const cell of allCells) {
        if (cell.status !== 'needs_check' && cell.status !== 'support_candidate') continue;
        const key = rowKey(cell.student.id, cell.skill.id);
        const current = actionMap.get(key) ?? {
            status: 'needs_check' as const,
            student: cell.student,
            skill: cell.skill,
            classroomNames: new Set<string>(),
            planNames: new Set<string>(),
            dueDates: [],
            events: [],
            reasons: [],
        };
        if (cell.status === 'support_candidate') current.status = 'support_candidate';
        current.classroomNames.add(classroomById.get(cell.plan.classroomId)?.name ?? '알 수 없는 반');
        current.planNames.add(cell.plan.name);
        if (cell.dueAt) current.dueDates.push(cell.dueAt);
        current.events.push(...cell.events);
        current.reasons.push(cell.reason);
        actionMap.set(key, current);
    }
    const actionQueue: LearningActionQueueItem[] = [...actionMap.entries()].map(([id, item]) => ({
        id,
        studentId: item.student.id,
        studentName: item.student.name,
        classroomName: [...item.classroomNames].sort((a, b) => a.localeCompare(b, 'ko')).join(' · '),
        skillId: item.skill.id,
        skillName: item.skill.name,
        status: item.status,
        relatedPlanNames: [...item.planNames].sort((a, b) => a.localeCompare(b, 'ko')),
        reason: item.status === 'support_candidate'
            ? '여러 계획에서 확인된 근거를 합쳐 지원 후보로 표시했습니다.'
            : item.reasons[0] ?? '추가 확인이 필요합니다.',
        dueAt: earliestDate(item.dueDates),
        evidence: dedupeEvents(item.events),
    })).filter((item) => !isSuppressedByAssignment(item.id, item.evidence)).sort((left, right) => {
        const severity = Number(right.status === 'support_candidate') - Number(left.status === 'support_candidate');
        return severity || (left.dueAt ?? '9999-12-31').localeCompare(right.dueAt ?? '9999-12-31')
            || left.studentName.localeCompare(right.studentName, 'ko');
    });

    const examPlans = snapshot.plans
        .filter((plan) => plan.planType === 'exam' && plan.examDate)
        .map((plan) => {
            const scopes = scopesByPlan.get(plan.id) ?? [];
            const cells = cellByPlan.get(plan.id) ?? [];
            const statuses = scopes.map((scope): LearningEvidenceStatus => {
                const targetBand = scope.targetBand ?? plan.targetBand;
                const coverage = equivalenceBySkillBand.get(rowKey(scope.skillId, String(targetBand)))?.size ?? 0;
                if (coverage < REQUIRED_EQUIVALENCE_COUNT) return 'content_gap';
                const skillStatuses = cells.filter((cell) => cell.skill.id === scope.skillId).map((cell) => cell.status);
                if (skillStatuses.includes('support_candidate')) return 'support_candidate';
                if (skillStatuses.includes('needs_check') || skillStatuses.length === 0) return 'needs_check';
                return 'recently_confirmed';
            });
            return {
                id: plan.id,
                classroomId: plan.classroomId,
                classroomName: classroomById.get(plan.classroomId)?.name ?? '알 수 없는 반',
                name: plan.name,
                examDate: plan.examDate as string,
                targetBand: plan.targetBand,
                summary: summaryFromStatuses(statuses, scopes.length),
            };
        })
        .sort((left, right) => left.examDate.localeCompare(right.examDate) || left.name.localeCompare(right.name, 'ko'));

    const selectedPlan = snapshot.plans.find((plan) =>
        plan.id === snapshot.selectedExamPlanId && plan.planType === 'exam',
    );
    const examStudents: StudentExamEvidenceSummary[] = selectedPlan
        ? snapshot.students
            .filter((student) => student.classIds.includes(selectedPlan.classroomId))
            .filter((student) => overridesByPlanStudent.get(rowKey(selectedPlan.id, student.id))?.included !== false)
            .map((student) => {
                const cells = (cellByPlan.get(selectedPlan.id) ?? []).filter((cell) => cell.student.id === student.id);
                const statuses = cells.map((cell) => cell.status);
                const summary = summaryFromStatuses(statuses, statuses.length);
                return {
                    studentId: student.id,
                    studentName: student.name,
                    status: overallStudentStatus(statuses),
                    summary: {
                        analyzable: summary.analyzable,
                        recentlyConfirmed: summary.recentlyConfirmed,
                        needsCheck: summary.needsCheck,
                        supportCandidate: summary.supportCandidate,
                        contentGap: summary.contentGap,
                    },
                    lastEvidenceAt: maximumDate(cells.map((cell) => cell.lastEvidenceAt)),
                    evidence: dedupeEvents(cells.flatMap((cell) => cell.events)),
                };
            })
            .sort((left, right) => left.studentName.localeCompare(right.studentName, 'ko'))
        : [];

    return {
        catalog: {
            classrooms: snapshot.classrooms
                .map(({ id, name }) => ({ id, name }))
                .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
            students: snapshot.students
                .map(({ id, name, classIds }) => ({ id, name, classroomIds: classIds }))
                .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
            skills: snapshot.skills
                .filter((skill) => snapshot.catalogSkillIds.includes(skill.id))
                .map(({ id, name, unitLabel }) => ({ id, name, unitLabel }))
                .sort((left, right) => {
                    const leftOrder = skillById.get(left.id)?.sortOrder ?? 0;
                    const rightOrder = skillById.get(right.id)?.sortOrder ?? 0;
                    return leftOrder - rightOrder || left.name.localeCompare(right.name, 'ko');
                }),
            materials: snapshot.materials
                .map(({ id, name, description }) => ({ id, name, description }))
                .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
        },
        tracks,
        actionQueue,
        examPlans,
        examStudents,
    };
}

export function toCreatePlanContract(input: NormalizedCreateLearningPlan): Record<string, unknown> {
    const planType = input.kind === 'exam' ? 'exam' : 'study_track';
    return {
        class_id: input.classroomId,
        plan_type: planType,
        track_kind: input.kind === 'exam' ? null : input.kind,
        name: input.name,
        target_challenge_band: input.targetBand,
        exam_date: input.examDate,
        maintenance_interval_days: input.maintenanceIntervalDays,
        recheck_interval_days: input.kind === 'exam' ? DEFAULT_RECHECK_INTERVAL_DAYS : null,
        scope_skill_ids: input.scopeSkillIds,
        material_book_ids: input.materialBookIds,
        student_overrides: input.studentOverrides.map((override) => ({
            student_id: override.studentId,
            target_challenge_band: override.targetBand,
        })),
    };
}

export type { CreateLearningPlanInput };
