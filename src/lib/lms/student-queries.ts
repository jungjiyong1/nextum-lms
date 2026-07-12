import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import type {
    AttendanceRow,
    BillingRow,
    PaymentRow,
    StudentAiConversationDetail,
    StudentAiConversationSummary,
    StudentAiProblemSummary,
    StudentAssignmentLearningDetail,
    StudentAssignmentInsight,
    StudentAttendanceSummary,
    StudentDetail,
    StudentDetailSection,
    StudentGradeAppAccount,
    StudentHardDeletePreview,
    StudentLearningAttentionStatus,
    StudentLearningClassContext,
    StudentLearningClassSummary,
    StudentLearningEvidenceRow,
    StudentLearningMetric,
    StudentLearningOverview,
    StudentLearningPathSummary,
    StudentLearningStatus,
    StudentLearningSubjectSummary,
    StudentLearningTypeEvidence,
    StudentLearningTypeSummary,
    StudentLearningUnitDetail,
    StudentLearningUnitSummary,
    StudentOperationsOverview,
    StudentOperationsPermissions,
    StudentSignupInvitation,
    StudentSummary,
    StudentTypeInsight,
    StudentUnitInsight,
} from '@/features/lms/types';
import { COMPLETED_PAYMENT_STATUS } from '@/features/lms/status';
import { summarizeRecentFirstAttempts } from '@/features/lms/student-learning-metrics';
import { createAdminClient } from '@/lib/supabase/admin';
import { ApiContractError, decodeCursor, encodeCursor, normalizeCursorLimit } from './api-contracts';
import { loadAssignedClassIdsForContext, loadClassOptionsForContext } from './class-queries';
import { LmsAuthError, type LmsRoleContext } from './auth';
import {
    assertRosterCursorFilter,
    buildPeopleSearchOrFilter,
    isStudentRosterCursor,
    parseStudentRosterFilters,
    studentRosterFilterKey,
    type StudentRosterCursor,
    type StudentRosterFilters,
} from './roster-filters';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

const EMPTY_ATTENDANCE_SUMMARY: StudentAttendanceSummary = {
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    makeup: 0,
    total: 0,
};

const STUDENT_DETAIL_SECTIONS = new Set<StudentDetailSection>(['learning', 'attendance', 'billing', 'management', 'full']);

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function accuracy(correctCount: number, totalCount: number): number | null {
    if (totalCount <= 0) return null;
    return Math.round((correctCount / totalCount) * 1000) / 10;
}

function scoreStatus(sampleCount: number, score: number | null): StudentLearningStatus {
    if (sampleCount < 2 || score === null) return 'insufficient';
    if (score < 50) return 'weak';
    if (score < 75) return 'watch';
    return 'ok';
}

function attemptScore(row: Row): number {
    if (row.correct && row.unsure) return 0.5;
    return row.correct ? 1 : 0;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function groupAttemptsByProblem(attempts: Row[]): Map<string, Row[]> {
    const grouped = new Map<string, Row[]>();
    for (const attempt of attempts) {
        const rows = grouped.get(attempt.problem_id) || [];
        rows.push(attempt);
        grouped.set(attempt.problem_id, rows);
    }
    for (const rows of grouped.values()) {
        rows.sort((a, b) => Number(a.attempt_no || 0) - Number(b.attempt_no || 0)
            || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    }
    return grouped;
}

function groupAttemptsByLearningSource(attempts: Row[]): Map<string, Row[]> {
    const grouped = new Map<string, Row[]>();
    for (const attempt of attempts) {
        const sourceId = attempt.assignment_id || attempt.session_id || 'personal';
        const key = `${sourceId}:${attempt.problem_id}`;
        grouped.set(key, [...(grouped.get(key) || []), attempt]);
    }
    for (const rows of grouped.values()) {
        rows.sort((a, b) => Number(a.attempt_no || 0) - Number(b.attempt_no || 0)
            || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    }
    return grouped;
}

function compareAssignments(a: StudentAssignmentInsight, b: StudentAssignmentInsight): number {
    const rank = (row: StudentAssignmentInsight) => {
        if (row.progressStatus === 'completed') return 3;
        if (row.overdue) return 0;
        if (row.dueSoon) return 1;
        return 2;
    };
    const rankA = rank(a);
    const rankB = rank(b);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === 3) {
        return String(b.lastActivityAt || b.dueAt || '').localeCompare(String(a.lastActivityAt || a.dueAt || ''));
    }
    return String(a.dueAt || '9999-12-31').localeCompare(String(b.dueAt || '9999-12-31'))
        || String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || ''));
}

function permissionsForContext(context: LmsRoleContext): StudentOperationsPermissions {
    const canManage = context.role === 'owner' || context.role === 'admin' || context.role === 'staff';
    return {
        canCreate: canManage,
        canEdit: canManage,
        canArchive: canManage,
        canViewBilling: canManage,
        canHardDelete: context.role === 'owner' || context.role === 'admin',
        scopedToAssignedClasses: requiresAssignedClassScope(context.role),
    };
}

async function fetchPeople(core: SchemaClient, personIds: string[]): Promise<Map<string, Row>> {
    const ids = uniqueStrings(personIds);
    if (ids.length === 0) return new Map();

    const { data, error } = await core
        .from('people')
        .select('id,full_name,display_name,email,phone,parent_name,parent_phone')
        .in('id', ids);
    ensureNoError(error, 'Failed to load people');

    return new Map(((data || []) as Row[]).map((person) => [person.id, person]));
}

async function loadAssignedStudentIds(core: SchemaClient, assignedClassIds: Set<string> | null): Promise<string[] | null> {
    if (!assignedClassIds) return null;
    const classIds = [...assignedClassIds];
    if (classIds.length === 0) return [];

    const { data, error } = await core
        .from('class_students')
        .select('student_id')
        .in('class_id', classIds)
        .eq('status', 'active');
    ensureNoError(error, 'Failed to load assigned students');
    return uniqueStrings(((data || []) as Row[]).map((row) => row.student_id));
}

async function loadWeakMetrics(
    reporting: SchemaClient,
    academyId: string,
    studentIds: string[],
): Promise<Map<string, { weakTypeCount: number; avgTypeScore: number | null; lastLearningAt: string | null }>> {
    if (studentIds.length === 0) return new Map();

    const { data, error } = await reporting
        .from('v_student_type_weakness')
        .select('student_id,status,score,last_attempted_at')
        .eq('academy_id', academyId)
        .in('student_id', studentIds);
    ensureNoError(error, 'Failed to load student weakness metrics');

    const stats = new Map<string, { weakTypeCount: number; scoreSum: number; scoreCount: number; lastLearningAt: string | null }>();
    for (const row of (data || []) as Row[]) {
        const current = stats.get(row.student_id) || { weakTypeCount: 0, scoreSum: 0, scoreCount: 0, lastLearningAt: null };
        if (row.status === 'weak' || row.status === 'watch') current.weakTypeCount += 1;
        if (row.score !== null && row.score !== undefined) {
            current.scoreSum += Number(row.score);
            current.scoreCount += 1;
        }
        if (row.last_attempted_at && (!current.lastLearningAt || row.last_attempted_at > current.lastLearningAt)) {
            current.lastLearningAt = row.last_attempted_at;
        }
        stats.set(row.student_id, current);
    }

    return new Map([...stats.entries()].map(([studentId, value]) => [
        studentId,
        {
            weakTypeCount: value.weakTypeCount,
            avgTypeScore: value.scoreCount > 0 ? Math.round((value.scoreSum / value.scoreCount) * 10) / 10 : null,
            lastLearningAt: value.lastLearningAt,
        },
    ]));
}

