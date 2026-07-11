import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import { calculateInvoiceDraft } from '@/features/lms/billing';
import { COMPLETED_PAYMENT_STATUS, isPaidInvoiceStatus } from '@/features/lms/status';
import type {
    BillingClassRuleType,
    BillingRow,
    DashboardData,
    HomeDashboardActionStudent,
    HomeDashboardAdminAlerts,
    HomeDashboardAssignment,
    HomeDashboardAttendanceSummary,
    HomeDashboardClassRow,
    HomeDashboardLesson,
    HomeDashboardWeakType,
    LearningAssignmentSummary,
    StudentSummary,
    WeakTypeRow,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadLearningAssignmentsForContext } from './assignment-queries';
import { loadAssignedClassIdsForContext, loadClassSummariesForContext, loadSchedule } from './class-queries';
import type { LmsRoleContext } from './auth';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;
type DashboardScheduleRow = Awaited<ReturnType<typeof loadSchedule>>[number];

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function dateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDaysString(value: string, days: number): string {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + days);
    return dateString(date);
}

function startOfDayMs(value: string): number {
    return new Date(`${value}T00:00:00`).getTime();
}

function endOfDayMs(value: string): number {
    return new Date(`${value}T23:59:59.999`).getTime();
}

function percent(part: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((part / total) * 100);
}

function monthRange(serviceMonth: string): { start: string; end: string } {
    const [year, month] = serviceMonth.split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) {
        throw new Error('Service month must be YYYY-MM.');
    }
    return {
        start: `${serviceMonth}-01`,
        end: dateString(new Date(year, month, 0)),
    };
}

function isEffective(row: Row, startDate: string, endDate: string): boolean {
    const from = String(row.effective_from || startDate);
    const to = row.effective_to ? String(row.effective_to) : null;
    return from <= endDate && (!to || to >= startDate);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

async function fetchClassNames(core: SchemaClient, classIds: string[]): Promise<Map<string, string>> {
    const ids = uniqueStrings(classIds);
    if (ids.length === 0) return new Map();

    const { data, error } = await core
        .from('classes')
        .select('id,name')
        .in('id', ids);
    ensureNoError(error, 'Failed to load class names');

    return new Map(((data || []) as Row[]).map((row) => [row.id, row.name]));
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

async function loadStudents(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    studentIds: string[] | null,
    visibleClassIds: Set<string> | null,
    includeBilling: boolean,
): Promise<StudentSummary[]> {
    if (studentIds && studentIds.length === 0) return [];

    let studentsQuery = core
        .from('students')
        .select('id,person_id,status,school_type,grade')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false });

    if (studentIds) {
        studentsQuery = studentsQuery.in('id', studentIds);
    }

    const { data: studentsData, error: studentsError } = await studentsQuery;
    ensureNoError(studentsError, 'Failed to load students');

    const students = (studentsData || []) as Row[];
    if (students.length === 0) return [];

    let classRowsQuery = core
        .from('class_students')
        .select('class_id,student_id,status,classes(id,name)')
        .in('student_id', students.map((row) => row.id));

    const scopedClassIds = visibleClassIds ? [...visibleClassIds] : null;
    if (scopedClassIds) {
        if (scopedClassIds.length === 0) return [];
        classRowsQuery = classRowsQuery.in('class_id', scopedClassIds);
    }

    const [classRowsResult, contractsResult] = await Promise.all([
        classRowsQuery,
        includeBilling
            ? lms.from('student_billing_contracts').select('id,student_id,billing_mode,base_monthly_fee,hourly_rate').eq('academy_id', academyId).in('student_id', students.map((row) => row.id)).eq('status', 'active')
            : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(classRowsResult.error, 'Failed to load student classes');
    ensureNoError(contractsResult.error, 'Failed to load student contracts');

    const people = await fetchPeople(core, students.map((row) => row.person_id));
    const contracts = (contractsResult.data || []) as Row[];
    const contractMap = new Map(contracts.map((row) => [row.student_id, row]));
    const contractIds = contracts.map((row) => row.id);
    const rulesByContract = new Map<string, Row[]>();

    if (includeBilling && contractIds.length > 0) {
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
            baseMonthlyFee: includeBilling ? toNumber(contract?.base_monthly_fee) : 0,
            hourlyRate: includeBilling && contract?.hourly_rate !== null && contract?.hourly_rate !== undefined
                ? Number(contract.hourly_rate)
                : null,
            extraClassFee: includeBilling ? toNumber(extraClassFee) : 0,
        };
    });
}

