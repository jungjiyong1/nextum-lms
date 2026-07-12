import 'server-only';

import type {
    ChallengeBand,
    LearningAnalysisData,
} from '@/features/lms/learning-analysis-types';
import { createAdminClient } from '@/lib/supabase/admin';
import { requiresAssignedClassScope } from '@/core/auth/roles';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { loadAssignedClassIdsForContext } from './class-queries';
import {
    buildLearningAnalysisData,
    isUuid,
    LearningAnalysisValidationError,
    normalizeCreateLearningPlanInput,
    toCreatePlanContract,
    toSeoulDate,
    type AnalysisAssignedActionRow,
    type AnalysisAttemptRow,
    type AnalysisPlanMaterialRow,
    type AnalysisPlanRow,
    type AnalysisPlanScopeRow,
    type AnalysisPlanStudentOverrideRow,
    type AnalysisProblemRow,
    type AnalysisProblemTagRow,
    type AnalysisSkillRow,
} from './learning-analysis-mapper';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;
type QueryError = { code?: string; message?: string; details?: string; hint?: string } | null;
type PagedResult = PromiseLike<{ data: unknown[] | null; error: QueryError }>;

const PAGE_SIZE = 1000;
const FILTER_CHUNK_SIZE = 50;

function ensureNoError(error: QueryError, context: string): void {
    if (error) throw new Error(`${context}: ${error.message ?? '알 수 없는 데이터베이스 오류'}`);
}

function chunks<T>(values: readonly T[], size = FILTER_CHUNK_SIZE): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function loadPagedRows(
    query: (from: number, to: number) => PagedResult,
    context: string,
): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await query(from, from + PAGE_SIZE - 1);
        ensureNoError(error, context);
        const page = (data ?? []) as Row[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
    }
}

async function loadRowsForChunks(
    values: readonly string[],
    query: (ids: string[], from: number, to: number) => PagedResult,
    context: string,
): Promise<Row[]> {
    const pages = await Promise.all(chunks(values).map((ids) =>
        loadPagedRows((from, to) => query(ids, from, to), context),
    ));
    return pages.flat();
}

function challengeBand(value: unknown): ChallengeBand | null {
    const band = Number(value);
    return Number.isInteger(band) && band >= 1 && band <= 4 ? band as ChallengeBand : null;
}

function maintenanceInterval(value: unknown): 7 | 14 | 21 | 30 | null {
    const interval = Number(value);
    return interval === 7 || interval === 14 || interval === 21 || interval === 30
        ? interval
        : null;
}

function trackKind(value: unknown): 'current' | 'advance' | 'maintenance' | null {
    return value === 'advance' || value === 'maintenance' || value === 'current' ? value : null;
}

function expectedPartCount(answerKey: unknown): number {
    if (!answerKey || typeof answerKey !== 'object' || Array.isArray(answerKey)) return 1;
    const subs = (answerKey as Row).subs;
    return Array.isArray(subs) && subs.length > 0 ? subs.length : 1;
}

async function loadAccessibleClasses(
    core: SchemaClient,
    context: LmsRoleContext,
): Promise<Row[]> {
    const allowedClassIds = await loadAssignedClassIdsForContext(context);
    if (allowedClassIds && allowedClassIds.size === 0) return [];
    const allowed = allowedClassIds ? [...allowedClassIds] : null;
    return loadPagedRows((from, to) => {
        let query = core
            .from('classes')
            .select('id,name')
            .eq('academy_id', context.academyId)
            .eq('active', true)
            .order('id')
            .range(from, to);
        if (allowed) query = query.in('id', allowed);
        return query;
    }, '접근 가능한 반을 불러오지 못했습니다');
}

async function loadLatestPublishedRevision(content: SchemaClient): Promise<string | null> {
    const { data, error } = await content
        .from('analysis_taxonomy_revisions')
        .select('id')
        .eq('status', 'published')
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();
    ensureNoError(error, '공통 유형 버전을 불러오지 못했습니다');
    return typeof (data as Row | null)?.id === 'string' ? (data as Row).id : null;
}