async function loadStudentSummaries(
    client: LmsAdminClient,
    academyId: string,
    options: {
        studentIds?: string[] | null;
        assignedClassIds?: Set<string> | null;
        includeBilling: boolean;
        includeWeakMetrics: boolean;
    },
): Promise<StudentSummary[]> {
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');

    if (options.studentIds && options.studentIds.length === 0) return [];

    let studentsQuery = core
        .from('students')
        .select('id,person_id,status,school_type,grade,created_at')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false });

    if (options.studentIds) {
        studentsQuery = studentsQuery.in('id', options.studentIds);
    }

    const { data: studentsData, error: studentsError } = await studentsQuery;
    ensureNoError(studentsError, 'Failed to load students');

    const students = (studentsData || []) as Row[];
    if (students.length === 0) return [];

    const studentIds = students.map((row) => row.id);
    let classRowsQuery = core
        .from('class_students')
        .select('class_id,student_id,status,classes(id,name)')
        .in('student_id', studentIds);

    if (options.assignedClassIds) {
        const classIds = [...options.assignedClassIds];
        if (classIds.length === 0) return [];
        classRowsQuery = classRowsQuery.in('class_id', classIds);
    }

    const peoplePromise = fetchPeople(core, students.map((row) => row.person_id));
    const weakMetricsPromise = options.includeWeakMetrics
        ? loadWeakMetrics(reporting, academyId, studentIds)
        : Promise.resolve(new Map<string, { weakTypeCount: number; avgTypeScore: number | null; lastLearningAt: string | null }>());

    const [classRowsResult, contractsResult, people, weakMetrics] = await Promise.all([
        classRowsQuery,
        options.includeBilling
            ? lms.from('student_billing_contracts').select('id,student_id,billing_mode,base_monthly_fee,hourly_rate').eq('academy_id', academyId).in('student_id', studentIds).eq('status', 'active')
            : Promise.resolve({ data: [], error: null }),
        peoplePromise,
        weakMetricsPromise,
    ]);
    ensureNoError(classRowsResult.error, 'Failed to load student classes');
    ensureNoError(contractsResult.error, 'Failed to load student contracts');

    const contractMap = new Map(((contractsResult.data || []) as Row[]).map((row) => [row.student_id, row]));
    const contractIds = ((contractsResult.data || []) as Row[]).map((row) => row.id);
    const rulesByContract = new Map<string, Row[]>();

    if (options.includeBilling && contractIds.length > 0) {
        const { data: rules, error: rulesError } = await lms
            .from('billing_class_rules')
            .select('contract_id,class_id,rule_type,amount')
            .eq('academy_id', academyId)
            .in('contract_id', contractIds);
        ensureNoError(rulesError, 'Failed to load student billing rules');
        for (const rule of (rules || []) as Row[]) {
            rulesByContract.set(rule.contract_id, [...(rulesByContract.get(rule.contract_id) || []), rule]);
        }
    }

    const classNames = new Map<string, string[]>();
    const classIdsByStudent = new Map<string, string[]>();

    for (const row of (classRowsResult.data || []) as Row[]) {
        if (row.status !== 'active') continue;
        const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
        const names = classNames.get(row.student_id) || [];
        if (cls?.name) names.push(cls.name);
        classNames.set(row.student_id, names);
        classIdsByStudent.set(row.student_id, [...(classIdsByStudent.get(row.student_id) || []), row.class_id]);
    }

    return students.map((row) => {
        const person = people.get(row.person_id);
        const contract = contractMap.get(row.id);
        const extraClassFee = (rulesByContract.get(contract?.id) || []).find((rule) => rule.rule_type === 'extra_flat')?.amount;
        const metrics = weakMetrics.get(row.id);
        return {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown student',
            phone: person?.phone ?? null,
            parentName: person?.parent_name ?? null,
            parentPhone: person?.parent_phone ?? null,
            schoolType: row.school_type ?? null,
            grade: row.grade ?? null,
            status: row.status,
            classIds: classIdsByStudent.get(row.id) || [],
            classNames: classNames.get(row.id) || [],
            billingMode: contract?.billing_mode ?? null,
            baseMonthlyFee: options.includeBilling ? toNumber(contract?.base_monthly_fee) : 0,
            hourlyRate: options.includeBilling && contract?.hourly_rate !== null && contract?.hourly_rate !== undefined
                ? Number(contract.hourly_rate)
                : null,
            extraClassFee: options.includeBilling ? toNumber(extraClassFee) : 0,
            weakTypeCount: metrics?.weakTypeCount ?? 0,
            avgTypeScore: metrics?.avgTypeScore ?? null,
            lastLearningAt: metrics?.lastLearningAt ?? null,
            learningMetricsLoaded: options.includeWeakMetrics,
        };
    });
}

export async function loadStudentSummariesForAcademy(academyId: string): Promise<StudentSummary[]> {
    const client = createAdminClient();
    return loadStudentSummaries(client, academyId, {
        includeBilling: true,
        includeWeakMetrics: false,
    });
}

async function assertCanViewStudent(
    context: LmsRoleContext,
    studentId: string,
    assignedClassIds: Set<string> | null,
) {
    if (!requiresAssignedClassScope(context.role)) return;
    if (!assignedClassIds || assignedClassIds.size === 0) {
        throw new LmsAuthError('Student access is not allowed for this role.', 403);
    }

    const client = createAdminClient();
    const { data, error } = await client.schema('core')
        .from('class_students')
        .select('student_id')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .in('class_id', [...assignedClassIds])
        .limit(1)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify student access');
    if (!data?.student_id) throw new LmsAuthError('Student access is not allowed for this role.', 403);
}

interface ProblemMeta {
    id: string;
    bookId: string | null;
    bookTitle: string | null;
    unitId: string | null;
    unitName: string;
    typeId: string | null;
    typeName: string;
    label: string;
}

