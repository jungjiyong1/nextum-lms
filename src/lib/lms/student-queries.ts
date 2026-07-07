import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import type {
    AttendanceRow,
    BillingRow,
    PaymentRow,
    StudentAiConversationRow,
    StudentAssignmentInsight,
    StudentAttendanceSummary,
    StudentDetail,
    StudentDetailSection,
    StudentHardDeletePreview,
    StudentLearningAnalytics,
    StudentLearningAttemptRow,
    StudentLearningMetric,
    StudentLearningPeriod,
    StudentLearningStatus,
    StudentOperationsOverview,
    StudentOperationsPermissions,
    StudentSignupInvitation,
    StudentSummary,
    StudentTypeInsight,
    StudentUnitInsight,
    WeakTypeRow,
} from '@/features/lms/types';
import { COMPLETED_PAYMENT_STATUS } from '@/features/lms/status';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadAssignedClassIdsForContext, loadClassOptionsForContext } from './class-queries';
import { LmsAuthError, type LmsRoleContext } from './auth';

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
const STUDENT_LEARNING_PERIODS = new Set<StudentLearningPeriod>(['30d', '90d', '180d', 'all']);

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

function normalizeLearningPeriod(value?: string | null): StudentLearningPeriod {
    return STUDENT_LEARNING_PERIODS.has(value as StudentLearningPeriod) ? value as StudentLearningPeriod : '90d';
}

