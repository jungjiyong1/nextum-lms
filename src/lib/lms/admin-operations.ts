import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

type LmsAdminClient = ReturnType<typeof createAdminClient>;

export type ResetTarget =
    | 'classrooms'
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

async function selectIds(
    client: LmsAdminClient,
    table: string,
    academyId: number,
): Promise<number[]> {
    const { data, error } = await client
        .from(table)
        .select('id')
        .eq('academy_id', academyId);

    ensureNoError(error, `Failed to select ${table}`);
    return (data || []).map((row) => Number(row.id)).filter(Number.isFinite);
}

async function deleteByAcademy(client: LmsAdminClient, table: string, academyId: number) {
    const { error } = await client
        .from(table)
        .delete()
        .eq('academy_id', academyId);

    ensureNoError(error, `Failed to reset ${table}`);
}

async function deleteByIds(client: LmsAdminClient, table: string, column: string, ids: number[]) {
    if (ids.length === 0) return;

    const { error } = await client
        .from(table)
        .delete()
        .in(column, ids);

    ensureNoError(error, `Failed to reset ${table}`);
}

async function lessonIds(client: LmsAdminClient, academyId: number) {
    return selectIds(client, 'lessons', academyId);
}

async function transactionIds(client: LmsAdminClient, academyId: number) {
    return selectIds(client, 'transactions', academyId);
}

async function resetSchedulesForAcademy(client: LmsAdminClient, academyId: number) {
    await deleteByIds(client, 'lesson_schedules', 'lesson_id', await lessonIds(client, academyId));
}

async function resetLessonRulesForAcademy(client: LmsAdminClient, academyId: number) {
    await deleteByIds(client, 'lesson_rules', 'lesson_id', await lessonIds(client, academyId));
}

export async function resetLmsData(target: ResetTarget, academyId: number) {
    const client = createAdminClient();

    switch (target) {
        case 'classrooms':
            await deleteByAcademy(client, 'classrooms', academyId);
            return;
        case 'lessons':
            await resetSchedulesForAcademy(client, academyId);
            await resetLessonRulesForAcademy(client, academyId);
            await deleteByAcademy(client, 'enrollments', academyId);
            await deleteByAcademy(client, 'lessons', academyId);
            return;
        case 'schedules':
            await resetSchedulesForAcademy(client, academyId);
            return;
        case 'students':
            await deleteByAcademy(client, 'student_payments', academyId);
            await deleteByAcademy(client, 'enrollments', academyId);
            await deleteByAcademy(client, 'students', academyId);
            return;
        case 'instructors':
            await deleteByAcademy(client, 'instructors', academyId);
            return;
        case 'courses':
            await deleteByAcademy(client, 'courses', academyId);
            return;
        case 'enrollments':
            await deleteByAcademy(client, 'enrollments', academyId);
            return;
        case 'accounting':
            await resetAccountingData(client, academyId);
            return;
        case 'all':
            await resetAccountingData(client, academyId);
            await deleteByAcademy(client, 'enrollments', academyId);
            await resetSchedulesForAcademy(client, academyId);
            await resetLessonRulesForAcademy(client, academyId);
            await deleteByAcademy(client, 'lessons', academyId);
            await deleteByAcademy(client, 'classrooms', academyId);
            await deleteByAcademy(client, 'students', academyId);
            await deleteByAcademy(client, 'instructors', academyId);
            await deleteByAcademy(client, 'courses', academyId);
            return;
        default:
            target satisfies never;
            throw new Error('Unsupported reset target.');
    }
}