async function loadProblemMeta(content: SchemaClient, problemIds: string[]): Promise<Map<string, ProblemMeta>> {
    const ids = uniqueStrings(problemIds);
    if (ids.length === 0) return new Map();

    const { data, error } = await content
        .from('problems')
        .select('id,book_id,unit_id,problem_type_id,type_id,number,page_printed')
        .in('id', ids);
    ensureNoError(error, 'Failed to load student learning problems');

    const problems = (data || []) as Row[];
    const bookIds = uniqueStrings(problems.map((row) => row.book_id));
    const unitIds = uniqueStrings(problems.map((row) => row.unit_id));
    const typeIds = uniqueStrings(problems.map((row) => row.problem_type_id || row.type_id));
    const [bookResult, unitResult, typeResult, revisionResult] = await Promise.all([
        bookIds.length ? content.from('books').select('id,title').in('id', bookIds) : Promise.resolve({ data: [], error: null }),
        unitIds.length ? content.from('units').select('id,name').in('id', unitIds) : Promise.resolve({ data: [], error: null }),
        typeIds.length ? content.from('problem_types').select('id,name').in('id', typeIds) : Promise.resolve({ data: [], error: null }),
        content.from('analysis_taxonomy_revisions').select('id').eq('status', 'published').order('revision_number', { ascending: false }).limit(1).maybeSingle(),
    ]);
    ensureNoError(bookResult.error, 'Failed to load student learning books');
    ensureNoError(unitResult.error, 'Failed to load student learning units');
    ensureNoError(typeResult.error, 'Failed to load student learning types');
    ensureNoError(revisionResult.error, 'Failed to load canonical learning taxonomy');

    const revisionId = (revisionResult.data as Row | null)?.id;
    const canonicalTags = new Map<string, string>();
    const canonicalNames = new Map<string, string>();
    if (typeof revisionId === 'string') {
        const { data: tagData, error: tagError } = await content
            .from('problem_analysis_tags')
            .select('problem_id,analysis_skill_id')
            .eq('taxonomy_revision_id', revisionId)
            .eq('review_status', 'approved')
            .in('problem_id', ids);
        ensureNoError(tagError, 'Failed to load canonical learning tags');
        for (const row of (tagData || []) as Row[]) {
            if (typeof row.problem_id === 'string' && typeof row.analysis_skill_id === 'string') canonicalTags.set(row.problem_id, row.analysis_skill_id);
        }
        const skillIds = uniqueStrings([...canonicalTags.values()]);
        if (skillIds.length > 0) {
            const { data: skillData, error: skillError } = await content
                .from('analysis_skills')
                .select('id,name')
                .eq('taxonomy_revision_id', revisionId)
                .eq('active', true)
                .in('id', skillIds);
            ensureNoError(skillError, 'Failed to load canonical learning skill names');
            for (const row of (skillData || []) as Row[]) {
                if (typeof row.id === 'string' && typeof row.name === 'string') canonicalNames.set(row.id, row.name);
            }
            for (const [problemId, skillId] of canonicalTags) {
                if (!canonicalNames.has(skillId)) canonicalTags.delete(problemId);
            }
        }
    }

    const bookNames = new Map(((bookResult.data || []) as Row[]).map((row) => [row.id, row.title]));
    const unitNames = new Map(((unitResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const typeNames = new Map(((typeResult.data || []) as Row[]).map((row) => [row.id, row.name]));

    return new Map(problems.map((problem) => {
        const localTypeId = problem.problem_type_id || problem.type_id || null;
        const typeId = canonicalTags.get(problem.id) || localTypeId;
        const unitName = problem.unit_id ? unitNames.get(problem.unit_id) || '단원 미지정' : '단원 미지정';
        const typeName = typeId ? canonicalNames.get(typeId) || typeNames.get(localTypeId) || '유형 미지정' : '유형 미지정';
        const page = problem.page_printed ? `p.${Number(problem.page_printed)}` : '문항';
        return [problem.id, {
            id: problem.id,
            bookId: problem.book_id ?? null,
            bookTitle: problem.book_id ? bookNames.get(problem.book_id) ?? null : null,
            unitId: problem.unit_id ?? null,
            unitName,
            typeId,
            typeName,
            label: `${page} · ${String(problem.number || problem.id)}`,
        } satisfies ProblemMeta];
    }));
}

async function loadAssignmentInsights(
    learning: SchemaClient,
    content: SchemaClient,
    academyId: string,
    studentId: string,
): Promise<StudentAssignmentInsight[]> {
    const [recipientResult, sessionResult, attemptResult] = await Promise.all([
        learning
            .from('assignment_recipients')
            .select('assignment_id,class_id,source_type,metadata')
            .eq('academy_id', academyId)
            .eq('student_id', studentId)
            .limit(500),
        learning
            .from('sessions')
            .select('assignment_id,submitted_at,started_at')
            .eq('academy_id', academyId)
            .eq('core_student_id', studentId)
            .not('assignment_id', 'is', null)
            .limit(1000),
        learning
            .from('attempts')
            .select('assignment_id,problem_id,correct,unsure,attempt_no,created_at')
            .eq('academy_id', academyId)
            .eq('core_student_id', studentId)
            .not('assignment_id', 'is', null)
            .limit(5000),
    ]);
    ensureNoError(recipientResult.error, 'Failed to load student assignment recipients');
    ensureNoError(sessionResult.error, 'Failed to load student assignment sessions');
    ensureNoError(attemptResult.error, 'Failed to load student assignment attempts');

    const assignmentIds = uniqueStrings([
        ...((recipientResult.data || []) as Row[]).map((row) => row.assignment_id),
        ...((sessionResult.data || []) as Row[]).map((row) => row.assignment_id),
        ...((attemptResult.data || []) as Row[]).map((row) => row.assignment_id),
    ]);
    if (assignmentIds.length === 0) return [];

    const [assignmentResult, itemResult] = await Promise.all([
        learning
            .from('assignments')
            .select('id,title,due_at,status,active,source_type,book_id,created_at')
            .eq('academy_id', academyId)
            .in('id', assignmentIds),
        learning
            .from('assignment_items')
            .select('assignment_id,problem_id,required')
            .in('assignment_id', assignmentIds),
    ]);
    ensureNoError(assignmentResult.error, 'Failed to load student assignments');
    ensureNoError(itemResult.error, 'Failed to load student assignment items');

    const assignments = (assignmentResult.data || []) as Row[];
    const bookIds = uniqueStrings(assignments.map((row) => row.book_id));
    const bookResult = bookIds.length
        ? await content.from('books').select('id,title').in('id', bookIds)
        : { data: [], error: null };
    ensureNoError(bookResult.error, 'Failed to load student assignment books');
    const bookNames = new Map(((bookResult.data || []) as Row[]).map((row) => [row.id, row.title]));
    const sessions = (sessionResult.data || []) as Row[];
    const attempts = (attemptResult.data || []) as Row[];
    const items = (itemResult.data || []) as Row[];
    const recipients = new Map(((recipientResult.data || []) as Row[]).map((row) => [row.assignment_id, row]));
    const now = new Date();
    const dueSoonBoundary = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return assignments.map((assignment) => {
        const assignmentItems = items.filter((row) => row.assignment_id === assignment.id && row.required !== false && row.problem_id);
        const requiredProblemIds = uniqueStrings(assignmentItems.map((row) => row.problem_id));
        const assignmentAttempts = attempts.filter((row) => row.assignment_id === assignment.id);
        const assignmentSessions = sessions.filter((row) => row.assignment_id === assignment.id);
        const attemptedProblemIds = new Set(assignmentAttempts.map((row) => row.problem_id));
        const attemptedProblemCount = attemptedProblemIds.size;
        const attemptsByProblem = groupAttemptsByProblem(assignmentAttempts);
        const firstAttempts = [...attemptsByProblem.values()].map((rows) => rows[0]).filter(Boolean);
        const correctAttemptCount = firstAttempts.filter((row) => row.correct === true).length;
        const correctedProblemCount = [...attemptsByProblem.values()].filter((rows) => rows[0]?.correct === false && rows.slice(1).some((row) => row.correct === true)).length;
        const lastActivityAt = [
            ...assignmentAttempts.map((row) => row.created_at),
            ...assignmentSessions.map((row) => row.submitted_at || row.started_at),
        ].filter(Boolean).sort().at(-1) || null;
        const submitted = assignmentSessions.some((row) => Boolean(row.submitted_at));
        const completed = requiredProblemIds.length > 0
            ? requiredProblemIds.every((problemId) => attemptedProblemIds.has(problemId))
            : submitted;
        const progressStatus = completed
            ? 'completed'
            : assignmentAttempts.length > 0 || assignmentSessions.length > 0
                ? 'in_progress'
                : 'not_started';
        const recipient = recipients.get(assignment.id);
        const dueAt = assignment.due_at ?? null;
        const dueDate = dueAt ? new Date(dueAt) : null;
        const incomplete = progressStatus !== 'completed';
        const overdue = Boolean(incomplete && dueDate && dueDate.getTime() < now.getTime());
        const dueSoon = Boolean(incomplete && dueDate && !overdue && dueDate.getTime() <= dueSoonBoundary.getTime());
        const personal = !recipient?.class_id || recipient?.metadata?.personal === true;

        return {
            id: assignment.id,
            classId: personal ? null : recipient.class_id,
            personal,
            title: assignment.title || '제목 없는 과제',
            dueAt,
            status: assignment.status || 'published',
            active: assignment.active !== false,
            sourceType: assignment.source_type === 'worksheet' ? 'worksheet' : 'content_scope',
            bookTitle: assignment.book_id ? bookNames.get(assignment.book_id) ?? null : null,
            progressStatus,
            requiredProblemCount: requiredProblemIds.length,
            attemptedProblemCount,
            attemptCount: firstAttempts.length,
            correctAttemptCount,
            correctRate: accuracy(correctAttemptCount, firstAttempts.length),
            correctedProblemCount,
            dueSoon,
            overdue,
            lastActivityAt,
        } satisfies StudentAssignmentInsight;
    }).sort(compareAssignments);
}

function buildUnitInsights(attempts: Row[], problemMeta: Map<string, ProblemMeta>): StudentUnitInsight[] {
    const firstAttempts = new Map<string, Row>();
    for (const attempt of [...attempts].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))) {
        if (!firstAttempts.has(attempt.problem_id)) firstAttempts.set(attempt.problem_id, attempt);
    }

    const buckets = new Map<string, {
        unitId: string | null;
        unitName: string;
        bookId: string | null;
        bookTitle: string | null;
        scoreSum: number;
        sampleCount: number;
        correctCount: number;
        lastAttemptedAt: string | null;
        types: Map<string, {
            typeId: string | null;
            typeName: string;
            scoreSum: number;
            sampleCount: number;
            correctCount: number;
            lastAttemptedAt: string | null;
        }>;
    }>();

    for (const meta of problemMeta.values()) {
        const key = meta.unitId || 'none';
        if (!buckets.has(key)) {
            buckets.set(key, {
                unitId: meta.unitId,
                unitName: meta.unitName,
                bookId: meta.bookId,
                bookTitle: meta.bookTitle,
                scoreSum: 0,
                sampleCount: 0,
                correctCount: 0,
                lastAttemptedAt: null,
                types: new Map(),
            });
        }
    }

    for (const [problemId, attempt] of firstAttempts.entries()) {
        const meta = problemMeta.get(problemId);
        if (!meta) continue;
        const unitKey = meta.unitId || 'none';
        const unit = buckets.get(unitKey);
        if (!unit) continue;
        const typeKey = meta.typeId || `${unitKey}:none`;
        const type = unit.types.get(typeKey) || {
            typeId: meta.typeId,
            typeName: meta.typeName,
            scoreSum: 0,
            sampleCount: 0,
            correctCount: 0,
            lastAttemptedAt: null,
        };
        const score = attemptScore(attempt);
        unit.scoreSum += score;
        unit.sampleCount += 1;
        if (attempt.correct) unit.correctCount += 1;
        if (attempt.created_at && (!unit.lastAttemptedAt || attempt.created_at > unit.lastAttemptedAt)) unit.lastAttemptedAt = attempt.created_at;
        type.scoreSum += score;
        type.sampleCount += 1;
        if (attempt.correct) type.correctCount += 1;
        if (attempt.created_at && (!type.lastAttemptedAt || attempt.created_at > type.lastAttemptedAt)) type.lastAttemptedAt = attempt.created_at;
        unit.types.set(typeKey, type);
    }

    const statusRank: Record<StudentLearningStatus, number> = { weak: 0, watch: 1, insufficient: 2, ok: 3 };
    return [...buckets.values()].map((unit) => {
        const score = unit.sampleCount > 0 ? Math.round((unit.scoreSum / unit.sampleCount) * 1000) / 10 : null;
        const types = [...unit.types.values()].map((type) => {
            const typeScore = type.sampleCount > 0 ? Math.round((type.scoreSum / type.sampleCount) * 1000) / 10 : null;
            return {
                typeId: type.typeId,
                typeName: type.typeName,
                sampleCount: type.sampleCount,
                correctCount: type.correctCount,
                score: typeScore,
                status: scoreStatus(type.sampleCount, typeScore),
                lastAttemptedAt: type.lastAttemptedAt,
            } satisfies StudentTypeInsight;
        }).sort((a, b) => statusRank[a.status] - statusRank[b.status] || (a.score ?? 101) - (b.score ?? 101) || b.sampleCount - a.sampleCount);
        const unitStatus = scoreStatus(unit.sampleCount, score);
        return {
            unitId: unit.unitId,
            unitName: unit.unitName,
            bookId: unit.bookId,
            bookTitle: unit.bookTitle,
            sampleCount: unit.sampleCount,
            correctCount: unit.correctCount,
            score,
            status: unitStatus,
            weakTypeCount: types.filter((type) => type.status === 'weak' || type.status === 'watch').length,
            typeCount: types.length,
            lastAttemptedAt: unit.lastAttemptedAt,
            types,
        } satisfies StudentUnitInsight;
    }).sort((a, b) => statusRank[a.status] - statusRank[b.status] || (a.score ?? 101) - (b.score ?? 101) || b.sampleCount - a.sampleCount);
}

interface StudentClassDescriptor {
    classId: string;
    className: string;
    grade: string | null;
    color: string | null;
    courseTitle: string | null;
    subjectId: string | null;
    subjectName: string;
}

function attentionStatus(sampleCount: number, correctRate: number | null, overdueAssignments: number): StudentLearningAttentionStatus {
    if (sampleCount >= 5 && correctRate !== null && correctRate < 50) return 'support_needed';
    if (overdueAssignments > 0 || (sampleCount >= 5 && correctRate !== null && correctRate < 75)) return 'check_needed';
    if (sampleCount > 0) return 'steady';
    return 'no_data';
}

function normalizePathPurpose(value: unknown): StudentLearningPathSummary['purpose'] {
    return value === 'current' || value === 'advance' || value === 'review' ? value : 'other';
}

function normalizePathStatus(value: unknown): StudentLearningPathSummary['status'] {
    if (value === 'active' || value === 'archived' || value === 'completed') return value;
    return 'draft';
}

async function loadStudentClassDescriptors(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    studentId: string,
): Promise<StudentClassDescriptor[]> {
    const { data: enrollmentData, error: enrollmentError } = await core
        .from('class_students')
        .select('class_id,classes(id,name,grade,metadata)')
        .eq('student_id', studentId)
        .eq('status', 'active');
    ensureNoError(enrollmentError, 'Failed to load student learning classes');
    const enrollments = (enrollmentData || []) as Row[];
    const classIds = uniqueStrings(enrollments.map((row) => row.class_id));
    if (classIds.length === 0) return [];

    const { data: profileData, error: profileError } = await lms
        .from('class_profiles')
        .select('class_id,course_id,subject_id,color,status')
        .eq('academy_id', academyId)
        .in('class_id', classIds);
    ensureNoError(profileError, 'Failed to load student learning class profiles');
    const profiles = (profileData || []) as Row[];
    const courseIds = uniqueStrings(profiles.map((row) => row.course_id));
    const profileSubjectIds = uniqueStrings(profiles.map((row) => row.subject_id));
    const { data: courseData, error: courseError } = courseIds.length > 0
        ? await lms.from('courses').select('id,title,subject_id').eq('academy_id', academyId).in('id', courseIds)
        : { data: [], error: null };
    ensureNoError(courseError, 'Failed to load student learning courses');
    const courses = (courseData || []) as Row[];
    const subjectIds = uniqueStrings([...profileSubjectIds, ...courses.map((row) => row.subject_id)]);
    const { data: subjectData, error: subjectError } = subjectIds.length > 0
        ? await lms.from('subjects').select('id,name').eq('academy_id', academyId).in('id', subjectIds)
        : { data: [], error: null };
    ensureNoError(subjectError, 'Failed to load student learning subjects');

    const profilesByClass = new Map(profiles.map((row) => [row.class_id, row]));
    const coursesById = new Map(courses.map((row) => [row.id, row]));
    const subjectsById = new Map(((subjectData || []) as Row[]).map((row) => [row.id, row.name]));

    return enrollments.map((enrollment) => {
        const cls = Array.isArray(enrollment.classes) ? enrollment.classes[0] : enrollment.classes;
        const profile = profilesByClass.get(enrollment.class_id);
        const course = profile?.course_id ? coursesById.get(profile.course_id) : null;
        const subjectId = profile?.subject_id || course?.subject_id || null;
        const courseTitle = course?.title || null;
        return {
            classId: enrollment.class_id,
            className: cls?.name || '이름 없는 반',
            grade: cls?.grade ?? null,
            color: profile?.color ?? null,
            courseTitle,
            subjectId,
            subjectName: subjectId ? subjectsById.get(subjectId) || courseTitle || '과목 미설정' : courseTitle || '과목 미설정',
        } satisfies StudentClassDescriptor;
    });
}

async function loadStudentAttempts(learning: SchemaClient, academyId: string, studentId: string): Promise<Row[]> {
    const { data, error } = await learning
        .from('attempts')
        .select('id,assignment_id,session_id,problem_id,correct,unsure,attempt_no,created_at')
        .eq('academy_id', academyId)
        .eq('core_student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(5000);
    ensureNoError(error, 'Failed to load student learning attempts');
    return (data || []) as Row[];
}

function recentFirstAttemptStats(attempts: Row[]) {
    return summarizeRecentFirstAttempts(attempts.map((row) => ({
        problemId: row.problem_id,
        correct: row.correct === true,
        attemptNo: toNumber(row.attempt_no),
        createdAt: String(row.created_at || ''),
    })));
}

async function loadLearningPaths(
    learning: SchemaClient,
    academyId: string,
    classIds: string[],
    studentId: string,
): Promise<Map<string, StudentLearningPathSummary[]>> {
    if (classIds.length === 0) return new Map();
    const { data, error } = await learning
        .from('analysis_plans')
        .select('id,class_id,name,status,plan_type,path_role,path_purpose,metadata')
        .eq('academy_id', academyId)
        .eq('plan_type', 'study_track')
        .in('class_id', classIds)
        .in('status', ['draft', 'active', 'completed'])
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load student learning paths');
    const plans = (data || []) as Row[];
    const planIds = uniqueStrings(plans.map((row) => row.id));
    const excluded = new Set<string>();
    if (planIds.length > 0) {
        const { data: overrideData, error: overrideError } = await learning
            .from('analysis_plan_student_overrides')
            .select('plan_id,included')
            .eq('student_id', studentId)
            .in('plan_id', planIds);
        ensureNoError(overrideError, 'Failed to load student learning path overrides');
        for (const row of (overrideData || []) as Row[]) {
            if (row.included === false) excluded.add(row.plan_id);
        }
    }

    const byClass = new Map<string, StudentLearningPathSummary[]>();
    for (const row of plans) {
        if (excluded.has(row.id)) continue;
        const metadata = row.metadata || {};
        const path = {
            id: row.id,
            name: row.name,
            purpose: normalizePathPurpose(row.path_purpose || metadata.purpose),
            role: row.path_role === 'supplemental' || metadata.role === 'secondary' || metadata.is_primary === false ? 'secondary' : 'primary',
            status: normalizePathStatus(row.status),
        } satisfies StudentLearningPathSummary;
        byClass.set(row.class_id, [...(byClass.get(row.class_id) || []), path]);
    }
    return byClass;
}

async function loadStudentLearningOverviewData(
    core: SchemaClient,
    lms: SchemaClient,
    learning: SchemaClient,
    content: SchemaClient,
    academyId: string,
    studentId: string,
    visibleClassIds: Set<string> | null,
): Promise<StudentLearningOverview> {
    const [allClasses, allAssignments, attempts] = await Promise.all([
        loadStudentClassDescriptors(core, lms, academyId, studentId),
        loadAssignmentInsights(learning, content, academyId, studentId),
        loadStudentAttempts(learning, academyId, studentId),
    ]);
    const classes = visibleClassIds ? allClasses.filter((row) => visibleClassIds.has(row.classId)) : allClasses;
    const assignments = visibleClassIds
        ? allAssignments.filter((row) => Boolean(row.classId && visibleClassIds.has(row.classId)))
        : allAssignments;
    const visibleAssignmentIds = new Set(assignments.map((row) => row.id));
    const visibleAttempts = visibleClassIds
        ? attempts.filter((row) => Boolean(row.assignment_id && visibleAssignmentIds.has(row.assignment_id)))
        : attempts;
    const pathsByClass = await loadLearningPaths(learning, academyId, classes.map((row) => row.classId), studentId);
    const assignmentById = new Map(assignments.map((row) => [row.id, row]));
    const attemptsByClass = new Map<string, Row[]>();
    let unclassifiedAttemptCount = 0;
    for (const attempt of visibleAttempts) {
        const assignment = attempt.assignment_id ? assignmentById.get(attempt.assignment_id) : null;
        if (assignment?.personal) continue;
        const classId = assignment?.classId || null;
        if (!classId) {
            unclassifiedAttemptCount += 1;
            continue;
        }
        attemptsByClass.set(classId, [...(attemptsByClass.get(classId) || []), attempt]);
    }

    const classSummaries: StudentLearningClassSummary[] = classes.map((row) => {
        const stats = recentFirstAttemptStats(attemptsByClass.get(row.classId) || []);
        const classAssignments = assignments.filter((assignment) => assignment.classId === row.classId);
        const pendingAssignments = classAssignments.filter((assignment) => assignment.active && assignment.progressStatus !== 'completed');
        const paths = pathsByClass.get(row.classId) || [];
        return {
            ...row,
            pathState: paths.length > 0 ? 'configured' : 'needs_setup',
            primaryPathName: paths.find((path) => path.role === 'primary' && path.status === 'active')?.name
                || paths.find((path) => path.role === 'primary')?.name
                || null,
            activePathCount: paths.filter((path) => path.status === 'active').length,
            status: attentionStatus(stats.sampleCount, stats.correctRate, pendingAssignments.filter((assignment) => assignment.overdue).length),
            ...stats,
            pendingAssignmentCount: pendingAssignments.length,
            dueSoonAssignmentCount: pendingAssignments.filter((assignment) => assignment.dueSoon || assignment.overdue).length,
        } satisfies StudentLearningClassSummary;
    });

    const grouped = new Map<string, StudentLearningClassSummary[]>();
    for (const row of classSummaries) {
        const key = row.subjectId || `unclassified:${row.subjectName}`;
        grouped.set(key, [...(grouped.get(key) || []), row]);
    }
    const subjects: StudentLearningSubjectSummary[] = [...grouped.values()].map((rows) => {
        const stats = recentFirstAttemptStats(rows.flatMap((row) => attemptsByClass.get(row.classId) || []));
        const overdueAssignments = rows.reduce((sum, row) => sum + row.dueSoonAssignmentCount, 0);
        return {
            subjectId: rows[0]?.subjectId || null,
            subjectName: rows[0]?.subjectName || '과목 미설정',
            status: attentionStatus(stats.sampleCount, stats.correctRate, overdueAssignments),
            sampleCount: stats.sampleCount,
            correctCount: stats.correctCount,
            correctRate: stats.correctRate,
            correctedProblemCount: stats.correctedProblemCount,
            pendingAssignmentCount: rows.reduce((sum, row) => sum + row.pendingAssignmentCount, 0),
            dueSoonAssignmentCount: overdueAssignments,
            classes: rows.sort((a, b) => a.className.localeCompare(b.className, 'ko')),
        } satisfies StudentLearningSubjectSummary;
    }).sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'ko'));

    const personalAssignments = assignments.filter((assignment) => assignment.personal);
    return {
        subjects,
        personalAssignments: [
            ...personalAssignments.filter((assignment) => assignment.active && assignment.progressStatus !== 'completed'),
            ...personalAssignments.filter((assignment) => assignment.progressStatus === 'completed').slice(0, 3),
        ],
        unclassifiedAttemptCount,
    };
}