async function loadCatalogSkills(
    content: SchemaClient,
    academyId: string,
    revisionId: string | null,
): Promise<AnalysisSkillRow[]> {
    if (!revisionId) return [];
    const rows = await loadPagedRows((from, to) => content
        .from('analysis_skills')
        .select('id,name,subject,grade,semester,unit_name,sort_order')
        .eq('taxonomy_revision_id', revisionId)
        .eq('active', true)
        .order('sort_order')
        .order('id')
        .range(from, to), '공통 유형을 불러오지 못했습니다');
    if (rows.length === 0) return [];

    const aliases = await loadRowsForChunks(rows.map((row) => String(row.id)), (ids, from, to) => content
        .from('analysis_skill_aliases')
        .select('analysis_skill_id,alias_name')
        .eq('academy_id', academyId)
        .eq('alias_kind', 'display')
        .in('analysis_skill_id', ids)
        .order('analysis_skill_id')
        .range(from, to), '공통 유형 별칭을 불러오지 못했습니다');
    const aliasBySkill = new Map(aliases.map((row) => [String(row.analysis_skill_id), String(row.alias_name)]));

    return rows.map((row) => {
        const labels = [row.subject, row.grade, row.semester ? `${row.semester}학기` : null, row.unit_name]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        return {
            id: String(row.id),
            name: aliasBySkill.get(String(row.id)) ?? String(row.name),
            unitLabel: labels.join(' · '),
            sortOrder: Number(row.sort_order ?? 0),
        };
    });
}

async function loadCatalogMaterials(content: SchemaClient, academyId: string) {
    const rows = await loadPagedRows((from, to) => content
        .from('books')
        .select('id,title,subject,grade')
        .or(`academy_id.is.null,academy_id.eq.${academyId}`)
        .order('title')
        .order('id')
        .range(from, to), '교재 목록을 불러오지 못했습니다');
    return rows.map((row) => ({
        id: String(row.id),
        name: String(row.title),
        description: [row.subject, row.grade]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .join(' · ') || null,
    }));
}

async function loadStudents(core: SchemaClient, classIds: string[]) {
    if (classIds.length === 0) return [];
    const enrollments = await loadRowsForChunks(classIds, (ids, from, to) => core
        .from('class_students')
        .select('class_id,student_id')
        .eq('status', 'active')
        .in('class_id', ids)
        .order('class_id')
        .order('student_id')
        .range(from, to), '반 학생 연결을 불러오지 못했습니다');
    const studentIds = uniqueStrings(enrollments.map((row) => row.student_id));
    if (studentIds.length === 0) return [];
    const students = await loadRowsForChunks(studentIds, (ids, from, to) => core
        .from('students')
        .select('id,person_id')
        .eq('status', 'active')
        .in('id', ids)
        .order('id')
        .range(from, to), '학생을 불러오지 못했습니다');
    const personIds = uniqueStrings(students.map((row) => row.person_id));
    const people = personIds.length
        ? await loadRowsForChunks(personIds, (ids, from, to) => core
            .from('people')
            .select('id,full_name,display_name')
            .in('id', ids)
            .order('id')
            .range(from, to), '학생 이름을 불러오지 못했습니다')
        : [];
    const personById = new Map(people.map((row) => [String(row.id), row]));
    const classesByStudent = new Map<string, string[]>();
    for (const enrollment of enrollments) {
        const studentId = String(enrollment.student_id);
        const values = classesByStudent.get(studentId) ?? [];
        values.push(String(enrollment.class_id));
        classesByStudent.set(studentId, values);
    }
    return students.map((student) => {
        const person = personById.get(String(student.person_id));
        return {
            id: String(student.id),
            name: String(person?.display_name || person?.full_name || '이름 없는 학생'),
            classIds: uniqueStrings(classesByStudent.get(String(student.id)) ?? []),
        };
    });
}

function normalizePlanStatus(value: unknown): AnalysisPlanRow['status'] {
    return value === 'draft' || value === 'completed' || value === 'archived' ? value : 'active';
}

function normalizePathRole(value: unknown, track: AnalysisPlanRow['trackKind']): AnalysisPlanRow['pathRole'] {
    if (value === 'primary' || value === 'supplemental') return value;
    return track === 'current' ? 'primary' : 'supplemental';
}

