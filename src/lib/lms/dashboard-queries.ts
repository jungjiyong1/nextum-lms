import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import { calculateInvoiceDraft } from '@/features/lms/billing';
import { COMPLETED_PAYMENT_STATUS } from '@/features/lms/status';
import type {
    BillingClassRuleType,
    BillingRow,
    DashboardData,
    StudentSummary,
    WeakTypeRow,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadAssignedClassIdsForContext, loadClassSummariesForContext } from './class-queries';
import type { LmsRoleContext } from './auth';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

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
            ? lms.from('student_billing_contracts').select('*').eq('academy_id', academyId).in('student_id', students.map((row) => row.id)).eq('status', 'active')
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
        .select('*')
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
        lms.from('student_billing_contracts').select('*').eq('academy_id', academyId).eq('status', 'active').in('student_id', studentIds),
        lms.from('billing_class_rules').select('*').eq('academy_id', academyId),
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
    const rules = ((rulesData || []) as Row[])
        .filter((row) => contractIds.includes(row.contract_id))
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
        lms.from('invoices').select('id,student_id,total_amount,paid_amount,status').eq('academy_id', academyId).eq('service_month', serviceMonth),
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
            studentName: student.name,
            billingMode: student.billingMode,
            expectedAmount,
            invoicedAmount: toNumber(invoice?.total_amount, expectedAmount),
            paidAmount: actualPaidAmount ?? toNumber(invoice?.paid_amount),
            status: invoice?.status || 'not_issued',
            invoiceId: invoice?.id ?? null,
        };
    });
}

async function countAiConversations(
    ai: SchemaClient,
    academyId: string,
    studentIds: string[] | null,
): Promise<number> {
    if (studentIds && studentIds.length === 0) return 0;

    const since = new Date();
    since.setDate(since.getDate() - 30);

    let query = ai
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('academy_id', academyId)
        .gte('created_at', since.toISOString());

    if (studentIds) {
        query = query.in('student_id', studentIds);
    }

    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
}

export async function loadDashboardDataForContext(
    context: LmsRoleContext,
    serviceMonth: string,
): Promise<DashboardData> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');
    const ai = client.schema('ai');
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    const assignedStudentIds = await loadAssignedStudentIds(core, assignedClassIds);
    const includeFinance = !requiresAssignedClassScope(context.role);

    const [classes, students, weakTypes, billing, aiConversationCount] = await Promise.all([
        loadClassSummariesForContext(context),
        loadStudents(core, lms, context.academyId, assignedStudentIds, assignedClassIds, includeFinance),
        loadWeakTypes(reporting, context.academyId, assignedClassIds, 12),
        includeFinance ? loadBilling(core, lms, context.academyId, serviceMonth) : Promise.resolve([]),
        countAiConversations(ai, context.academyId, assignedStudentIds),
    ]);

    return {
        classes,
        students,
        weakTypes,
        billing,
        aiConversationCount,
    };
}