async function assertStudentInClass(core: SchemaClient, studentId: string, classId: string) {
    const { data, error } = await core
        .from('class_students')
        .select('student_id')
        .eq('student_id', studentId)
        .eq('class_id', classId)
        .eq('status', 'active')
        .maybeSingle();
    ensureNoError(error, 'Failed to verify student class membership');
    if (!data?.student_id) throw new LmsAuthError('Student is not enrolled in this class.', 403);
}

async function loadClassAttempts(
    learning: SchemaClient,
    academyId: string,
    studentId: string,
    assignments: StudentAssignmentInsight[],
    classId: string,
): Promise<Row[]> {
    const assignmentIds = assignments.filter((row) => row.classId === classId).map((row) => row.id);
    if (assignmentIds.length === 0) return [];
    const attempts = await loadStudentAttempts(learning, academyId, studentId);
    const assignmentSet = new Set(assignmentIds);
    return attempts.filter((row) => assignmentSet.has(row.assignment_id));
}

async function loadPathUnitSeeds(
    core: SchemaClient,
    learning: SchemaClient,
    content: SchemaClient,
    classId: string,
    paths: StudentLearningPathSummary[],
): Promise<Row[]> {
    const [classBookResult, materialResult] = await Promise.all([
        core.from('class_books').select('book_id').eq('class_id', classId).eq('active', true),
        paths.length > 0
            ? learning.from('analysis_plan_materials').select('book_id').in('plan_id', paths.map((path) => path.id)).eq('material_type', 'book')
            : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(classBookResult.error, 'Failed to load class learning books');
    ensureNoError(materialResult.error, 'Failed to load learning path books');
    const bookIds = uniqueStrings([
        ...((classBookResult.data || []) as Row[]).map((row) => row.book_id),
        ...((materialResult.data || []) as Row[]).map((row) => row.book_id),
    ]);
    if (bookIds.length === 0) return [];
    const [bookResult, unitResult] = await Promise.all([
        content.from('books').select('id,title').in('id', bookIds),
        content.from('units').select('id,book_id,name,sort_order').in('book_id', bookIds).order('sort_order', { ascending: true }),
    ]);
    ensureNoError(bookResult.error, 'Failed to load learning path book names');
    ensureNoError(unitResult.error, 'Failed to load learning path units');
    const bookNames = new Map(((bookResult.data || []) as Row[]).map((row) => [row.id, row.title]));
    return ((unitResult.data || []) as Row[]).map((row) => ({ ...row, book_title: bookNames.get(row.book_id) || null }));
}

function unitSummariesFromAttempts(attempts: Row[], problemMeta: Map<string, ProblemMeta>, seeds: Row[]): StudentLearningUnitSummary[] {
    const groupedAttempts = groupAttemptsByProblem(attempts);
    const buckets = new Map<string, StudentLearningUnitSummary>();
    for (const seed of seeds) {
        buckets.set(seed.id, {
            unitId: seed.id,
            unitName: seed.name || '단원 미지정',
            bookId: seed.book_id || null,
            bookTitle: seed.book_title || null,
            sampleCount: 0,
            correctCount: 0,
            correctRate: null,
            correctedProblemCount: 0,
            status: 'insufficient',
            lastAttemptedAt: null,
        });
    }
    for (const [problemId, rows] of groupedAttempts) {
        const meta = problemMeta.get(problemId);
        if (!meta || rows.length === 0) continue;
        const key = meta.unitId || 'none';
        const bucket = buckets.get(key) || {
            unitId: meta.unitId,
            unitName: meta.unitName,
            bookId: meta.bookId,
            bookTitle: meta.bookTitle,
            sampleCount: 0,
            correctCount: 0,
            correctRate: null,
            correctedProblemCount: 0,
            status: 'insufficient' as const,
            lastAttemptedAt: null,
        };
        bucket.sampleCount += 1;
        if (rows[0]?.correct === true) bucket.correctCount += 1;
        if (rows[0]?.correct === false && rows.slice(1).some((row) => row.correct === true)) bucket.correctedProblemCount += 1;
        const latest = rows.at(-1)?.created_at || null;
        if (latest && (!bucket.lastAttemptedAt || latest > bucket.lastAttemptedAt)) bucket.lastAttemptedAt = latest;
        bucket.correctRate = accuracy(bucket.correctCount, bucket.sampleCount);
        bucket.status = scoreStatus(bucket.sampleCount, bucket.correctRate);
        buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => String(a.bookTitle || '').localeCompare(String(b.bookTitle || ''), 'ko')
        || a.unitName.localeCompare(b.unitName, 'ko'));
}

async function loadStudentAiConversationSummariesData(
    ai: SchemaClient,
    learning: SchemaClient,
    content: SchemaClient,
    academyId: string,
    studentId: string,
    options: { assignmentId?: string | null; conversationId?: string | null } = {},
    visibleClassIds: Set<string> | null = null,
): Promise<StudentAiConversationSummary[]> {
    const allAssignments = await loadAssignmentInsights(learning, content, academyId, studentId);
    const assignments = visibleClassIds
        ? allAssignments.filter((row) => Boolean(row.classId && visibleClassIds.has(row.classId)))
        : allAssignments;
    const assignmentById = new Map(assignments.map((row) => [row.id, row]));
    let query = ai
        .from('conversations')
        .select('id,title,status,source_app,created_at,updated_at,assignment_id,session_id,problem_id')
        .eq('academy_id', academyId)
        .or(`student_id.eq.${studentId},core_student_id.eq.${studentId}`)
        .eq('source_app', 'grade_app')
        .order('updated_at', { ascending: false })
        .limit(options.conversationId ? 1 : 100);
    if (options.conversationId) query = query.eq('id', options.conversationId);
    if (options.assignmentId) query = query.eq('assignment_id', options.assignmentId);
    const { data, error } = await query;
    ensureNoError(error, 'Failed to load student AI conversation summaries');
    const conversations = (data || []) as Row[];
    if (conversations.length === 0) return [];

    const sessionIds = uniqueStrings(conversations.map((row) => row.session_id));
    const sessionsById = new Map<string, Row>();
    if (sessionIds.length > 0) {
        const { data: sessionData, error: sessionError } = await learning
            .from('sessions')
            .select('id,academy_id,core_student_id,assignment_id')
            .in('id', sessionIds);
        ensureNoError(sessionError, 'Failed to resolve AI conversation sessions');
        for (const row of (sessionData || []) as Row[]) {
            if (row.academy_id === academyId && row.core_student_id === studentId) sessionsById.set(row.id, row);
        }
    }
    const problemIds = uniqueStrings(conversations.map((row) => row.problem_id));
    const attemptKeys = new Set<string>();
    if (sessionIds.length > 0 && problemIds.length > 0) {
        const { data: attemptData, error: attemptError } = await learning
            .from('attempts')
            .select('session_id,problem_id,core_student_id')
            .eq('core_student_id', studentId)
            .in('session_id', sessionIds)
            .in('problem_id', problemIds);
        ensureNoError(attemptError, 'Failed to verify AI conversation attempts');
        for (const row of (attemptData || []) as Row[]) attemptKeys.add(`${row.session_id}:${row.problem_id}`);
    }

    const { data: messageData, error: messageError } = await ai
        .from('messages')
        .select('id,conversation_id')
        .in('conversation_id', conversations.map((row) => row.id))
        .in('role', ['user', 'assistant'])
        .limit(5000);
    ensureNoError(messageError, 'Failed to count student AI messages');
    const messageCounts = new Map<string, number>();
    for (const row of (messageData || []) as Row[]) messageCounts.set(row.conversation_id, (messageCounts.get(row.conversation_id) || 0) + 1);
    const problemMeta = await loadProblemMeta(content, problemIds);

    return conversations.map((row) => {
        const session = row.session_id ? sessionsById.get(row.session_id) : null;
        const sessionAssignmentId = typeof session?.assignment_id === 'string' ? session.assignment_id : null;
        const assignmentId = row.assignment_id || sessionAssignmentId;
        const assignment = assignmentId ? assignmentById.get(assignmentId) : null;
        const problem = row.problem_id ? problemMeta.get(row.problem_id) : null;
        const messageCount = messageCounts.get(row.id) || 0;
        const canonical = Boolean(
            session
            && assignment
            && problem
            && sessionAssignmentId === assignment.id
            && (row.assignment_id == null || row.assignment_id === sessionAssignmentId)
            && attemptKeys.has(`${row.session_id}:${row.problem_id}`),
        );
        return {
            id: row.id,
            assignmentId: canonical ? assignment?.id || null : null,
            assignmentTitle: canonical ? assignment?.title || null : null,
            problemId: problem?.id || null,
            problemLabel: problem?.label || null,
            unitName: problem?.unitName || null,
            typeName: problem?.typeName || null,
            linkStatus: canonical ? 'linked' : 'needs_review',
            title: row.title ?? null,
            status: row.status,
            sourceApp: row.source_app ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount,
        } satisfies StudentAiConversationSummary;
    }).filter((row) => row.messageCount > 0)
        .filter((row) => visibleClassIds === null || row.linkStatus === 'linked')
        .filter((row) => !options.assignmentId || row.assignmentId === options.assignmentId);
}

function groupAiProblems(conversations: StudentAiConversationSummary[]): StudentAiProblemSummary[] {
    const grouped = new Map<string, StudentAiConversationSummary[]>();
    for (const conversation of conversations) {
        const key = conversation.problemId || `unlinked:${conversation.id}`;
        grouped.set(key, [...(grouped.get(key) || []), conversation]);
    }
    return [...grouped.entries()].map(([key, rows]) => ({
        problemId: key.startsWith('unlinked:') ? null : key,
        problemLabel: rows[0]?.problemLabel || '연결 확인 필요',
        unitName: rows[0]?.unitName || null,
        typeName: rows[0]?.typeName || null,
        conversationCount: rows.length,
        lastConversationAt: rows.map((row) => row.updatedAt).sort().at(-1) || '',
        conversations: rows,
    })).sort((a, b) => b.lastConversationAt.localeCompare(a.lastConversationAt));
}

async function loadAttendance(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    studentId: string,
): Promise<{ summary: StudentAttendanceSummary; rows: AttendanceRow[] }> {
    const { data, error } = await lms
        .from('attendance_records')
        .select('id,occurrence_id,student_id,status,attended_minutes,billable_minutes,notes,created_at')
        .eq('academy_id', academyId)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(20);
    ensureNoError(error, 'Failed to load student attendance');

    const rows = (data || []) as Row[];
    const occurrenceIds = uniqueStrings(rows.map((row) => row.occurrence_id));
    const occurrences = new Map<string, Row>();
    if (occurrenceIds.length > 0) {
        const { data: occurrenceData, error: occurrenceError } = await lms
            .from('lesson_occurrences')
            .select('id,class_id,occurrence_date,start_time,end_time')
            .eq('academy_id', academyId)
            .in('id', occurrenceIds);
        ensureNoError(occurrenceError, 'Failed to load attendance lesson occurrences');
        for (const row of (occurrenceData || []) as Row[]) occurrences.set(row.id, row);
    }

    const classIds = uniqueStrings([...occurrences.values()].map((row) => row.class_id));
    const classNames = new Map<string, string>();
    if (classIds.length > 0) {
        const { data: classes, error: classesError } = await core
            .from('classes')
            .select('id,name')
            .in('id', classIds);
        ensureNoError(classesError, 'Failed to load attendance class names');
        for (const row of (classes || []) as Row[]) classNames.set(row.id, row.name);
    }

    const summary: StudentAttendanceSummary = {
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
        makeup: 0,
        total: rows.length,
    };

    const students = await loadStudentSummaries(createAdminClient(), academyId, {
        studentIds: [studentId],
        includeBilling: false,
        includeWeakMetrics: false,
    });
    const studentName = students[0]?.name || 'Unknown student';

    const attendanceRows = rows.map((row) => {
        const status = row.status as keyof StudentAttendanceSummary;
        if (status in summary && status !== 'total') {
            summary[status] = toNumber(summary[status]) + 1;
        }
        const occurrence = occurrences.get(row.occurrence_id);
        return {
            id: row.id,
            occurrenceId: row.occurrence_id,
            studentId: row.student_id,
            studentName,
            classId: occurrence?.class_id || '',
            className: classNames.get(occurrence?.class_id) || '-',
            date: occurrence?.occurrence_date || '',
            startTime: String(occurrence?.start_time || '').slice(0, 5),
            endTime: String(occurrence?.end_time || '').slice(0, 5),
            status: row.status,
            attendedMinutes: row.attended_minutes ?? null,
            billableMinutes: row.billable_minutes ?? null,
            notes: row.notes ?? null,
        } satisfies AttendanceRow;
    });

    return { summary, rows: attendanceRows };
}

async function loadBillingForStudent(
    lms: SchemaClient,
    summary: StudentSummary,
): Promise<{ billing: BillingRow | null; payments: PaymentRow[] }> {
    const { data: invoicesData, error: invoicesError } = await lms
        .from('invoices')
        .select('id,student_id,total_amount,paid_amount,status,student_name_snapshot,service_month')
        .eq('student_id', summary.id)
        .order('service_month', { ascending: false })
        .limit(1);
    ensureNoError(invoicesError, 'Failed to load student invoices');

    const invoice = ((invoicesData || []) as Row[])[0];
    const invoiceIds = invoice?.id ? [invoice.id] : [];
    let paidAmount = toNumber(invoice?.paid_amount);

    if (invoiceIds.length > 0) {
        const { data: paidData, error: paidError } = await lms
            .from('payments')
            .select('amount')
            .eq('student_id', summary.id)
            .eq('status', COMPLETED_PAYMENT_STATUS)
            .in('invoice_id', invoiceIds);
        ensureNoError(paidError, 'Failed to load student paid totals');
        paidAmount = ((paidData || []) as Row[]).reduce((sum, row) => sum + toNumber(row.amount), 0);
    }

    const { data: paymentsData, error: paymentsError } = await lms
        .from('payments')
        .select('id,invoice_id,student_id,payment_date,amount,payment_method,status,notes,student_name_snapshot,payer_name_snapshot')
        .eq('student_id', summary.id)
        .order('payment_date', { ascending: false })
        .limit(8);
    ensureNoError(paymentsError, 'Failed to load student payments');

    return {
        billing: invoice ? {
            studentId: summary.id,
            studentName: invoice.student_name_snapshot || summary.name,
            billingMode: summary.billingMode,
            expectedAmount: toNumber(invoice.total_amount),
            invoicedAmount: toNumber(invoice.total_amount),
            paidAmount,
            status: invoice.status || 'not_issued',
            invoiceId: invoice.id,
        } : null,
        payments: ((paymentsData || []) as Row[]).map((row) => ({
            id: row.id,
            invoiceId: row.invoice_id ?? null,
            studentId: row.student_id,
            studentName: row.payer_name_snapshot || row.student_name_snapshot || summary.name,
            paymentDate: row.payment_date,
            amount: toNumber(row.amount),
            paymentMethod: row.payment_method ?? null,
            status: row.status,
            notes: row.notes ?? null,
        })),
    };
}

function parseHardDeletePreview(value: unknown): StudentHardDeletePreview {
    const payload = value && typeof value === 'object' ? value as Row : {};
    const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
    return {
        studentId: String(payload.studentId || ''),
        studentName: String(payload.studentName || ''),
        canHardDelete: Boolean(payload.canHardDelete),
        historicalRecordCount: toNumber(payload.historicalRecordCount),
        sharedIdentityCount: toNumber(payload.sharedIdentityCount),
        blockers: blockers.map((row: Row) => ({
            key: String(row.key || ''),
            label: String(row.label || row.key || ''),
            count: toNumber(row.count),
        })),
    };
}

export async function loadStudentHardDeletePreview(academyId: string, studentId: string): Promise<StudentHardDeletePreview> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('hard_delete_student_preview', {
        p_academy_id: academyId,
        p_student_id: studentId,
    });
    ensureNoError(error, 'Failed to load hard delete preview');
    return parseHardDeletePreview(data);
}

async function loadStudentSignupState(
    core: SchemaClient,
    academyId: string,
    studentId: string,
    personId: string,
    actorRole: LmsRoleContext['role'],
): Promise<{
    signupInvitation: StudentSignupInvitation | null;
    hasGradeAppAccount: boolean;
    gradeAppAccount: StudentGradeAppAccount | null;
}> {
    const [memberResult, inviteResult] = await Promise.all([
        core
            .from('academy_members')
            .select('id,user_account_id')
            .eq('academy_id', academyId)
            .eq('person_id', personId)
            .eq('role', 'student')
            .eq('active', true)
            .limit(1),
        core
            .from('account_invitations')
            .select('id,invite_code_display,expires_at,login_hint,accepted_at,created_at')
            .eq('academy_id', academyId)
            .eq('student_id', studentId)
            .eq('role', 'student')
            .is('accepted_at', null)
            .order('created_at', { ascending: false })
            .limit(1),
    ]);
    ensureNoError(memberResult.error, 'Failed to load student account status');
    ensureNoError(inviteResult.error, 'Failed to load student signup invitation');

    const member = ((memberResult.data || []) as Row[])[0];
    const userAccountId = typeof member?.user_account_id === 'string' ? member.user_account_id : null;
    const hasGradeAppAccount = Boolean(userAccountId);
    let gradeAppAccount: StudentGradeAppAccount | null = null;
    if (userAccountId && (actorRole === 'owner' || actorRole === 'admin')) {
        const accountResult = await core
            .from('user_accounts')
            .select('login_id,auth_email,status')
            .eq('id', userAccountId)
            .eq('person_id', personId)
            .maybeSingle();
        ensureNoError(accountResult.error, 'Failed to load student Grade app account');
        gradeAppAccount = parseStudentGradeAppAccount(actorRole, accountResult.data as Row | null);
    }

    const invite = ((inviteResult.data || []) as Row[])[0];
    const inviteCode = typeof invite?.invite_code_display === 'string' ? invite.invite_code_display : '';
    const expiresAt = typeof invite?.expires_at === 'string' ? invite.expires_at : '';
    const isUsable = inviteCode && expiresAt && new Date(expiresAt).getTime() > Date.now();

    return {
        hasGradeAppAccount,
        gradeAppAccount,
        signupInvitation: isUsable
            ? {
                id: invite.id,
                inviteCode,
                expiresAt,
                loginHint: invite.login_hint ?? null,
            }
            : null,
    };
}

export function parseStudentGradeAppAccount(
    actorRole: LmsRoleContext['role'],
    account: Row | null,
): StudentGradeAppAccount | null {
    if ((actorRole !== 'owner' && actorRole !== 'admin') || !account) return null;

    const loginId = typeof account.login_id === 'string' && account.login_id.trim()
        ? account.login_id.trim()
        : typeof account.auth_email === 'string' && account.auth_email.trim()
            ? account.auth_email.trim()
            : null;

    return {
        loginId,
        status: typeof account.status === 'string' ? account.status : 'unknown',
    };
}

function normalizeDetailSection(section?: string | null): StudentDetailSection {
    const value = section || 'full';
    return STUDENT_DETAIL_SECTIONS.has(value as StudentDetailSection) ? value as StudentDetailSection : 'full';
}

function blankStudentDetail(
    summary: StudentSummary,
    permissions: StudentOperationsPermissions,
    loadedSections: StudentDetailSection[],
): StudentDetail {
    return {
        summary,
        permissions,
        loadedSections,
        signupInvitation: null,
        hasGradeAppAccount: false,
        gradeAppAccount: null,
        learningOverview: null,
        attendanceSummary: { ...EMPTY_ATTENDANCE_SUMMARY },
        recentAttendance: [],
        billing: null,
        recentPayments: [],
        hardDeletePreview: null,
    };
}

export async function loadStudentLearningMetrics(context: LmsRoleContext, studentIds?: string[]): Promise<StudentLearningMetric[]> {
    const client = createAdminClient();
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    const assignedStudentIds = await loadAssignedStudentIds(client.schema('core'), assignedClassIds);
    const allowedIds = assignedStudentIds === null
        ? uniqueStrings(studentIds || [])
        : uniqueStrings(studentIds && studentIds.length > 0
            ? studentIds.filter((studentId) => assignedStudentIds.includes(studentId))
            : assignedStudentIds);

    if (allowedIds.length === 0) return [];

    const metrics = await loadWeakMetrics(client.schema('reporting'), context.academyId, allowedIds);
    return allowedIds.map((studentId) => {
        const value = metrics.get(studentId);
        return {
            studentId,
            weakTypeCount: value?.weakTypeCount ?? 0,
            avgTypeScore: value?.avgTypeScore ?? null,
            lastLearningAt: value?.lastLearningAt ?? null,
        };
    });
}

export async function loadStudentDetail(
    context: LmsRoleContext,
    studentId: string,
    section: StudentDetailSection | string = 'full',
): Promise<StudentDetail> {
    if (!studentId) throw new Error('Student id is required.');
    const requestedSection = normalizeDetailSection(section);

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);

    const permissions = permissionsForContext(context);
    const students = await loadStudentSummaries(client, context.academyId, {
        studentIds: [studentId],
        assignedClassIds,
        includeBilling: permissions.canViewBilling,
        includeWeakMetrics: false,
    });
    const summary = students[0];
    if (!summary) throw new LmsAuthError('Student access is not allowed for this role.', 403);

    const loadedSections: StudentDetailSection[] = requestedSection === 'full'
        ? ['learning', 'attendance', 'billing', 'management', 'full']
        : [requestedSection];
    const detail = blankStudentDetail(summary, permissions, loadedSections);
    if (permissions.canEdit) {
        const signupState = await loadStudentSignupState(
            core,
            context.academyId,
            studentId,
            summary.personId,
            context.role,
        );
        detail.signupInvitation = signupState.signupInvitation;
        detail.hasGradeAppAccount = signupState.hasGradeAppAccount;
        detail.gradeAppAccount = signupState.gradeAppAccount;
    }

    if (requestedSection === 'learning' || requestedSection === 'full') {
        detail.learningOverview = await loadStudentLearningOverviewData(
            core,
            lms,
            learning,
            content,
            context.academyId,
            studentId,
            assignedClassIds,
        );
    }

    if (requestedSection === 'attendance' || requestedSection === 'full') {
        const attendance = await loadAttendance(core, lms, context.academyId, studentId);
        detail.attendanceSummary = attendance.summary;
        detail.recentAttendance = attendance.rows;
    }

    if ((requestedSection === 'billing' || requestedSection === 'full') && permissions.canViewBilling) {
        const billingData = await loadBillingForStudent(lms, summary);
        detail.billing = billingData.billing;
        detail.recentPayments = billingData.payments;
    }

    if (requestedSection === 'full' && permissions.canHardDelete) {
        detail.hardDeletePreview = await loadStudentHardDeletePreview(context.academyId, studentId);
    }

    return detail;
}

