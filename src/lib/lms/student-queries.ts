import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import type {
    AttendanceRow,
    BillingRow,
    PaymentRow,
    StudentAttendanceSummary,
    StudentDetail,
    StudentDetailSection,
    StudentHardDeletePreview,
    StudentLearningMetric,
    StudentOperationsOverview,
    StudentOperationsPermissions,
    StudentSummary,
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

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
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

async function loadRecentAttempts(learning: SchemaClient, academyId: string, studentId: string) {
    const { data, error } = await learning
        .from('attempts')
        .select('id,problem_id,correct,unsure,attempt_no,duration_ms,created_at')
        .eq('academy_id', academyId)
        .eq('core_student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(12);
    ensureNoError(error, 'Failed to load student attempts');

    return ((data || []) as Row[]).map((row) => ({
        id: Number(row.id),
        problemId: row.problem_id,
        correct: Boolean(row.correct),
        unsure: Boolean(row.unsure),
        attemptNo: toNumber(row.attempt_no),
        durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : toNumber(row.duration_ms),
        createdAt: row.created_at,
    }));
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

async function loadAiConversations(ai: SchemaClient, academyId: string, studentId: string) {
    const { data, error } = await ai
        .from('conversations')
        .select('id,title,status,source_app,created_at,updated_at')
        .eq('academy_id', academyId)
        .eq('student_id', studentId)
        .order('updated_at', { ascending: false })
        .limit(8);
    ensureNoError(error, 'Failed to load student AI conversations');

    return ((data || []) as Row[]).map((row) => ({
        id: row.id,
        title: row.title ?? null,
        status: row.status,
        sourceApp: row.source_app ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
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
): Promise<StudentDetail> {
    if (!studentId) throw new Error('Student id is required.');
    const requestedSection = normalizeDetailSection(section);

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');
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

    if (requestedSection === 'learning' || requestedSection === 'full') {
        const [weakTypes, recentAttempts, aiConversations, reports] = await Promise.all([
            loadWeakTypes(reporting, context.academyId, studentId),
            loadRecentAttempts(learning, context.academyId, studentId),
            loadAiConversations(ai, context.academyId, studentId),
            loadReports(learning, context.academyId, studentId),
        ]);
        detail.weakTypes = weakTypes;
        detail.recentAttempts = recentAttempts;
        detail.aiConversations = aiConversations;
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