async function loadWeakTypes(
    reporting: SchemaClient,
    academyId: string,
    assignedClassIds: Set<string> | null,
    limit = 12,
): Promise<WeakTypeRow[]> {
    const classIds = assignedClassIds ? [...assignedClassIds] : null;
    if (classIds && classIds.length === 0) return [];

    let query = reporting
        .from('v_student_type_weakness')
        .select('student_id,student_name,class_id,type_name,sample_count,correct_count,score,status,last_attempted_at')
        .eq('academy_id', academyId)
        .in('status', ['weak', 'watch'])
        .order('status', { ascending: true })
        .order('last_attempted_at', { ascending: false })
        .limit(limit);

    if (classIds) {
        query = query.in('class_id', classIds);
    }

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load weak type summary');

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

async function buildBillingDrafts(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    serviceMonth: string,
) {
    const range = monthRange(serviceMonth);
    const students = await loadStudents(core, lms, academyId, null, null, true);
    const studentIds = students.map((student) => student.id);
    if (studentIds.length === 0) return [];

    const [
        { data: contractsData, error: contractsError },
        { data: rulesData, error: rulesError },
        { data: occurrencesData, error: occurrencesError },
    ] = await Promise.all([
        lms.from('student_billing_contracts').select('id,student_id,billing_mode,base_monthly_fee,hourly_rate,effective_from,effective_to').eq('academy_id', academyId).eq('status', 'active').in('student_id', studentIds),
        lms.from('billing_class_rules').select('contract_id,class_id,rule_type,amount,effective_from,effective_to').eq('academy_id', academyId),
        lms
            .from('lesson_occurrences')
            .select('id,class_id,occurrence_date')
            .eq('academy_id', academyId)
            .gte('occurrence_date', range.start)
            .lte('occurrence_date', range.end),
    ]);
    ensureNoError(contractsError, 'Failed to load billing contracts');
    ensureNoError(rulesError, 'Failed to load billing rules');
    ensureNoError(occurrencesError, 'Failed to load billing occurrences');

    const contracts = ((contractsData || []) as Row[]).filter((row) => isEffective(row, range.start, range.end));
    const contractMap = new Map(contracts.map((row) => [row.student_id, row]));
    const contractIds = contracts.map((row) => row.id);
    const contractIdSet = new Set(contractIds);
    const rules = ((rulesData || []) as Row[])
        .filter((row) => contractIdSet.has(row.contract_id))
        .filter((row) => isEffective(row, range.start, range.end));
    const classIds = uniqueStrings([
        ...rules.map((row) => row.class_id),
        ...((occurrencesData || []) as Row[]).map((row) => row.class_id),
    ]);
    const classNames = await fetchClassNames(core, classIds);

    const occurrenceRows = (occurrencesData || []) as Row[];
    const occurrenceIds = occurrenceRows.map((row) => row.id);
    let attendanceRows: Row[] = [];
    if (occurrenceIds.length > 0) {
        const { data, error } = await lms
            .from('attendance_records')
            .select('occurrence_id,student_id,status,billable_minutes')
            .eq('academy_id', academyId)
            .in('occurrence_id', occurrenceIds)
            .in('student_id', studentIds);
        ensureNoError(error, 'Failed to load billing attendance');
        attendanceRows = (data || []) as Row[];
    }

    const occurrenceMap = new Map(occurrenceRows.map((row) => [row.id, row]));
    const rulesByContract = new Map<string, Row[]>();
    for (const rule of rules) {
        rulesByContract.set(rule.contract_id, [...(rulesByContract.get(rule.contract_id) || []), rule]);
    }

    const attendanceByStudent = new Map<string, Row[]>();
    for (const attendance of attendanceRows) {
        attendanceByStudent.set(attendance.student_id, [...(attendanceByStudent.get(attendance.student_id) || []), attendance]);
    }

    return students.map((student) => {
        const contract = contractMap.get(student.id);
        if (!contract) return { student, contract: null, draft: null };

        const draft = calculateInvoiceDraft({
            contract: {
                studentId: student.id,
                billingMode: contract.billing_mode,
                baseMonthlyFee: toNumber(contract.base_monthly_fee),
                hourlyRate: contract.hourly_rate === null || contract.hourly_rate === undefined ? null : Number(contract.hourly_rate),
            },
            rules: (rulesByContract.get(contract.id) || []).map((rule) => ({
                classId: rule.class_id,
                className: classNames.get(rule.class_id) || null,
                ruleType: rule.rule_type as BillingClassRuleType,
                amount: toNumber(rule.amount),
            })),
            attendances: (attendanceByStudent.get(student.id) || []).map((attendance) => {
                const occurrence = occurrenceMap.get(attendance.occurrence_id);
                return {
                    classId: occurrence?.class_id || '',
                    className: occurrence?.class_id ? classNames.get(occurrence.class_id) || null : null,
                    occurrenceId: attendance.occurrence_id,
                    status: attendance.status,
                    billableMinutes: attendance.billable_minutes ?? null,
                };
            }),
        });

        return { student, contract, draft };
    });
}

async function loadBilling(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    serviceMonth: string,
): Promise<BillingRow[]> {
    const [drafts, { data: invoicesData, error: invoicesError }] = await Promise.all([
        buildBillingDrafts(core, lms, academyId, serviceMonth),
        lms.from('invoices').select('id,student_id,total_amount,paid_amount,status,student_name_snapshot').eq('academy_id', academyId).eq('service_month', serviceMonth),
    ]);
    ensureNoError(invoicesError, 'Failed to load invoices');

    const invoices = new Map(((invoicesData || []) as Row[]).map((row) => [row.student_id, row]));
    const invoiceIds = ((invoicesData || []) as Row[]).map((row) => row.id).filter(Boolean);
    const paidByInvoice = new Map<string, number>();

    if (invoiceIds.length > 0) {
        const { data: paymentsData, error: paymentsError } = await lms
            .from('payments')
            .select('invoice_id,amount')
            .eq('academy_id', academyId)
            .eq('status', COMPLETED_PAYMENT_STATUS)
            .in('invoice_id', invoiceIds);
        ensureNoError(paymentsError, 'Failed to load paid invoice totals');
        for (const payment of (paymentsData || []) as Row[]) {
            paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) || 0) + toNumber(payment.amount));
        }
    }

    return drafts.map(({ student, draft }) => {
        const invoice = invoices.get(student.id);
        const expectedAmount = draft?.totalAmount ?? 0;
        const actualPaidAmount = invoice?.id ? paidByInvoice.get(invoice.id) : undefined;
        return {
            studentId: student.id,
            studentName: invoice?.student_name_snapshot || student.name,
            billingMode: student.billingMode,
            expectedAmount,
            invoicedAmount: toNumber(invoice?.total_amount, expectedAmount),
            paidAmount: actualPaidAmount ?? toNumber(invoice?.paid_amount),
            status: invoice?.status || 'not_issued',
            invoiceId: invoice?.id ?? null,
        };
    });
}