export async function loadStudentLearningClassContext(
    context: LmsRoleContext,
    studentId: string,
    classId: string,
): Promise<StudentLearningClassContext> {
    if (!studentId || !classId) throw new Error('Student id and class id are required.');
    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const content = client.schema('content');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    await assertStudentInClass(core, studentId, classId);
    if (assignedClassIds && !assignedClassIds.has(classId)) throw new LmsAuthError('Class access is not allowed for this role.', 403);

    const assignments = await loadAssignmentInsights(learning, content, context.academyId, studentId);
    const classAssignments = assignments.filter((row) => row.classId === classId && (row.active || row.progressStatus === 'completed'));
    const paths = (await loadLearningPaths(learning, context.academyId, [classId], studentId)).get(classId) || [];
    const attempts = await loadClassAttempts(learning, context.academyId, studentId, assignments, classId);
    const problemMeta = await loadProblemMeta(content, uniqueStrings(attempts.map((row) => row.problem_id)));
    const seeds = paths.length > 0 ? await loadPathUnitSeeds(core, learning, content, classId, paths) : [];
    return {
        classId,
        pathState: paths.length > 0 ? 'configured' : 'needs_setup',
        paths,
        units: paths.length > 0 ? unitSummariesFromAttempts(attempts, problemMeta, seeds) : [],
        assignments: classAssignments,
    };
}