async function resetAccountingData(client: LmsAdminClient, academyId: number) {
    await deleteByIds(client, 'transaction_lines', 'transaction_id', await transactionIds(client, academyId));
    await deleteByAcademy(client, 'transactions', academyId);
    await deleteByAcademy(client, 'student_payments', academyId);
    await deleteByAcademy(client, 'instructor_payments', academyId);
    await deleteByAcademy(client, 'expenses', academyId);
    await deleteByAcademy(client, 'other_income', academyId);
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

export async function buildTaxReportExport(options: TaxReportExportOptions, academyId: number) {
    const client = createAdminClient();
    const sections: string[] = [];

    if (options.includeRevenue) {
        const { data, error } = await client
            .from('student_payments')
            .select('payment_date, amount, payment_method, status, notes, students(name)')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .order('payment_date', { ascending: true });

        ensureNoError(error, 'Failed to export revenue');
        sections.push(csvSection('Revenue', ['Date', 'Student', 'Amount', 'Method', 'Status', 'Notes'], (data || []).map((row) => {
            const student = Array.isArray(row.students) ? row.students[0] : row.students;
            return [row.payment_date, student?.name, row.amount, row.payment_method, row.status, row.notes];
        })));
    }

    if (options.includePayroll) {
        sections.push(await buildPayrollSection(client, options, academyId));
    }

    if (options.includeExpenses) {
        const { data, error } = await client
            .from('expenses')
            .select('expense_date, category, amount, payment_method, recipient, description, notes')
            .eq('academy_id', academyId)
            .gte('expense_date', options.startDate)
            .lte('expense_date', options.endDate)
            .order('expense_date', { ascending: true });

        ensureNoError(error, 'Failed to export expenses');
        sections.push(csvSection('Expenses', ['Date', 'Category', 'Amount', 'Method', 'Recipient', 'Description', 'Notes'], (data || []).map((row) => [
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

export async function buildPayrollExport(options: ExportDateRange, academyId: number) {
    const client = createAdminClient();
    return {
        filename: `nextum-lms-payroll-${dateRangeLabel(options)}.csv`,
        csv: await buildPayrollSection(client, options, academyId),
    };
}

async function buildPayrollSection(client: LmsAdminClient, options: ExportDateRange, academyId: number) {
    const { data, error } = await client
        .from('instructor_payments')
        .select(`
            payment_date,
            amount,
            recipient_name,
            gross_amount,
            withholding_type,
            withholding_rate,
            withholding_tax,
            local_tax,
            net_amount,
            work_hours,
            payment_method,
            period_start,
            period_end,
            status,
            notes,
            instructors(name)
        `)
        .eq('academy_id', academyId)
        .gte('payment_date', options.startDate)
        .lte('payment_date', options.endDate)
        .order('payment_date', { ascending: true });

    ensureNoError(error, 'Failed to export payroll');
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
        'Period Start',
        'Period End',
        'Status',
        'Notes',
    ], (data || []).map((row) => {
        const instructor = Array.isArray(row.instructors) ? row.instructors[0] : row.instructors;
        const grossAmount = row.gross_amount ?? row.amount;
        const netAmount = row.net_amount ?? row.amount;
        return [
            row.payment_date,
            row.recipient_name ?? instructor?.name,
            grossAmount,
            row.withholding_tax ?? 0,
            row.local_tax ?? 0,
            netAmount,
            row.withholding_type ?? 'none',
            row.withholding_rate ?? 0,
            row.work_hours,
            row.payment_method,
            row.period_start,
            row.period_end,
            row.status,
            row.notes,
        ];
    }));
}

async function buildProfitLossSection(client: LmsAdminClient, options: ExportDateRange, academyId: number) {
    const [tuition, expenses, payroll] = await Promise.all([
        client
            .from('student_payments')
            .select('amount')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .in('status', ['paid', 'completed']),
        client
            .from('expenses')
            .select('amount')
            .eq('academy_id', academyId)
            .gte('expense_date', options.startDate)
            .lte('expense_date', options.endDate),
        client
            .from('instructor_payments')
            .select('amount')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate),
    ]);

    ensureNoError(tuition.error, 'Failed to export tuition summary');
    ensureNoError(expenses.error, 'Failed to export expense summary');
    ensureNoError(payroll.error, 'Failed to export payroll summary');

    const tuitionIncome = (tuition.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const otherExpenses = (expenses.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const instructorSalary = (payroll.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalExpenses = otherExpenses + instructorSalary;

    return csvSection('Profit And Loss', ['Metric', 'Amount'], [
        ['Tuition income', tuitionIncome],
        ['Other income', 0],
        ['Total income', tuitionIncome],
        ['Instructor salary', instructorSalary],
        ['Other expenses', otherExpenses],
        ['Total expenses', totalExpenses],
        ['Net income', tuitionIncome - totalExpenses],
    ]);
}

export async function updateTaxSettingsForAcademy(settings: Record<string, unknown>, academyId: number) {
    const client = createAdminClient();
    const entries = Object.entries(settings).map(([key, value]) => ({
        key: `tax_${key}`,
        academy_id: academyId,
        value: String(value),
    }));

    for (const entry of entries) {
        const { error } = await client
            .from('settings')
            .upsert(entry, { onConflict: 'academy_id,key' });

        ensureNoError(error, `Failed to save setting ${entry.key}`);
    }
}