function normalizePathPurpose(
    value: unknown,
    planType: AnalysisPlanRow['planType'],
    track: AnalysisPlanRow['trackKind'],
): AnalysisPlanRow['pathPurpose'] {
    if (value === 'current' || value === 'advance' || value === 'review' || value === 'exam' || value === 'other') {
        return value;
    }
    if (planType === 'exam') return 'exam';
    if (track === 'maintenance') return 'review';
    return track === 'advance' ? 'advance' : track === 'current' ? 'current' : 'other';
}

async function loadPlans(
    learning: SchemaClient,
    academyId: string,
    classIds: string[],
): Promise<AnalysisPlanRow[]> {
    if (classIds.length === 0) return [];
    const rows = await loadRowsForChunks(classIds, (ids, from, to) => learning
        .from('analysis_plans')
        .select('id,class_id,plan_type,name,status,path_role,path_purpose,target_challenge_band,maintenance_interval_days,exam_date,recheck_interval_days,taxonomy_revision_id,metadata')
        .eq('academy_id', academyId)
        .in('class_id', ids)
        .order('id')
        .range(from, to), '학습 계획을 불러오지 못했습니다');
    return rows.flatMap((row): AnalysisPlanRow[] => {
        const targetBand = challengeBand(row.target_challenge_band);
        if (!targetBand
            || typeof row.taxonomy_revision_id !== 'string'
            || (row.plan_type !== 'study_track' && row.plan_type !== 'exam')) return [];
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Row : {};
        const normalizedTrack = row.plan_type === 'study_track' ? trackKind(metadata.track_kind) : null;
        return [{
            id: String(row.id),
            classId: String(row.class_id),
            name: String(row.name),
            planType: row.plan_type,
            trackKind: normalizedTrack,
            pathRole: normalizePathRole(row.path_role, normalizedTrack),
            pathPurpose: normalizePathPurpose(row.path_purpose, row.plan_type, normalizedTrack),
            status: normalizePlanStatus(row.status),
            targetBand,
            maintenanceIntervalDays: maintenanceInterval(row.maintenance_interval_days),
            examDate: typeof row.exam_date === 'string' ? row.exam_date : null,
            recheckIntervalDays: Number.isInteger(Number(row.recheck_interval_days))
                ? Number(row.recheck_interval_days)
                : null,
            taxonomyRevisionId: row.taxonomy_revision_id,
        }];
    });
}

async function loadPlanChildren(learning: SchemaClient, planIds: string[]) {
    if (planIds.length === 0) {
        return { scopes: [], planMaterials: [], studentOverrides: [] };
    }
    const [scopeRows, materialRows, overrideRows] = await Promise.all([
        loadRowsForChunks(planIds, (ids, from, to) => learning
            .from('analysis_plan_scope')
            .select('plan_id,analysis_skill_id,target_challenge_band,sort_order')
            .in('plan_id', ids)
            .order('plan_id')
            .order('sort_order')
            .order('analysis_skill_id')
            .range(from, to), '계획 범위를 불러오지 못했습니다'),
        loadRowsForChunks(planIds, (ids, from, to) => learning
            .from('analysis_plan_materials')
            .select('plan_id,book_id')
            .in('plan_id', ids)
            .order('plan_id')
            .order('id')
            .range(from, to), '계획 교재를 불러오지 못했습니다'),
        loadRowsForChunks(planIds, (ids, from, to) => learning
            .from('analysis_plan_student_overrides')
            .select('plan_id,student_id,included,target_challenge_band,maintenance_interval_days,recheck_interval_days')
            .in('plan_id', ids)
            .order('plan_id')
            .order('student_id')
            .range(from, to), '학생별 계획 예외를 불러오지 못했습니다'),
    ]);
    const scopes: AnalysisPlanScopeRow[] = scopeRows.flatMap((row) => {
        if (!row.plan_id || !row.analysis_skill_id) return [];
        return [{
            planId: String(row.plan_id),
            skillId: String(row.analysis_skill_id),
            targetBand: challengeBand(row.target_challenge_band),
            sortOrder: Number(row.sort_order ?? 0),
        }];
    });
    const planMaterials: AnalysisPlanMaterialRow[] = materialRows.map((row) => ({
        planId: String(row.plan_id),
        bookId: typeof row.book_id === 'string' ? row.book_id : null,
    }));
    const studentOverrides: AnalysisPlanStudentOverrideRow[] = overrideRows.map((row) => ({
        planId: String(row.plan_id),
        studentId: String(row.student_id),
        included: row.included !== false,
        targetBand: challengeBand(row.target_challenge_band),
        maintenanceIntervalDays: maintenanceInterval(row.maintenance_interval_days),
        recheckIntervalDays: Number.isInteger(Number(row.recheck_interval_days))
            ? Number(row.recheck_interval_days)
            : null,
    }));
    return { scopes, planMaterials, studentOverrides };
}

