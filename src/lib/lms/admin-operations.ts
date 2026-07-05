import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;
type Row = Record<string, any>;

export type ResetTarget =
    | 'classrooms'
    | 'classes'
    | 'lessons'
    | 'schedules'
    | 'students'
    | 'instructors'
    | 'courses'
    | 'enrollments'
    | 'accounting'
    | 'all';

export interface ExportDateRange {
    startDate: string;
    endDate: string;
}

export interface TaxReportExportOptions extends ExportDateRange {
    includeRevenue?: boolean;
    includePayroll?: boolean;
    includeExpenses?: boolean;
    includeProfitLoss?: boolean;
}

type CsvValue = string | number | boolean | null | undefined;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function schema(client: LmsAdminClient, name: 'core' | 'lms') {
    return client.schema(name);
}

async function deleteByAcademy(db: SchemaClient, table: string, academyId: string) {
    const { error } = await db
        .from(table)
        .delete()
        .eq('academy_id', academyId);

    ensureNoError(error, `Failed to reset ${table}`);
}

async function resetSchedules(client: LmsAdminClient, academyId: string) {
    const lms = schema(client, 'lms');
    await deleteByAcademy(lms, 'attendance_records', academyId);
    await deleteByAcademy(lms, 'lesson_occurrences', academyId);
    await deleteByAcademy(lms, 'class_schedule_rules', academyId);
}

async function resetClasses(client: LmsAdminClient, academyId: string) {
    await resetSchedules(client, academyId);
    await deleteByAcademy(schema(client, 'lms'), 'class_profiles', academyId);
    await deleteByAcademy(schema(client, 'core'), 'classes', academyId);
}

async function resetStudents(client: LmsAdminClient, academyId: string) {
    const lms = schema(client, 'lms');
    const core = schema(client, 'core');
    await deleteByAcademy(lms, 'payments', academyId);
    await deleteByAcademy(lms, 'invoices', academyId);
    await deleteByAcademy(lms, 'student_billing_contracts', academyId);
    await deleteByAcademy(core, 'students', academyId);
}

async function resetAccountingData(client: LmsAdminClient, academyId: string) {
    const lms = schema(client, 'lms');
    await deleteByAcademy(lms, 'payments', academyId);
    await deleteByAcademy(lms, 'invoices', academyId);
    await deleteByAcademy(lms, 'expenses', academyId);
    await deleteByAcademy(lms, 'instructor_payments', academyId);
}

export async function resetLmsData(target: ResetTarget, academyId: string) {
    const client = createAdminClient();

    switch (target) {
        case 'classrooms':
            await deleteByAcademy(schema(client, 'lms'), 'classrooms', academyId);
            return;
        case 'classes':
        case 'lessons':
        case 'enrollments':
            await resetClasses(client, academyId);
            return;
        case 'schedules':
            await resetSchedules(client, academyId);
            return;
        case 'students':
            await resetStudents(client, academyId);
            return;
        case 'instructors':
            await deleteByAcademy(schema(client, 'core'), 'staff_members', academyId);
            return;
        case 'courses':
            await deleteByAcademy(schema(client, 'lms'), 'courses', academyId);
            return;
        case 'accounting':
            await resetAccountingData(client, academyId);
            return;
        case 'all':
            await resetAccountingData(client, academyId);
            await resetClasses(client, academyId);
            await resetStudents(client, academyId);
            await deleteByAcademy(schema(client, 'core'), 'staff_members', academyId);
            await deleteByAcademy(schema(client, 'lms'), 'classrooms', academyId);
            await deleteByAcademy(schema(client, 'lms'), 'courses', academyId);
            return;
        default:
            target satisfies never;
            throw new Error('Unsupported reset target.');
    }
}