export async function loadStudentLearningUnitDetail(
    context: LmsRoleContext,
    studentId: string,
    classId: string,
    unitId: string | null,
): Promise<StudentLearningUnitDetail> {
    if (!studentId || !classId) throw new Error('Student id and class id are required.');
    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const content = client.schema('content');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    await assertStudentInClass(core, studentId, classId);
    if (assignedClassIds && !assignedClassIds.has(classId)) throw new LmsAuthError('Class access is not allowed for this role.', 403);

    const assignments = await loadAssignmentInsights(learning, content, context.academyId, studentId);
    const attempts = await loadClassAttempts(learning, context.academyId, studentId, assignments, classId);
    const problemMeta = await loadProblemMeta(content, uniqueStrings(attempts.map((row) => row.problem_id)));
    const normalizedUnitId = unitId && unitId !== 'none' ? unitId : null;
    const unitAttempts = attempts.filter((row) => (problemMeta.get(row.problem_id)?.unitId || null) === normalizedUnitId);
    const insight = buildUnitInsights(unitAttempts, problemMeta).find((row) => row.unitId === normalizedUnitId);
    const grouped = groupAttemptsByProblem(unitAttempts);
    const correctedByType = new Map<string, number>();
    for (const [problemId, rows] of grouped) {
        if (rows[0]?.correct !== false || !rows.slice(1).some((row) => row.correct === true)) continue;
        const meta = problemMeta.get(problemId);
        const key = meta?.typeId || 'none';
        correctedByType.set(key, (correctedByType.get(key) || 0) + 1);
    }
    const types: StudentLearningTypeSummary[] = (insight?.types || []).map((row) => ({
        typeId: row.typeId,
        typeName: row.typeName,
        sampleCount: row.sampleCount,
        correctCount: row.correctCount,
        correctRate: row.score,
        correctedProblemCount: correctedByType.get(row.typeId || 'none') || 0,
        status: row.status,
        lastAttemptedAt: row.lastAttemptedAt,
    }));
    return {
        classId,
        unitId: normalizedUnitId,
        unitName: insight?.unitName || '단원 미지정',
        types,
    };
}

