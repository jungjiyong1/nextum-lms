import 'server-only';

import { COMPLETED_PAYMENT_STATUS, PAID_PAYROLL_STATUS } from '@/features/lms/status';
import { csvEscape, type CsvValue } from '@/lib/lms/csv';
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

export interface ResetTableSummary {
    schema: 'core' | 'lms';
    table: string;
    operation: 'delete' | 'archive' | 'close' | 'deactivate' | 'void' | 'expire';
    affectedRows: number;
}

export interface ResetSummary {
    target: ResetTarget;
    tables: ResetTableSummary[];
    totalAffectedRows: number;
}

const MAX_EXPORT_DETAIL_ROWS = 10000;
const MAX_EXPORT_RANGE_DAYS = 370;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function schema(client: LmsAdminClient, name: 'core' | 'lms') {
    return client.schema(name);
}

const resetTargets = new Set<ResetTarget>([
    'classrooms',
    'classes',
    'lessons',
    'schedules',
    'students',
    'instructors',
    'courses',
    'enrollments',
    'accounting',
    'all',
]);

const resetOperations = new Set<ResetTableSummary['operation']>([
    'delete',
    'archive',
    'close',
    'deactivate',
    'void',
    'expire',
]);

function asRecord(value: unknown): Row {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Reset RPC returned an invalid payload.');
    }
    return value as Row;
}

function parseResetTarget(value: unknown): ResetTarget {
    if (typeof value === 'string' && resetTargets.has(value as ResetTarget)) {
        return value as ResetTarget;
    }
    throw new Error('Reset RPC returned an invalid target.');
}

function parseResetSchema(value: unknown): ResetTableSummary['schema'] {
    if (value === 'core' || value === 'lms') return value;
    throw new Error('Reset RPC returned an invalid table schema.');
}

function parseResetOperation(value: unknown): ResetTableSummary['operation'] {
    if (typeof value === 'string' && resetOperations.has(value as ResetTableSummary['operation'])) {
        return value as ResetTableSummary['operation'];
    }
    throw new Error('Reset RPC returned an invalid operation.');
}

function parseAffectedRows(value: unknown): number {
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (Number.isInteger(numberValue) && numberValue >= 0) return numberValue;
    throw new Error('Reset RPC returned an invalid affected row count.');
}

function parseResetSummary(value: unknown): ResetSummary {
    const payload = asRecord(value);
    if (!Array.isArray(payload.tables)) {
        throw new Error('Reset RPC returned invalid table summaries.');
    }

    const tables = payload.tables.map((entry): ResetTableSummary => {
        const row = asRecord(entry);
        if (typeof row.table !== 'string' || row.table.length === 0) {
            throw new Error('Reset RPC returned an invalid table name.');
        }

        return {
            schema: parseResetSchema(row.schema),
            table: row.table,
            operation: parseResetOperation(row.operation),
            affectedRows: parseAffectedRows(row.affectedRows),
        };
    });

    const totalAffectedRows = parseAffectedRows(
        payload.totalAffectedRows ?? tables.reduce((sum, table) => sum + table.affectedRows, 0),
    );

    return {
        target: parseResetTarget(payload.target),
        tables,
        totalAffectedRows,
    };
}

export async function resetLmsData(target: ResetTarget, academyId: string): Promise<ResetSummary> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('reset_academy_data', {
        p_academy_id: academyId,
        p_target: target,
    });
    ensureNoError(error, 'Failed to reset LMS data');

    return parseResetSummary(data);
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

function parseDateOnly(value: string, field: string): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${field} must be YYYY-MM-DD.`);
    }

    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${field} is not a valid date.`);
    }
    if (new Date(parsed).toISOString().slice(0, 10) !== value) {
        throw new Error(`${field} is not a valid date.`);
    }

    return parsed;
}

function assertExportDateRange(options: ExportDateRange) {
    const start = parseDateOnly(options.startDate, 'startDate');
    const end = parseDateOnly(options.endDate, 'endDate');
    if (end < start) {
        throw new Error('Export endDate must be on or after startDate.');
    }

    const dayCount = Math.floor((end - start) / 86_400_000) + 1;
    if (dayCount > MAX_EXPORT_RANGE_DAYS) {
        throw new Error(`Export date range cannot exceed ${MAX_EXPORT_RANGE_DAYS} days.`);
    }
}

function assertExportRowLimit(rows: unknown[], section: string) {
    if (rows.length > MAX_EXPORT_DETAIL_ROWS) {
        throw new Error(`${section} export exceeds ${MAX_EXPORT_DETAIL_ROWS} rows. Narrow the date range.`);
    }
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
    assertExportDateRange(options);
    const client = createAdminClient();
    const sections: string[] = [];

    if (options.includeRevenue) {
        const { data, error } = await schema(client, 'lms')
            .from('payments')
            .select('payment_date, student_id, amount, payment_method, status, notes')
            .eq('academy_id', academyId)
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .order('payment_date', { ascending: true })
            .limit(MAX_EXPORT_DETAIL_ROWS + 1);

        ensureNoError(error, 'Failed to export revenue');
        assertExportRowLimit(data || [], 'Revenue');
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
            .order('expense_date', { ascending: true })
            .limit(MAX_EXPORT_DETAIL_ROWS + 1);

        ensureNoError(error, 'Failed to export expenses');
        assertExportRowLimit(data || [], 'Expenses');
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
    assertExportDateRange(options);
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
        .order('payment_date', { ascending: true })
        .limit(MAX_EXPORT_DETAIL_ROWS + 1);

    ensureNoError(error, 'Failed to export payroll');
    assertExportRowLimit(data || [], 'Payroll');
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
            .eq('status', COMPLETED_PAYMENT_STATUS),
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
            .eq('status', PAID_PAYROLL_STATUS),
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