async function loadAttendanceRowsForOccurrences(
    lms: SchemaClient,
    academyId: string,
    occurrenceIds: string[],
    studentIds: string[],
): Promise<Row[]> {
    if (occurrenceIds.length === 0 || studentIds.length === 0) return [];

    const { data, error } = await lms
        .from('attendance_records')
        .select('id,occurrence_id,student_id,status')
        .eq('academy_id', academyId)
        .in('occurrence_id', occurrenceIds)
        .in('student_id', studentIds);
    ensureNoError(error, 'Failed to load dashboard attendance records');

    return (data || []) as Row[];
}

function toHomeLesson(item: {
    id: string;
    actualId: string | null;
    virtual: boolean;
    date: string;
    startTime: string;
    endTime: string;
    status: HomeDashboardLesson['status'];
    hasEnded: boolean;
    instructorName: string | null;
    classroomName: string | null;
}): HomeDashboardLesson {
    return {
        id: item.id,
        actualId: item.actualId,
        virtual: item.virtual,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        hasEnded: item.hasEnded,
        instructorName: item.instructorName,
        classroomName: item.classroomName,
    };
}

function isRelevantHomeAssignment(assignment: LearningAssignmentSummary, date: string): boolean {
    if (!assignment.active || assignment.status === 'archived') return false;
    const incomplete = assignment.progress.targetStudentCount > 0
        && assignment.progress.completedCount < assignment.progress.targetStudentCount;
    if (incomplete) return true;

    const todayEnd = endOfDayMs(date);
    if (assignment.dueAt && new Date(assignment.dueAt).getTime() <= todayEnd) return true;

    const recentCutoff = startOfDayMs(addDaysString(date, -14));
    const createdAt = new Date(assignment.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= recentCutoff && createdAt <= todayEnd;
}

function isDueSoon(dueAt: string | null, date: string): boolean {
    if (!dueAt) return false;
    const due = new Date(dueAt).getTime();
    return due >= startOfDayMs(date) && due <= endOfDayMs(addDaysString(date, 3));
}

function toHomeAssignment(
    assignment: LearningAssignmentSummary,
    classId: string,
    date: string,
    classProgress?: LearningAssignmentSummary['classProgress'][number],
): HomeDashboardAssignment | null {
    const progress = classProgress || assignment.classProgress.find((row) => row.classId === classId);
    if (!progress) return null;

    return {
        id: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        status: assignment.status,
        active: assignment.active,
        bookTitle: assignment.bookTitle,
        problemCount: assignment.problemCount,
        targetStudentCount: progress.targetStudentCount,
        notStartedCount: progress.notStartedCount,
        inProgressCount: progress.inProgressCount,
        completedCount: progress.completedCount,
        completionRate: progress.completionRate,
        correctRate: progress.correctRate,
        overdue: Boolean(assignment.dueAt && new Date(assignment.dueAt).getTime() < startOfDayMs(date)),
        dueSoon: isDueSoon(assignment.dueAt, date),
    };
}

function attendanceLabel(status: string): string {
    const labels: Record<string, string> = {
        missing: '미기록',
        late: '지각',
        absent: '결석',
        excused: '인정 결석',
        makeup: '보강',
    };
    return labels[status] || status;
}

type AttendanceLookup = Map<string, Row>;

function attendanceLookupKey(occurrenceId: string, studentId: string): string {
    return `${occurrenceId}\u0000${studentId}`;
}

function buildAttendanceSummary(
    lessons: HomeDashboardLesson[],
    students: StudentSummary[],
    attendanceByStudentAndOccurrence: AttendanceLookup,
): HomeDashboardAttendanceSummary {
    const actualLessonIds = lessons.map((lesson) => lesson.actualId).filter((id): id is string => Boolean(id));
    const expected = actualLessonIds.length * students.length;
    const counts = {
        recorded: 0,
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
        makeup: 0,
    };
    for (const occurrenceId of actualLessonIds) {
        for (const student of students) {
            const record = attendanceByStudentAndOccurrence.get(attendanceLookupKey(occurrenceId, student.id));
            if (!record) continue;
            counts.recorded += 1;
            if (record.status === 'present') counts.present += 1;
            else if (record.status === 'late') counts.late += 1;
            else if (record.status === 'absent') counts.absent += 1;
            else if (record.status === 'excused') counts.excused += 1;
            else if (record.status === 'makeup') counts.makeup += 1;
        }
    }

    return {
        totalExpected: expected,
        ...counts,
        missing: Math.max(0, expected - counts.recorded),
    };
}

function weakTypeForHome(row: WeakTypeRow): HomeDashboardWeakType {
    return {
        studentId: row.studentId,
        studentName: row.studentName,
        typeName: row.typeName,
        score: row.score,
        status: row.status,
        lastAttemptedAt: row.lastAttemptedAt,
    };
}

function buildActionStudents(input: {
    classId: string;
    students: StudentSummary[];
    lessons: HomeDashboardLesson[];
    assignments: LearningAssignmentSummary[];
    weakTypes: WeakTypeRow[];
    attendanceByStudentAndOccurrence: AttendanceLookup;
}): HomeDashboardActionStudent[] {
    const studentsById = new Map(input.students.map((student) => [student.id, student]));
    const buckets = new Map<string, {
        assignmentTitles: Set<string>;
        weakTypes: HomeDashboardWeakType[];
        attendanceStatuses: Set<string>;
    }>();

    const ensure = (studentId: string) => {
        if (!studentsById.has(studentId)) return null;
        const bucket = buckets.get(studentId) || {
            assignmentTitles: new Set<string>(),
            weakTypes: [],
            attendanceStatuses: new Set<string>(),
        };
        buckets.set(studentId, bucket);
        return bucket;
    };

    for (const assignment of input.assignments) {
        for (const recipient of assignment.studentProgress) {
            if (recipient.classId !== input.classId || recipient.status === 'completed') continue;
            ensure(recipient.studentId)?.assignmentTitles.add(assignment.title);
        }
    }

    for (const weakType of input.weakTypes) {
        if (weakType.classId !== input.classId) continue;
        const bucket = ensure(weakType.studentId);
        if (bucket) bucket.weakTypes.push(weakTypeForHome(weakType));
    }

    const actualLessonIds = input.lessons.map((lesson) => lesson.actualId).filter((id): id is string => Boolean(id));
    for (const student of input.students) {
        for (const occurrenceId of actualLessonIds) {
            const record = input.attendanceByStudentAndOccurrence.get(attendanceLookupKey(occurrenceId, student.id));
            if (!record) {
                ensure(student.id)?.attendanceStatuses.add('missing');
                continue;
            }
            if (record.status !== 'present') {
                ensure(student.id)?.attendanceStatuses.add(String(record.status));
            }
        }
    }

    return [...buckets.entries()]
        .map(([studentId, bucket]) => {
            const student = studentsById.get(studentId);
            const assignmentTitles = [...bucket.assignmentTitles];
            const attendanceStatuses = [...bucket.attendanceStatuses].map(attendanceLabel);
            const priorityScore = assignmentTitles.length * 4 + bucket.weakTypes.length * 3 + attendanceStatuses.length * 2;
            return {
                studentId,
                studentName: student?.name || 'Unknown student',
                classId: input.classId,
                missingAssignmentCount: assignmentTitles.length,
                weakTypeCount: bucket.weakTypes.length,
                attendanceIssueCount: attendanceStatuses.length,
                assignmentTitles: assignmentTitles.slice(0, 3),
                weakTypes: bucket.weakTypes
                    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))
                    .slice(0, 3),
                attendanceStatuses,
                priorityScore,
            };
        })
        .filter((row) => row.priorityScore > 0)
        .sort((a, b) => b.priorityScore - a.priorityScore || a.studentName.localeCompare(b.studentName, 'ko'))
        .slice(0, 8);
}

