import 'server-only';

import { calculateInvoiceDraft } from '@/features/lms/billing';
import { COMPLETED_PAYMENT_STATUS } from '@/features/lms/status';
import type {
    AccountingOperationsOverview,
    BillingClassRuleType,
    BillingRow,
    ExpenseRow,
    InstructorPaymentRow,
    PaymentRow,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadStaffSummariesForAcademy } from './staff-queries';
import { loadStudentSummariesForAcademy } from './student-queries';
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

async function buildBillingDrafts(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    serviceMonth: string,
) {
    const range = monthRange(serviceMonth);
    const students = await loadStudentSummariesForAcademy(academyId);
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

async function loadBillingRows(
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

async function loadPaymentRows(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    startDate: string,
    endDate: string,
): Promise<PaymentRow[]> {
    const { data, error } = await lms
        .from('payments')
        .select('id,invoice_id,student_id,payment_date,amount,payment_method,status,notes')
        .eq('academy_id', academyId)
        .gte('payment_date', startDate)
        .lte('payment_date', endDate)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load payments');

    const payments = (data || []) as Row[];
    if (payments.length === 0) return [];

    const { data: students, error: studentsError } = await core
        .from('students')
        .select('id,person_id')
        .eq('academy_id', academyId)
        .in('id', uniqueStrings(payments.map((row) => row.student_id)));
    ensureNoError(studentsError, 'Failed to load payment students');

    const studentMap = new Map(((students || []) as Row[]).map((row) => [row.id, row]));
    const people = await fetchPeople(core, ((students || []) as Row[]).map((row) => row.person_id));

    return payments.map((row) => {
        const student = studentMap.get(row.student_id);
        const person = student ? people.get(student.person_id) : null;
        return {
            id: row.id,
            invoiceId: row.invoice_id ?? null,
            studentId: row.student_id,
            studentName: person?.display_name || person?.full_name || 'Unknown student',
            paymentDate: row.payment_date,
            amount: toNumber(row.amount),
            paymentMethod: row.payment_method ?? null,
            status: row.status,
            notes: row.notes ?? null,
        };
    });
}

async function loadExpenseRows(
    lms: SchemaClient,
    academyId: string,
    startDate: string,
    endDate: string,
): Promise<ExpenseRow[]> {
    const { data, error } = await lms
        .from('expenses')
        .select('id,expense_date,category,amount,payment_method,recipient,description,tax_deductible,has_receipt,notes')
        .eq('academy_id', academyId)
        .gte('expense_date', startDate)
        .lte('expense_date', endDate)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load expenses');

    return ((data || []) as Row[]).map((row) => ({
        id: row.id,
        expenseDate: row.expense_date,
        category: row.category,
        amount: toNumber(row.amount),
        paymentMethod: row.payment_method ?? null,
        recipient: row.recipient ?? null,
        description: row.description ?? null,
        taxDeductible: Boolean(row.tax_deductible),
        hasReceipt: Boolean(row.has_receipt),
        notes: row.notes ?? null,
    }));
}

async function loadInstructorPaymentRows(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    serviceMonth: string,
): Promise<InstructorPaymentRow[]> {
    const { data, error } = await lms
        .from('instructor_payments')
        .select('id,instructor_id,recipient_name,service_month,payment_date,gross_amount,withholding_type,withholding_rate,withholding_tax,local_tax,net_amount,hours_worked,hourly_rate,payment_method,status,notes')
        .eq('academy_id', academyId)
        .eq('service_month', serviceMonth)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load instructor payments');

    const rows = (data || []) as Row[];
    const staffIds = uniqueStrings(rows.map((row) => row.instructor_id));
    const { data: staffRows, error: staffError } = staffIds.length > 0
        ? await core.from('staff_members').select('id,person_id').eq('academy_id', academyId).in('id', staffIds)
        : { data: [], error: null };
    ensureNoError(staffError, 'Failed to load instructor payment staff');

    const staffMap = new Map(((staffRows || []) as Row[]).map((row) => [row.id, row]));
    const people = await fetchPeople(core, ((staffRows || []) as Row[]).map((row) => row.person_id));

    return rows.map((row) => {
        const staff = row.instructor_id ? staffMap.get(row.instructor_id) : null;
        const person = staff ? people.get(staff.person_id) : null;
        return {
            id: row.id,
            instructorId: row.instructor_id ?? null,
            instructorName: person?.display_name || person?.full_name || null,
            recipientName: row.recipient_name ?? null,
            serviceMonth: row.service_month,
            paymentDate: row.payment_date,
            grossAmount: toNumber(row.gross_amount),
            withholdingType: row.withholding_type,
            withholdingRate: toNumber(row.withholding_rate),
            withholdingTax: toNumber(row.withholding_tax),
            localTax: toNumber(row.local_tax),
            netAmount: toNumber(row.net_amount),
            hoursWorked: row.hours_worked === null || row.hours_worked === undefined ? null : Number(row.hours_worked),
            hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
            paymentMethod: row.payment_method ?? null,
            status: row.status,
            notes: row.notes ?? null,
        };
    });
}

export async function loadAccountingOperationsOverview(
    context: LmsRoleContext,
    serviceMonth: string,
): Promise<AccountingOperationsOverview> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const range = monthRange(serviceMonth);

    const [billing, payments, expenses, payroll, staff] = await Promise.all([
        loadBillingRows(core, lms, context.academyId, serviceMonth),
        loadPaymentRows(core, lms, context.academyId, range.start, range.end),
        loadExpenseRows(lms, context.academyId, range.start, range.end),
        loadInstructorPaymentRows(core, lms, context.academyId, serviceMonth),
        loadStaffSummariesForAcademy(context.academyId),
    ]);

    return {
        billing,
        payments,
        expenses,
        payroll,
        staff,
    };
}