export async function loadStudentLearningTypeEvidence(
    context: LmsRoleContext,
    studentId: string,
    classId: string,
    typeId: string | null,
    unitId: string | null,
): Promise<StudentLearningTypeEvidence> {
    if (!studentId || !classId) throw new Error('Student id and class id are required.');
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const learning = client.schema('learning');
    const content = client.schema('content');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    await assertStudentInClass(core, studentId, classId);
    if (assignedClassIds && !assignedClassIds.has(classId)) throw new LmsAuthError('Class access is not allowed for this role.', 403);

    const [allAssignments, allAttempts, allClasses] = await Promise.all([
        loadAssignmentInsights(learning, content, context.academyId, studentId),
        loadStudentAttempts(learning, context.academyId, studentId),
        loadStudentClassDescriptors(core, lms, context.academyId, studentId),
    ]);
    const assignments = assignedClassIds
        ? allAssignments.filter((row) => Boolean(row.classId && assignedClassIds.has(row.classId)))
        : allAssignments;
    const allowedAssignmentIds = new Set(assignments.map((row) => row.id));
    const attempts = assignedClassIds
        ? allAttempts.filter((row) => Boolean(row.assignment_id && allowedAssignmentIds.has(row.assignment_id)))
        : allAttempts;
    const classes = assignedClassIds ? allClasses.filter((row) => assignedClassIds.has(row.classId)) : allClasses;
    const problemMeta = await loadProblemMeta(content, uniqueStrings(attempts.map((row) => row.problem_id)));
    const normalizedTypeId = typeId && typeId !== 'none' ? typeId : null;
    const normalizedUnitId = unitId && unitId !== 'none' ? unitId : null;
    const matching = attempts.filter((row) => {
        const meta = problemMeta.get(row.problem_id);
        return (meta?.typeId || null) === normalizedTypeId
            && (normalizedTypeId !== null || (meta?.unitId || null) === normalizedUnitId);
    });
    const grouped = groupAttemptsByLearningSource(matching);
    const assignmentById = new Map(assignments.map((row) => [row.id, row]));
    const classById = new Map(classes.map((row) => [row.classId, row]));
    const evidence: StudentLearningEvidenceRow[] = [...grouped.entries()].map(([evidenceId, rows]) => {
        const first = rows[0];
        const latest = rows.at(-1) || first;
        const problemId = String(first?.problem_id || '');
        const meta = problemMeta.get(problemId);
        const assignment = first?.assignment_id ? assignmentById.get(first.assignment_id) : null;
        const classRow = assignment?.classId ? classById.get(assignment.classId) : null;
        return {
            id: evidenceId,
            problemId,
            problemLabel: meta?.label || problemId,
            assignmentId: assignment?.id || null,
            assignmentTitle: assignment?.title || null,
            classId: classRow?.classId || null,
            className: classRow?.className || null,
            bookTitle: meta?.bookTitle || null,
            firstCorrect: first?.correct === true,
            corrected: first?.correct === false && rows.slice(1).some((row) => row.correct === true),
            firstAttemptedAt: first?.created_at || '',
            lastAttemptedAt: latest?.created_at || first?.created_at || '',
        } satisfies StudentLearningEvidenceRow;
    }).sort((a, b) => b.lastAttemptedAt.localeCompare(a.lastAttemptedAt));
    const sampleMeta = [...problemMeta.values()].find((row) => (row.typeId || null) === normalizedTypeId);
    return {
        typeId: normalizedTypeId,
        typeName: sampleMeta?.typeName || '유형 미지정',
        evidence,
    };
}