function buildAdminAlerts(billing: BillingRow[]): HomeDashboardAdminAlerts {
    const unpaid = billing
        .filter((row) => row.expectedAmount > 0 && !isPaidInvoiceStatus(row.status))
        .map((row) => {
            const amount = Math.max(0, (row.invoicedAmount || row.expectedAmount) - row.paidAmount);
            return {
                studentId: row.studentId,
                studentName: row.studentName,
                status: row.status,
                amount,
            };
        })
        .sort((a, b) => b.amount - a.amount || a.studentName.localeCompare(b.studentName, 'ko'));

    return {
        unpaidBillingCount: unpaid.length,
        unpaidBillingAmount: unpaid.reduce((sum, row) => sum + row.amount, 0),
        unpaidBillingStudents: unpaid.slice(0, 5),
    };
}

export async function loadDashboardDataForContext(
    context: LmsRoleContext,
    serviceMonth: string,
    date: string,
): Promise<DashboardData> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    const assignedStudentIds = await loadAssignedStudentIds(core, assignedClassIds);
    const includeFinance = !requiresAssignedClassScope(context.role);

    const [classes, students, weakTypes, billing, schedule, assignments] = await Promise.all([
        loadClassSummariesForContext(context),
        loadStudents(core, lms, context.academyId, assignedStudentIds, assignedClassIds, includeFinance),
        loadWeakTypes(reporting, context.academyId, assignedClassIds, 80),
        includeFinance ? loadBilling(core, lms, context.academyId, serviceMonth) : Promise.resolve([]),
        loadSchedule(core, lms, context.academyId, date, date),
        loadLearningAssignmentsForContext(context, { limit: 80 }),
    ]);

    const scopedSchedule = assignedClassIds
        ? schedule.filter((item) => assignedClassIds.has(item.classId))
        : schedule;
    const todaySchedule = scopedSchedule.filter((item) => item.date === date && item.status !== 'cancelled');
    const todayClassIds = [...new Set(todaySchedule.map((item) => item.classId))];
    const todayClassIdSet = new Set(todayClassIds);
    const classMap = new Map(classes.map((row) => [row.id, row]));
    const scheduleByClass = new Map<string, DashboardScheduleRow[]>();
    for (const item of todaySchedule) {
        const rows = scheduleByClass.get(item.classId) || [];
        rows.push(item);
        scheduleByClass.set(item.classId, rows);
    }
    const activeStudents = students.filter((student) => student.status === 'active');
    const studentsByClass = new Map<string, StudentSummary[]>();
    const activeStudentIdsForToday = new Set<string>();
    for (const student of activeStudents) {
        for (const classId of student.classIds) {
            if (!todayClassIdSet.has(classId)) continue;
            const classStudents = studentsByClass.get(classId) || [];
            classStudents.push(student);
            studentsByClass.set(classId, classStudents);
            activeStudentIdsForToday.add(student.id);
        }
    }

    const occurrenceIds = todaySchedule.map((item) => item.actualId).filter((id): id is string => Boolean(id));
    const attendanceRows = await loadAttendanceRowsForOccurrences(
        lms,
        context.academyId,
        occurrenceIds,
        activeStudents.map((student) => student.id),
    );
    const attendanceByStudentAndOccurrence: AttendanceLookup = new Map();
    for (const row of attendanceRows) {
        attendanceByStudentAndOccurrence.set(attendanceLookupKey(row.occurrence_id, row.student_id), row);
    }
    const relevantAssignments = assignments.filter((assignment) => isRelevantHomeAssignment(assignment, date));
    const homeAssignmentsByClass = new Map<string, HomeDashboardAssignment[]>();
    const assignmentSourcesByClass = new Map<string, LearningAssignmentSummary[]>();
    for (const assignment of relevantAssignments) {
        const seenClassIds = new Set<string>();
        for (const progress of assignment.classProgress) {
            const classId = progress.classId;
            if (!classId || !todayClassIdSet.has(classId) || seenClassIds.has(classId)) continue;
            seenClassIds.add(classId);
            const homeAssignment = toHomeAssignment(assignment, classId, date, progress);
            if (homeAssignment) {
                const rows = homeAssignmentsByClass.get(classId) || [];
                rows.push(homeAssignment);
                homeAssignmentsByClass.set(classId, rows);
            }
            const sources = assignmentSourcesByClass.get(classId) || [];
            sources.push(assignment);
            assignmentSourcesByClass.set(classId, sources);
        }
    }
    const weakTypesByClass = new Map<string, WeakTypeRow[]>();
    for (const weakType of weakTypes) {
        if (!weakType.classId || !todayClassIdSet.has(weakType.classId)) continue;
        const rows = weakTypesByClass.get(weakType.classId) || [];
        rows.push(weakType);
        weakTypesByClass.set(weakType.classId, rows);
    }

    const dashboardClasses: HomeDashboardClassRow[] = todayClassIds
        .map((classId) => {
            const classSummary = classMap.get(classId);
            const classScheduleItems = scheduleByClass.get(classId) || [];
            const lessons = classScheduleItems
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                .map(toHomeLesson);
            const classStudents = studentsByClass.get(classId) || [];
            const classAssignments = (homeAssignmentsByClass.get(classId) || [])
                .sort((a, b) => {
                    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
                    if (a.dueSoon !== b.dueSoon) return a.dueSoon ? -1 : 1;
                    return a.title.localeCompare(b.title, 'ko');
                });
            const classAssignmentSource = assignmentSourcesByClass.get(classId) || [];
            let assignmentTargetCount = 0;
            let notStartedCount = 0;
            let inProgressCount = 0;
            let completedCount = 0;
            for (const assignment of classAssignments) {
                assignmentTargetCount += assignment.targetStudentCount;
                notStartedCount += assignment.notStartedCount;
                inProgressCount += assignment.inProgressCount;
                completedCount += assignment.completedCount;
            }
            const classWeakTypes = weakTypesByClass.get(classId) || [];
            const actionStudents = buildActionStudents({
                classId,
                students: classStudents,
                lessons,
                assignments: classAssignmentSource,
                weakTypes: classWeakTypes,
                attendanceByStudentAndOccurrence,
            });

            return {
                classId,
                className: classSummary?.name || classScheduleItems[0]?.className || 'Unknown class',
                grade: classSummary?.grade ?? null,
                color: classSummary?.color ?? null,
                instructorName: lessons[0]?.instructorName || classSummary?.instructorName || null,
                classroomName: lessons[0]?.classroomName || classSummary?.classroomName || null,
                studentCount: classStudents.length,
                lessons,
                assignmentProgress: {
                    assignmentCount: classAssignments.length,
                    targetStudentCount: assignmentTargetCount,
                    notStartedCount,
                    inProgressCount,
                    completedCount,
                    completionRate: percent(completedCount, assignmentTargetCount),
                },
                assignments: classAssignments.slice(0, 4),
                attendance: buildAttendanceSummary(lessons, classStudents, attendanceByStudentAndOccurrence),
                weakTypeCount: classWeakTypes.length,
                weakStudentCount: new Set(classWeakTypes.map((row) => row.studentId)).size,
                actionStudents,
            };
        })
        .sort((a, b) => (
            (a.lessons[0]?.startTime || '99:99').localeCompare(b.lessons[0]?.startTime || '99:99')
            || a.className.localeCompare(b.className, 'ko')
        ));

    const adminAlerts = includeFinance ? buildAdminAlerts(billing) : null;
    const actionStudentIds = new Set(dashboardClasses.flatMap((row) => row.actionStudents.map((student) => student.studentId)));

    return {
        date,
        serviceMonth,
        summary: {
            date,
            todayLessonCount: todaySchedule.length,
            todayClassCount: dashboardClasses.length,
            activeStudentCount: activeStudentIdsForToday.size,
            actionStudentCount: actionStudentIds.size,
            unpaidBillingCount: adminAlerts?.unpaidBillingCount ?? 0,
        },
        classes: dashboardClasses,
        adminAlerts,
    };
}