function periodStartIso(period: StudentLearningPeriod): string | null {
    if (period === 'all') return null;
    const days = period === '30d' ? 30 : period === '180d' ? 180 : 90;
    const start = new Date();
    start.setDate(start.getDate() - days);
    return start.toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
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
            ? lms.from('student_billing_contracts').select('*').eq('academy_id', academyId).in('student_id', studentIds).eq('status', 'active')
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

async function loadWeakTypes(reporting: SchemaClient, academyId: string, studentId: string): Promise<WeakTypeRow[]> {
    const { data, error } = await reporting
        .from('v_student_type_weakness')
        .select('*')
        .eq('academy_id', academyId)
        .eq('student_id', studentId)
        .order('status', { ascending: true })
        .order('last_attempted_at', { ascending: false })
        .limit(12);
    ensureNoError(error, 'Failed to load student weak types');

    return ((data || []) as Row[]).map((row) => ({
        studentId: row.student_id,
        studentName: row.student_name || 'Unknown student',
        classId: row.class_id ?? null,
        typeName: row.type_name || 'Unknown type',
        sampleCount: toNumber(row.sample_count),
        correctCount: toNumber(row.correct_count),
        score: row.score === null || row.score === undefined ? null : Number(row.score),
        status: row.status,
        lastAttemptedAt: row.last_attempted_at ?? null,
    }));
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

interface LearningAnalyticsResult {
    analytics: StudentLearningAnalytics;
    recentAttempts: StudentLearningAttemptRow[];
    aiConversations: StudentAiConversationRow[];
}

function emptyLearningAnalytics(period: StudentLearningPeriod, assignmentId: string | null): StudentLearningAnalytics {
    return {
        period,
        assignmentId,
        overview: {
            attemptedProblemCount: 0,
            attemptCount: 0,
            correctAttemptCount: 0,
            correctRate: null,
            weakTypeCount: 0,
            watchTypeCount: 0,
            unitCount: 0,
            assignmentCount: 0,
            completedAssignmentCount: 0,
            aiConversationCount: 0,
            lastLearningAt: null,
        },
        units: [],
        assignments: [],
    };
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
    const [bookResult, unitResult, typeResult] = await Promise.all([
        bookIds.length ? content.from('books').select('id,title').in('id', bookIds) : Promise.resolve({ data: [], error: null }),
        unitIds.length ? content.from('units').select('id,name').in('id', unitIds) : Promise.resolve({ data: [], error: null }),
        typeIds.length ? content.from('problem_types').select('id,name').in('id', typeIds) : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(bookResult.error, 'Failed to load student learning books');
    ensureNoError(unitResult.error, 'Failed to load student learning units');
    ensureNoError(typeResult.error, 'Failed to load student learning types');

    const bookNames = new Map(((bookResult.data || []) as Row[]).map((row) => [row.id, row.title]));
    const unitNames = new Map(((unitResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const typeNames = new Map(((typeResult.data || []) as Row[]).map((row) => [row.id, row.name]));

    return new Map(problems.map((problem) => {
        const typeId = problem.problem_type_id || problem.type_id || null;
        const unitName = problem.unit_id ? unitNames.get(problem.unit_id) || '단원 미지정' : '단원 미지정';
        const typeName = typeId ? typeNames.get(typeId) || '유형 미지정' : '유형 미지정';
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
            .select('assignment_id')
            .eq('academy_id', academyId)
            .eq('student_id', studentId)
            .eq('active', true)
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
            .select('assignment_id,problem_id,correct,created_at')
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

    return assignments.map((assignment) => {
        const assignmentItems = items.filter((row) => row.assignment_id === assignment.id && row.required !== false && row.problem_id);
        const requiredProblemIds = uniqueStrings(assignmentItems.map((row) => row.problem_id));
        const assignmentAttempts = attempts.filter((row) => row.assignment_id === assignment.id);
        const assignmentSessions = sessions.filter((row) => row.assignment_id === assignment.id);
        const attemptedProblemIds = new Set(assignmentAttempts.map((row) => row.problem_id));
        const attemptedProblemCount = attemptedProblemIds.size;
        const correctAttemptCount = assignmentAttempts.filter((row) => row.correct === true).length;
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

        return {
            id: assignment.id,
            title: assignment.title || '제목 없는 과제',
            dueAt: assignment.due_at ?? null,
            status: assignment.status || 'published',
            active: assignment.active !== false,
            sourceType: assignment.source_type === 'worksheet' ? 'worksheet' : 'content_scope',
            bookTitle: assignment.book_id ? bookNames.get(assignment.book_id) ?? null : null,
            progressStatus,
            requiredProblemCount: requiredProblemIds.length,
            attemptedProblemCount,
            attemptCount: assignmentAttempts.length,
            correctAttemptCount,
            correctRate: accuracy(correctAttemptCount, assignmentAttempts.length),
            lastActivityAt,
        } satisfies StudentAssignmentInsight;
    }).sort((a, b) => String(b.lastActivityAt || b.dueAt || '').localeCompare(String(a.lastActivityAt || a.dueAt || '')));
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

function mapRecentAttempts(attempts: Row[], problemMeta: Map<string, ProblemMeta>, assignmentNames: Map<string, string>): StudentLearningAttemptRow[] {
    return attempts.slice(0, 12).map((row) => {
        const meta = problemMeta.get(row.problem_id);
        return {
            id: Number(row.id),
            problemId: row.problem_id,
            assignmentId: row.assignment_id ?? null,
            assignmentTitle: row.assignment_id ? assignmentNames.get(row.assignment_id) ?? null : null,
            unitId: meta?.unitId ?? null,
            unitName: meta?.unitName ?? null,
            typeId: meta?.typeId ?? null,
            typeName: meta?.typeName ?? null,
            label: meta?.label || row.problem_id,
            correct: Boolean(row.correct),
            unsure: Boolean(row.unsure),
            attemptNo: toNumber(row.attempt_no),
            durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : toNumber(row.duration_ms),
            createdAt: row.created_at,
        };
    });
}

async function loadAiConversations(
    ai: SchemaClient,
    learning: SchemaClient,
    academyId: string,
    studentId: string,
    assignmentId: string | null,
    assignmentNames: Map<string, string>,
): Promise<StudentAiConversationRow[]> {
    let query = ai
        .from('conversations')
        .select('id,title,status,source_app,created_at,updated_at,assignment_id,session_id')
        .eq('academy_id', academyId)
        .or(`student_id.eq.${studentId},core_student_id.eq.${studentId}`)
        .order('updated_at', { ascending: false })
        .limit(8);
    if (assignmentId) query = query.eq('assignment_id', assignmentId);

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load student AI conversations');

    const conversations = (data || []) as Row[];
    if (conversations.length === 0) return [];

    const sessionIds = uniqueStrings(conversations.map((row) => row.session_id));
    const sessionAssignments = new Map<string, string>();
    if (sessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await learning
            .from('sessions')
            .select('id,assignment_id')
            .in('id', sessionIds);
        ensureNoError(sessionsError, 'Failed to load AI conversation sessions');
        for (const session of (sessions || []) as Row[]) {
            if (session.assignment_id) sessionAssignments.set(session.id, session.assignment_id);
        }
    }

    const conversationIds = conversations.map((row) => row.id);
    const { data: messages, error: messageError } = await ai
        .from('messages')
        .select('id,conversation_id,role,content,created_at')
        .in('conversation_id', conversationIds)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true })
        .limit(200);
    ensureNoError(messageError, 'Failed to load student AI messages');

    const messagesByConversation = new Map<string, Row[]>();
    for (const message of (messages || []) as Row[]) {
        messagesByConversation.set(message.conversation_id, [...(messagesByConversation.get(message.conversation_id) || []), message]);
    }

    return conversations.map((row) => {
        const linkedAssignmentId = row.assignment_id || (row.session_id ? sessionAssignments.get(row.session_id) : null) || null;
        const rows = messagesByConversation.get(row.id) || [];
        return {
            id: row.id,
            assignmentId: linkedAssignmentId,
            assignmentTitle: linkedAssignmentId ? assignmentNames.get(linkedAssignmentId) ?? null : null,
            title: row.title ?? null,
            status: row.status,
            sourceApp: row.source_app ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messageCount: rows.length,
            messages: rows.map((message) => ({
                id: message.id,
                conversationId: message.conversation_id,
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: message.content,
                createdAt: message.created_at,
            })),
        } satisfies StudentAiConversationRow;
    }).filter((row) => !assignmentId || row.assignmentId === assignmentId);
}

async function loadLearningAnalytics(
    content: SchemaClient,
    learning: SchemaClient,
    ai: SchemaClient,
    academyId: string,
    studentId: string,
    options: { period?: string | null; assignmentId?: string | null } = {},
): Promise<LearningAnalyticsResult> {
    const period = normalizeLearningPeriod(options.period);
    const assignmentId = options.assignmentId || null;
    const startIso = periodStartIso(period);
    const assignmentInsights = await loadAssignmentInsights(learning, content, academyId, studentId);
    const assignmentNames = new Map(assignmentInsights.map((assignment) => [assignment.id, assignment.title]));

    let attemptQuery = learning
        .from('attempts')
        .select('id,assignment_id,session_id,problem_id,correct,unsure,attempt_no,duration_ms,created_at')
        .eq('academy_id', academyId)
        .eq('core_student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(500);
    if (startIso) attemptQuery = attemptQuery.gte('created_at', startIso);
    if (assignmentId) attemptQuery = attemptQuery.eq('assignment_id', assignmentId);

    const { data: attemptData, error: attemptError } = await attemptQuery;
    ensureNoError(attemptError, 'Failed to load student learning attempts');
    const attempts = (attemptData || []) as Row[];

    let seedProblemIds: string[] = [];
    if (assignmentId) {
        const { data: itemData, error: itemError } = await learning
            .from('assignment_items')
            .select('problem_id')
            .eq('assignment_id', assignmentId)
            .not('problem_id', 'is', null)
            .limit(500);
        ensureNoError(itemError, 'Failed to load selected assignment items');
        seedProblemIds = uniqueStrings(((itemData || []) as Row[]).map((row) => row.problem_id));
    }

    const problemMeta = await loadProblemMeta(content, uniqueStrings([...attempts.map((row) => row.problem_id), ...seedProblemIds]));
    const units = buildUnitInsights(attempts, problemMeta);
    const recentAttempts = mapRecentAttempts(attempts, problemMeta, assignmentNames);
    const aiConversations = await loadAiConversations(ai, learning, academyId, studentId, assignmentId, assignmentNames);
    const correctAttemptCount = attempts.filter((row) => row.correct === true).length;
    const weakTypeCount = units.reduce((sum, unit) => sum + unit.types.filter((type) => type.status === 'weak').length, 0);
    const watchTypeCount = units.reduce((sum, unit) => sum + unit.types.filter((type) => type.status === 'watch').length, 0);
    const filteredAssignments = assignmentId
        ? assignmentInsights.filter((assignment) => assignment.id === assignmentId)
        : assignmentInsights;
    const analytics = emptyLearningAnalytics(period, assignmentId);
    analytics.assignments = assignmentInsights;
    analytics.units = units;
    analytics.overview = {
        attemptedProblemCount: new Set(attempts.map((row) => row.problem_id)).size,
        attemptCount: attempts.length,
        correctAttemptCount,
        correctRate: accuracy(correctAttemptCount, attempts.length),
        weakTypeCount,
        watchTypeCount,
        unitCount: units.length,
        assignmentCount: filteredAssignments.length,
        completedAssignmentCount: filteredAssignments.filter((assignment) => assignment.progressStatus === 'completed').length,
        aiConversationCount: aiConversations.length,
        lastLearningAt: attempts[0]?.created_at || filteredAssignments[0]?.lastActivityAt || null,
    };

    return { analytics, recentAttempts, aiConversations };
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

async function loadReports(learning: SchemaClient, academyId: string, studentId: string) {
    const { data, error } = await learning
        .from('reports')
        .select('id,report_type,title,status,generated_at')
        .eq('academy_id', academyId)
        .eq('core_student_id', studentId)
        .order('generated_at', { ascending: false })
        .limit(8);
    ensureNoError(error, 'Failed to load student reports');

    return ((data || []) as Row[]).map((row) => ({
        id: row.id,
        reportType: row.report_type,
        title: row.title ?? null,
        status: row.status,
        generatedAt: row.generated_at,
    }));
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
): Promise<{ signupInvitation: StudentSignupInvitation | null; hasGradeAppAccount: boolean }> {
    const [memberResult, inviteResult] = await Promise.all([
        core
            .from('academy_members')
            .select('id,user_account_id')
            .eq('academy_id', academyId)
            .eq('person_id', personId)
            .eq('role', 'student')
            .eq('active', true)
            .not('user_account_id', 'is', null)
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

    const hasGradeAppAccount = ((memberResult.data || []) as Row[]).length > 0;
    const invite = ((inviteResult.data || []) as Row[])[0];
    const inviteCode = typeof invite?.invite_code_display === 'string' ? invite.invite_code_display : '';
    const expiresAt = typeof invite?.expires_at === 'string' ? invite.expires_at : '';
    const isUsable = inviteCode && expiresAt && new Date(expiresAt).getTime() > Date.now();

    return {
        hasGradeAppAccount,
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
        learningAnalytics: null,
        weakTypes: [],
        recentAttempts: [],
        attendanceSummary: { ...EMPTY_ATTENDANCE_SUMMARY },
        recentAttendance: [],
        billing: null,
        recentPayments: [],
        aiConversations: [],
        reports: [],
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
    options: { period?: string | null; assignmentId?: string | null } = {},
): Promise<StudentDetail> {
    if (!studentId) throw new Error('Student id is required.');
    const requestedSection = normalizeDetailSection(section);

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const ai = client.schema('ai');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);

    const permissions = permissionsForContext(context);
    const students = await loadStudentSummaries(client, context.academyId, {
        studentIds: [studentId],
        assignedClassIds,
        includeBilling: permissions.canViewBilling,
        includeWeakMetrics: requestedSection === 'learning' || requestedSection === 'full',
    });
    const summary = students[0];
    if (!summary) throw new LmsAuthError('Student access is not allowed for this role.', 403);

    const loadedSections: StudentDetailSection[] = requestedSection === 'full'
        ? ['learning', 'attendance', 'billing', 'management', 'full']
        : [requestedSection];
    const detail = blankStudentDetail(summary, permissions, loadedSections);
    if (permissions.canEdit) {
        const signupState = await loadStudentSignupState(core, context.academyId, studentId, summary.personId);
        detail.signupInvitation = signupState.signupInvitation;
        detail.hasGradeAppAccount = signupState.hasGradeAppAccount;
    }

    if (requestedSection === 'learning' || requestedSection === 'full') {
        const [weakTypes, learningData, reports] = await Promise.all([
            loadWeakTypes(reporting, context.academyId, studentId),
            loadLearningAnalytics(content, learning, ai, context.academyId, studentId, options),
            loadReports(learning, context.academyId, studentId),
        ]);
        detail.weakTypes = weakTypes;
        detail.learningAnalytics = learningData.analytics;
        detail.recentAttempts = learningData.recentAttempts;
        detail.aiConversations = learningData.aiConversations;
        detail.reports = reports;
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

export async function loadStudentAiConversationFeed(
    context: LmsRoleContext,
    studentId: string,
    assignmentId?: string | null,
): Promise<StudentAiConversationRow[]> {
    if (!studentId) throw new Error('Student id is required.');
    const client = createAdminClient();
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    await assertCanViewStudent(context, studentId, assignedClassIds);
    const learning = client.schema('learning');
    const content = client.schema('content');
    const assignmentInsights = await loadAssignmentInsights(learning, content, context.academyId, studentId);
    const assignmentNames = new Map(assignmentInsights.map((assignment) => [assignment.id, assignment.title]));
    return loadAiConversations(client.schema('ai'), learning, context.academyId, studentId, assignmentId || null, assignmentNames);
}

export async function loadStudentOperationsOverview(context: LmsRoleContext): Promise<StudentOperationsOverview> {
    const client = createAdminClient();
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    const assignedStudentIds = await loadAssignedStudentIds(client.schema('core'), assignedClassIds);
    const permissions = permissionsForContext(context);
    const [students, classes] = await Promise.all([
        loadStudentSummaries(client, context.academyId, {
            studentIds: assignedStudentIds,
            assignedClassIds,
            includeBilling: permissions.canViewBilling,
            includeWeakMetrics: false,
        }),
        loadClassOptionsForContext(context),
    ]);

    return { students, classes, permissions };
}