function csvEscape(value: CsvValue): string {
    const rawText = value === null || value === undefined ? '' : String(value);
    const text = /^[=+\-@\t\r]/.test(rawText) ? `'${rawText}` : rawText;
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function csvSection(title: string, headers: string[], rows: CsvValue[][]): string {
    return [
        title,
        headers.map(csvEscape).join(','),
        ...rows.map((row) => row.map(csvEscape).join(',')),
    ].join('\r\n');
}

function dateRangeLabel({ startDate, endDate }: ExportDateRange): string {
    return `${startDate}_${endDate}`.replace(/[^0-9_-]/g, '');
}

async function peopleNames(core: SchemaClient, peopleIds: string[]) {
    const ids = [...new Set(peopleIds.filter(Boolean))];
    if (ids.length === 0) return new Map<string, string>();

    const { data, error } = await core
        .from('people')
        .select('id,full_name,display_name')
        .in('id', ids);
    ensureNoError(error, 'Failed to load people names');

    return new Map((data || []).map((row: Row) => [row.id, row.display_name || row.full_name || '']));
}

async function studentNameMap(client: LmsAdminClient, academyId: string) {
    const core = schema(client, 'core');
    const { data, error } = await core
        .from('students')
        .select('id,person_id')
        .eq('academy_id', academyId);
    ensureNoError(error, 'Failed to load students');

    const names = await peopleNames(core, (data || []).map((row: Row) => row.person_id));
    return new Map((data || []).map((row: Row) => [row.id, names.get(row.person_id) || '']));
}

async function staffNameMap(client: LmsAdminClient, academyId: string) {
    const core = schema(client, 'core');
    const { data, error } = await core
        .from('staff_members')
        .select('id,person_id')
        .eq('academy_id', academyId);
    ensureNoError(error, 'Failed to load staff');

    const names = await peopleNames(core, (data || []).map((row: Row) => row.person_id));
    return new Map((data || []).map((row: Row) => [row.id, names.get(row.person_id) || '']));
}

export async function buildTaxReportExport(options: TaxReportExportOptions, academyId: string) {
    const client = createAdminClient();
    const sections: string[] = [];

    if (options.includeRevenue) {
        const { data, error } = await schema(client, 'lms')
            .from('payments')
            .select('payment_date, student_id, amount, payment_method, status, notes')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .order('payment_date', { ascending: true });

        ensureNoError(error, 'Failed to export revenue');
        const names = await studentNameMap(client, academyId);
        sections.push(csvSection('Revenue', ['Date', 'Student', 'Amount', 'Method', 'Status', 'Notes'], (data || []).map((row: Row) => [
            row.payment_date,
            names.get(row.student_id),
            row.amount,
            row.payment_method,
            row.status,
            row.notes,
        ])));
    }

    if (options.includePayroll) {
        sections.push(await buildPayrollSection(client, options, academyId));
    }

    if (options.includeExpenses) {
        const { data, error } = await schema(client, 'lms')
            .from('expenses')
            .select('expense_date, category, amount, payment_method, recipient, description, notes')
            .eq('academy_id', academyId)
            .gte('expense_date', options.startDate)
            .lte('expense_date', options.endDate)
            .order('expense_date', { ascending: true });

        ensureNoError(error, 'Failed to export expenses');
        sections.push(csvSection('Expenses', ['Date', 'Category', 'Amount', 'Method', 'Recipient', 'Description', 'Notes'], (data || []).map((row: Row) => [
            row.expense_date,
            row.category,
            row.amount,
            row.payment_method,
            row.recipient,
            row.description,
            row.notes,
        ])));
    }

    if (options.includeProfitLoss) {
        sections.push(await buildProfitLossSection(client, options, academyId));
    }

    return {
        filename: `nextum-lms-tax-report-${dateRangeLabel(options)}.csv`,
        csv: sections.join('\r\n\r\n'),
    };
}

export async function buildPayrollExport(options: ExportDateRange, academyId: string) {
    const client = createAdminClient();
    return {
        filename: `nextum-lms-payroll-${dateRangeLabel(options)}.csv`,
        csv: await buildPayrollSection(client, options, academyId),
    };
}

async function buildPayrollSection(client: LmsAdminClient, options: ExportDateRange, academyId: string) {
    const { data, error } = await schema(client, 'lms')
        .from('instructor_payments')
        .select(`
            payment_date,
            instructor_id,
            recipient_name,
            gross_amount,
            withholding_type,
            withholding_rate,
            withholding_tax,
            local_tax,
            net_amount,
            hours_worked,
            payment_method,
            service_month,
            status,
            notes
        `)
        .eq('academy_id', academyId)
        .gte('payment_date', options.startDate)
        .lte('payment_date', options.endDate)
        .order('payment_date', { ascending: true });

    ensureNoError(error, 'Failed to export payroll');
    const names = await staffNameMap(client, academyId);
    return csvSection('Payroll', [
        'Date',
        'Recipient',
        'Gross Amount',
        'Income Tax',
        'Local Tax',
        'Net Amount',
        'Withholding Type',
        'Withholding Rate',
        'Hours',
        'Payment Method',
        'Service Month',
        'Status',
        'Notes',
    ], (data || []).map((row: Row) => [
        row.payment_date,
        row.recipient_name ?? names.get(row.instructor_id),
        row.gross_amount,
        row.withholding_tax ?? 0,
        row.local_tax ?? 0,
        row.net_amount,
        row.withholding_type ?? 'none',
        row.withholding_rate ?? 0,
        row.hours_worked,
        row.payment_method,
        row.service_month,
        row.status,
        row.notes,
    ]));
}

async function buildProfitLossSection(client: LmsAdminClient, options: ExportDateRange, academyId: string) {
    const lms = schema(client, 'lms');
    const [payments, expenses, payroll] = await Promise.all([
        lms
            .from('payments')
            .select('amount')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .eq('status', 'completed'),
        lms
            .from('expenses')
            .select('amount')
            .eq('academy_id', academyId)
            .gte('expense_date', options.startDate)
            .lte('expense_date', options.endDate),
        lms
            .from('instructor_payments')
            .select('gross_amount')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .eq('status', 'paid'),
    ]);

    ensureNoError(payments.error, 'Failed to export tuition summary');
    ensureNoError(expenses.error, 'Failed to export expense summary');
    ensureNoError(payroll.error, 'Failed to export payroll summary');

    const tuitionIncome = (payments.data || []).reduce((sum: number, row: Row) => sum + Number(row.amount || 0), 0);
    const otherExpenses = (expenses.data || []).reduce((sum: number, row: Row) => sum + Number(row.amount || 0), 0);
    const instructorSalary = (payroll.data || []).reduce((sum: number, row: Row) => sum + Number(row.gross_amount || 0), 0);
    const totalExpenses = otherExpenses + instructorSalary;

    return csvSection('Profit And Loss', ['Metric', 'Amount'], [
        ['Tuition income', tuitionIncome],
        ['Other income', 0],
        ['Total income', tuitionIncome],
        ['Instructor salary gross', instructorSalary],
        ['Other expenses', otherExpenses],
        ['Total expenses', totalExpenses],
        ['Net income', tuitionIncome - totalExpenses],
    ]);
}

export async function updateTaxSettingsForAcademy(settings: Record<string, unknown>, academyId: string) {
    const client = createAdminClient();
    const entries = Object.entries(settings).map(([key, value]) => ({
        key: `tax_${key}`,
        academy_id: academyId,
        value: String(value),
    }));

    for (const entry of entries) {
        const { error } = await schema(client, 'lms')
            .from('settings')
            .upsert(entry, { onConflict: 'academy_id,key' });

        ensureNoError(error, `Failed to save setting ${entry.key}`);
    }
}