async function loadApprovedTags(content: SchemaClient, skillIds: string[]): Promise<AnalysisProblemTagRow[]> {
    if (skillIds.length === 0) return [];
    const rows = await loadRowsForChunks(skillIds, (ids, from, to) => content
        .from('problem_analysis_tags')
        .select('problem_id,analysis_skill_id,challenge_band,equivalence_key')
        .eq('review_status', 'approved')
        .in('analysis_skill_id', ids)
        .order('analysis_skill_id')
        .order('problem_id')
        .range(from, to), '승인된 문제 태그를 불러오지 못했습니다');
    return rows.map((row) => ({
        problemId: String(row.problem_id),
        skillId: String(row.analysis_skill_id),
        challengeBand: challengeBand(row.challenge_band),
        equivalenceKey: typeof row.equivalence_key === 'string' && row.equivalence_key.trim()
            ? row.equivalence_key
            : null,
    }));
}

async function loadEvidenceAttempts(
    reporting: SchemaClient,
    studentIds: string[],
    skillIds: string[],
): Promise<AnalysisAttemptRow[]> {
    if (studentIds.length === 0 || skillIds.length === 0) return [];
    const results: Row[][] = [];
    for (const studentChunk of chunks(studentIds)) {
        for (const skillChunk of chunks(skillIds)) {
            results.push(await loadPagedRows((from, to) => reporting
                .from('v_learning_evidence_base')
                .select('attempt_id,session_id,core_student_id,problem_id,sub_label,correct,unsure,response_state,evidence_kind,analysis_eligible,submitted_at,analysis_skill_id,challenge_band,equivalence_key')
                .in('core_student_id', studentChunk)
                .in('analysis_skill_id', skillChunk)
                .order('attempt_id')
                .range(from, to), '학습 근거를 불러오지 못했습니다'));
        }
    }
    return results.flat().flatMap((row): AnalysisAttemptRow[] => {
        if (typeof row.submitted_at !== 'string'
            || typeof row.session_id !== 'string'
            || typeof row.problem_id !== 'string'
            || typeof row.core_student_id !== 'string'
            || typeof row.analysis_skill_id !== 'string') return [];
        const responseState = row.response_state;
        if (responseState !== 'answered' && responseState !== 'unknown' && responseState !== 'blank') return [];
        return [{
            id: String(row.attempt_id),
            sessionId: row.session_id,
            studentId: row.core_student_id,
            problemId: row.problem_id,
            subLabel: typeof row.sub_label === 'string' ? row.sub_label : null,
            correct: row.correct === true,
            unsure: row.unsure === true,
            responseState,
            evidenceKind: String(row.evidence_kind ?? 'legacy_ambiguous'),
            analysisEligible: row.analysis_eligible === true,
            submittedAt: row.submitted_at,
            skillId: row.analysis_skill_id,
            challengeBand: challengeBand(row.challenge_band),
            equivalenceKey: typeof row.equivalence_key === 'string' && row.equivalence_key.trim()
                ? row.equivalence_key
                : null,
        }];
    });
}