export async function loadStudentAssignmentLearningDetail(
    context: LmsRoleContext,
    studentId: string,
    assignmentId: string,
): Promise<StudentAssignmentLearningDetail> {
    if (!studentId || !assignmentId) throw new Error('Student id and assignment id are required.');
    const client = createAdminClient();
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    const learning = client.schema('learning');
    const content = client.schema('content');
    const assignments = await loadAssignmentInsights(learning, content, context.academyId, studentId);
    const assignment = assignments.find((row) => row.id === assignmentId);
    if (!assignment) throw new LmsAuthError('Assignment access is not allowed for this student.', 403);
    if (assignedClassIds && (!assignment.classId || !assignedClassIds.has(assignment.classId))) {
        throw new LmsAuthError('Assignment access is not allowed for this role.', 403);
    }
    const conversations = await loadStudentAiConversationSummariesData(
        client.schema('ai'),
        learning,
        content,
        context.academyId,
        studentId,
        { assignmentId },
        assignedClassIds,
    );
    return { assignment, aiProblems: groupAiProblems(conversations) };
}

export async function loadStudentAiConversationDetail(
    context: LmsRoleContext,
    studentId: string,
    conversationId: string,
): Promise<StudentAiConversationDetail> {
    if (!studentId || !conversationId) throw new Error('Student id and conversation id are required.');
    const client = createAdminClient();
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    const summaries = await loadStudentAiConversationSummariesData(
        client.schema('ai'),
        client.schema('learning'),
        client.schema('content'),
        context.academyId,
        studentId,
        { conversationId },
        assignedClassIds,
    );
    const summary = summaries[0];
    if (!summary) throw new LmsAuthError('AI conversation access is not allowed.', 403);
    const { data, error } = await client.schema('ai')
        .from('messages')
        .select('id,conversation_id,role,content,created_at')
        .eq('conversation_id', conversationId)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true })
        .limit(500);
    ensureNoError(error, 'Failed to load student AI conversation messages');
    return {
        ...summary,
        messages: ((data || []) as Row[]).map((row) => ({
            id: row.id,
            conversationId: row.conversation_id,
            role: row.role === 'assistant' ? 'assistant' : 'user',
            content: row.content,
            createdAt: row.created_at,
        })),
    };
}

export async function loadStudentAiConversationFeed(
    context: LmsRoleContext,
    studentId: string,
    assignmentId?: string | null,
): Promise<StudentAiConversationSummary[]> {
    if (!studentId) throw new Error('Student id is required.');
    const client = createAdminClient();
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    const learning = client.schema('learning');
    const content = client.schema('content');
    return loadStudentAiConversationSummariesData(
        client.schema('ai'),
        learning,
        content,
        context.academyId,
        studentId,
        { assignmentId: assignmentId || null },
        assignedClassIds,
    );
}

export async function loadStudentRosterPageRows(input: {
    core: SchemaClient;
    academyId: string;
    assignedClassIds: Set<string> | null;
    filters: StudentRosterFilters;
    cursor: StudentRosterCursor | null;
    limit: number;
    signal?: AbortSignal;
}): Promise<Row[]> {
    if (input.assignedClassIds?.size === 0) return [];
    const classIds = input.filters.classId
        ? [input.filters.classId]
        : input.assignedClassIds ? [...input.assignedClassIds] : null;
    const select = [
        'id',
        'created_at',
        input.filters.q ? 'people!inner()' : null,
        classIds ? 'class_students!inner()' : null,
    ].filter((value): value is string => value !== null).join(',');

    let query = input.core
        .from('students')
        .select(select)
        .eq('academy_id', input.academyId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(input.limit + 1);
    if (input.filters.q) {
        query = query.or(buildPeopleSearchOrFilter(
            input.filters.q,
            ['display_name', 'full_name', 'phone', 'parent_name', 'parent_phone'],
        ), { referencedTable: 'people' });
    }
    if (classIds) {
        query = query
            .eq('class_students.status', 'active')
            .in('class_students.class_id', classIds);
    }
    if (input.filters.status === 'operations') query = query.neq('status', 'dropped');
    else if (input.filters.status !== 'all') query = query.eq('status', input.filters.status);
    if (input.cursor) {
        query = query.or(
            `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`,
        );
    }
    if (input.signal) query = query.abortSignal(input.signal);
    const { data, error } = await query;
    ensureNoError(error, 'Failed to load filtered student roster page');
    return (data || []) as Row[];
}

export async function loadStudentOperationsOverview(
    context: LmsRoleContext,
    options: {
        cursor?: string | null;
        limit?: string | number | null;
        q?: string | null;
        classId?: string | null;
        status?: string | null;
        signal?: AbortSignal;
    } = {},
): Promise<StudentOperationsOverview> {
    const client = createAdminClient();
    const core = client.schema('core');
    const filters = parseStudentRosterFilters(options);
    const filterKey = studentRosterFilterKey(filters);
    const cursor = decodeCursor(options.cursor, isStudentRosterCursor);
    if (cursor) assertRosterCursorFilter(cursor.filterKey, filterKey);
    const [assignedClassIds, classes] = await Promise.all([
        loadAssignedClassIdsForContext(context),
        loadClassOptionsForContext(context),
    ]);
    const permissions = permissionsForContext(context);
    const limit = normalizeCursorLimit(options.limit);

    if (filters.classId && !classes.some((row) => row.id === filters.classId)) {
        throw new ApiContractError({
            code: 'INVALID_FILTER',
            message: 'classId is not available in the current academy scope.',
            fieldErrors: { classId: ['Select a class available to the current user.'] },
        });
    }

    if (assignedClassIds?.size === 0) {
        return {
            students: [],
            classes,
            permissions,
            nextCursor: null,
            hasMore: false,
        };
    }

    const fetchedRows = await loadStudentRosterPageRows({
        core,
        academyId: context.academyId,
        assignedClassIds,
        filters,
        cursor,
        limit,
        signal: options.signal,
    });
    const hasMore = fetchedRows.length > limit;
    const pageRows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    const pageStudentIds = pageRows.map((row) => String(row.id));
    const summaries = await loadStudentSummaries(client, context.academyId, {
        studentIds: pageStudentIds,
        assignedClassIds,
        includeBilling: permissions.canViewBilling,
        includeWeakMetrics: false,
    });
    const summaryById = new Map(summaries.map((student) => [student.id, student]));
    const students = pageStudentIds.flatMap((id) => {
        const student = summaryById.get(id);
        return student ? [student] : [];
    });
    const lastRow = pageRows.at(-1);

    return {
        students,
        classes,
        permissions,
        hasMore,
        nextCursor: hasMore && lastRow
            ? encodeCursor({ createdAt: String(lastRow.created_at), id: String(lastRow.id), filterKey })
            : null,
    };
}