async function loadProblems(content: SchemaClient, problemIds: string[]): Promise<AnalysisProblemRow[]> {
    if (problemIds.length === 0) return [];
    const rows = await loadRowsForChunks(problemIds, (ids, from, to) => content
        .from('problems')
        .select('id,book_id,page_printed,number,answer_key')
        .in('id', ids)
        .order('id')
        .range(from, to), '문제 정보를 불러오지 못했습니다');
    return rows.map((row) => ({
        id: String(row.id),
        bookId: typeof row.book_id === 'string' ? row.book_id : null,
        pagePrinted: Number.isFinite(Number(row.page_printed)) ? Number(row.page_printed) : null,
        number: row.number == null ? null : String(row.number),
        expectedPartCount: expectedPartCount(row.answer_key),
    }));
}

async function loadAssignedActionMarkers(
    learning: SchemaClient,
    academyId: string,
): Promise<AnalysisAssignedActionRow[]> {
    const rows = await loadPagedRows((from, to) => learning
        .from('assignments')
        .select('id,created_at,due_at,metadata')
        .eq('academy_id', academyId)
        .eq('active', true)
        .eq('status', 'published')
        .order('id')
        .range(from, to), '분석 조치 과제 연결을 불러오지 못했습니다');

    type AssignedActionCandidate = AnalysisAssignedActionRow & {
        assignmentId: string;
        studentId: string;
    };
    const candidates = rows.flatMap((row): AssignedActionCandidate[] => {
        if (typeof row.created_at !== 'string' || !row.metadata || typeof row.metadata !== 'object') {
            return [];
        }
        if (typeof row.due_at === 'string' && new Date(row.due_at).getTime() < Date.now()) return [];
        const learningAnalysis = (row.metadata as Row).learningAnalysis;
        if (!learningAnalysis || typeof learningAnalysis !== 'object') return [];
        const actions = (learningAnalysis as Row).actions;
        if (!Array.isArray(actions)) return [];
        return actions.flatMap((action): AssignedActionCandidate[] => {
            if (!action || typeof action !== 'object') return [];
            const actionId = (action as Row).actionId;
            const studentId = (action as Row).studentId;
            return typeof row.id === 'string'
                && typeof actionId === 'string' && actionId.trim()
                && typeof studentId === 'string' && studentId.trim()
                ? [{
                    actionId: actionId.trim(),
                    assignedAt: row.created_at,
                    assignmentId: row.id,
                    studentId: studentId.trim(),
                }]
                : [];
        });
    });
    if (candidates.length === 0) return [];

    const sessions = await loadRowsForChunks(
        uniqueStrings(candidates.map((candidate) => candidate.assignmentId)),
        (ids, from, to) => learning
            .from('sessions')
            .select('assignment_id,core_student_id')
            .in('assignment_id', ids)
            .order('assignment_id')
            .order('core_student_id')
            .range(from, to),
        '분석 조치 과제 제출 상태를 불러오지 못했습니다',
    );
    const submitted = new Set(sessions.map((session) =>
        `${String(session.assignment_id)}::${String(session.core_student_id)}`,
    ));
    return candidates
        .filter((candidate) => !submitted.has(`${candidate.assignmentId}::${candidate.studentId}`))
        .map(({ actionId, assignedAt }) => ({ actionId, assignedAt }));
}

export async function loadLearningAnalysisData(
    context: LmsRoleContext,
    selectedExamPlanId: string | null,
    selectedClassId: string | null = null,
): Promise<LearningAnalysisData> {
    const asOfDate = toSeoulDate(new Date());
    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const reporting = client.schema('reporting');

    const [accessibleClasses, revisionId, materials] = await Promise.all([
        loadAccessibleClasses(core, context),
        loadLatestPublishedRevision(content),
        loadCatalogMaterials(content, context.academyId),
    ]);
    const classes = selectedClassId
        ? accessibleClasses.filter((row) => String(row.id) === selectedClassId)
        : accessibleClasses;
    if (selectedClassId && classes.length === 0) {
        throw new LmsAuthError('선택한 반의 학습 경로에 접근할 수 없습니다.', 403);
    }
    const classIds = classes.map((row) => String(row.id));
    const [catalogSkills, students, plans] = await Promise.all([
        loadCatalogSkills(content, context.academyId, revisionId),
        loadStudents(core, classIds),
        loadPlans(learning, context.academyId, classIds),
    ]);
    const historicalRevisionIds = uniqueStrings(plans.map((plan) => plan.taxonomyRevisionId))
        .filter((planRevisionId) => planRevisionId !== revisionId);
    const historicalSkillGroups = await Promise.all(
        historicalRevisionIds.map((planRevisionId) =>
            loadCatalogSkills(content, context.academyId, planRevisionId),
        ),
    );
    const skills = [...new Map(
        [...catalogSkills, ...historicalSkillGroups.flat()].map((skill) => [skill.id, skill]),
    ).values()];
    const children = await loadPlanChildren(learning, plans.map((plan) => plan.id));
    const scopedSkillIds = uniqueStrings(children.scopes.map((scope) => scope.skillId));
    const [tags, attempts, assignedActions] = await Promise.all([
        loadApprovedTags(content, scopedSkillIds),
        loadEvidenceAttempts(reporting, students.map((student) => student.id), scopedSkillIds),
        loadAssignedActionMarkers(learning, context.academyId),
    ]);
    const problems = await loadProblems(content, uniqueStrings(attempts.map((attempt) => attempt.problemId)));

    return buildLearningAnalysisData({
        asOfDate,
        selectedExamPlanId,
        classes: classes.map((row) => ({ id: String(row.id), name: String(row.name) })),
        students,
        skills,
        catalogSkillIds: catalogSkills.map((skill) => skill.id),
        materials,
        plans,
        scopes: children.scopes,
        planMaterials: children.planMaterials,
        studentOverrides: children.studentOverrides,
        tags,
        attempts,
        problems,
        assignedActions,
    });
}

async function assertClassAccess(
    core: SchemaClient,
    context: LmsRoleContext,
    classId: string,
): Promise<void> {
    if (requiresAssignedClassScope(context.role)) {
        const assigned = await loadAssignedClassIdsForContext(context);
        if (!assigned?.has(classId)) {
            throw new LmsAuthError('담당 반의 학습 계획만 만들 수 있습니다.', 403);
        }
    }
    const { data, error } = await core
        .from('classes')
        .select('id')
        .eq('academy_id', context.academyId)
        .eq('id', classId)
        .eq('active', true)
        .maybeSingle();
    ensureNoError(error, '반 접근 권한을 확인하지 못했습니다');
    if (!(data as Row | null)?.id) throw new LmsAuthError('선택한 반을 찾을 수 없습니다.', 403);
}

async function assertPlanReferences(
    content: SchemaClient,
    academyId: string,
    scopeSkillIds: string[],
    materialBookIds: string[],
): Promise<void> {
    const revisionId = await loadLatestPublishedRevision(content);
    if (!revisionId) throw new Error('게시된 공통 유형 버전이 없습니다.');
    const { data: skills, error: skillError } = await content
        .from('analysis_skills')
        .select('id')
        .eq('taxonomy_revision_id', revisionId)
        .eq('active', true)
        .in('id', scopeSkillIds);
    ensureNoError(skillError, '계획 범위를 확인하지 못했습니다');
    if ((skills ?? []).length !== scopeSkillIds.length) {
        throw new Error('선택한 공통 유형 중 사용할 수 없는 항목이 있습니다.');
    }
    if (materialBookIds.length === 0) return;
    const { data: books, error: bookError } = await content
        .from('books')
        .select('id')
        .in('id', materialBookIds)
        .or(`academy_id.is.null,academy_id.eq.${academyId}`);
    ensureNoError(bookError, '교재를 확인하지 못했습니다');
    if ((books ?? []).length !== materialBookIds.length) {
        throw new Error('선택한 교재 중 사용할 수 없는 항목이 있습니다.');
    }
}

function parseCreatedPlanId(value: unknown): string {
    const row = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
    const planId = row && typeof row === 'object' ? (row as Row).plan_id : null;
    if (typeof planId !== 'string' || !isUuid(planId)) {
        throw new Error('계획 생성 함수가 올바른 결과를 반환하지 않았습니다.');
    }
    return planId;
}

export async function createLearningAnalysisPlan(
    context: LmsRoleContext,
    input: unknown,
): Promise<{ planId: string }> {
    const normalized = normalizeCreateLearningPlanInput(input, toSeoulDate(new Date()));
    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    await Promise.all([
        assertClassAccess(core, context, normalized.classId),
        assertPlanReferences(content, context.academyId, normalized.scopeSkillIds, normalized.materialBookIds),
    ]);
    const { data, error } = await client.schema('learning').rpc('create_analysis_path_v2', {
        p_actor_auth_user_id: context.userId,
        p_academy_id: context.academyId,
        p_input: toCreatePlanContract(normalized),
    });
    ensureNoError(error, '학습 계획을 저장하지 못했습니다');
    return { planId: parseCreatedPlanId(data) };
}

export async function startLearningAnalysisPath(
    context: LmsRoleContext,
    planId: string,
): Promise<{ planId: string }> {
    if (!isUuid(planId)) throw new LearningAnalysisValidationError('학습 경로 정보가 올바르지 않습니다.');
    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const { data: plan, error: planError } = await learning
        .from('analysis_plans')
        .select('id,class_id,path_role,status')
        .eq('academy_id', context.academyId)
        .eq('id', planId)
        .maybeSingle();
    ensureNoError(planError, '학습 경로를 확인하지 못했습니다');
    const row = plan as Row | null;
    if (!row?.id || row.path_role !== 'primary' || row.status !== 'draft') {
        throw new LearningAnalysisValidationError('준비 중인 대표 학습 경로만 시작할 수 있습니다.');
    }
    await assertClassAccess(core, context, String(row.class_id));
    const { data, error } = await learning.rpc('start_analysis_path_v2', {
        p_academy_id: context.academyId,
        p_plan_id: planId,
    });
    ensureNoError(error, '다음 학습 경로를 시작하지 못했습니다');
    const result = Array.isArray(data) ? data[0] : data;
    const startedId = result && typeof result === 'object' ? String((result as Row).id || '') : '';
    if (startedId !== planId) throw new Error('학습 경로 전환 결과가 올바르지 않습니다.');
    return { planId };
}

export async function changeLearningAnalysisPathStatus(
    context: LmsRoleContext,
    planId: string,
    action: 'complete' | 'archive',
): Promise<{ planId: string; status: 'completed' | 'archived' }> {
    if (!isUuid(planId)) throw new LearningAnalysisValidationError('학습 경로 정보가 올바르지 않습니다.');
    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const { data: plan, error: planError } = await learning
        .from('analysis_plans')
        .select('id,class_id,status')
        .eq('academy_id', context.academyId)
        .eq('id', planId)
        .maybeSingle();
    ensureNoError(planError, '학습 경로를 확인하지 못했습니다');
    const row = plan as Row | null;
    if (!row?.id) throw new LearningAnalysisValidationError('학습 경로를 찾을 수 없습니다.');
    await assertClassAccess(core, context, String(row.class_id));

    const today = toSeoulDate(new Date());
    const nextStatus = action === 'complete' ? 'completed' as const : 'archived' as const;
    if (action === 'complete' && row.status !== 'active') {
        throw new LearningAnalysisValidationError('진행 중인 학습 경로만 완료할 수 있습니다.');
    }
    if (action === 'archive' && row.status !== 'completed' && row.status !== 'draft') {
        throw new LearningAnalysisValidationError('완료 또는 준비 중인 학습 경로만 보관할 수 있습니다.');
    }
    const update = action === 'complete'
        ? { status: nextStatus, completed_at: new Date().toISOString(), ends_on: today, updated_at: new Date().toISOString() }
        : { status: nextStatus, ends_on: today, updated_at: new Date().toISOString() };
    const { data: updated, error } = await learning
        .from('analysis_plans')
        .update(update)
        .eq('academy_id', context.academyId)
        .eq('id', planId)
        .eq('status', String(row.status))
        .select('id')
        .maybeSingle();
    ensureNoError(error, '학습 경로 상태를 변경하지 못했습니다');
    if (!(updated as Row | null)?.id) {
        throw new LearningAnalysisValidationError('학습 경로 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
    }
    return { planId, status: nextStatus };
}
