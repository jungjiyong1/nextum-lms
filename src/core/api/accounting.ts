// Accounting APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { ExpenseData, StudentPaymentData, Result } from './shared/types';
import { ok, err } from './shared/result';
import { calculateInstructorMonthlySalary } from './instructors';
import { resetAccounting as resetAccountingViaAdmin } from './reset';
import { requireCurrentAcademyId } from './currentAcademy';
import { calculateWithholding, type WithholdingType } from '../../modules/accounting/utils/taxCalculations';
import { getPayrollGrossAmount, getPayrollNetAmount } from '../../modules/accounting/utils/payrollAmounts';
import {
    LEGACY_COMPLETED_STUDENT_PAYMENT_STATUSES,
    isLegacyCompletedStudentPaymentStatus,
} from '../../features/lms/status';
import { BILLABLE_LESSON_SCHEDULE_STATUSES } from './scheduleStatus';

function toCurrencyNumber(value: unknown): number {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

interface DashboardData {
    monthlyRevenue: number;
    monthlyExpenses: number;
    pendingPayments: number;
    overduePayments: number;
    expectedRevenue: number;
    expectedExpenses: number;
    netIncome: number;
}

interface StudentMonthlyStatus {
    student_id: number;
    student_name: string;
    monthly_tuition: number;
    payment_cycle_day: number;
    is_paid: boolean;
    paid_amount: number;
    payment_date: string | null;
}

interface InstructorEstimate {
    id: number;
    name: string;
    hourly_rate: number;
    total_hours: number;
    estimated_salary: number;
    paid: boolean;
    paid_date?: string;
}

type TaxSettings = Record<string, string | number>;

interface IncomeTaxEstimate {
    grossIncome: number;
    deductibleExpenses: number;
    taxableIncome: number;
    calculatedTax: number;
    localTax: number;
    totalTax: number;
    withholdingPaid: number;
    additionalTax: number;
    refundAmount: number;
    effectiveRate: number;
}

interface WithholdingSummary {
    byMonth: Array<{ month: string; incomeTax: number; localTax: number; total: number }>;
    total: number;
}

interface VatSummary {
    taxType: string;
    vatRate: number;
    totalRevenue: number;
    taxableRevenue: number;
    exemptRevenue: number;
    estimatedVat: number;
}

interface IncomeStatement {
    tuitionIncome: number;
    otherIncome: number;
    otherIncomeByCategory: unknown[];
    totalIncome: number;
    instructorSalary: number;
    otherExpenses: number;
    expensesByCategory: Array<{ category: string; amount: number }>;
    totalExpenses: number;
    netIncome: number;
    taxDeductibleExpenses: number;
    withReceiptExpenses: number;
}

interface PayrollRecord {
    id: number;
    instructor_id: number | null;
    recipient_name: string;
    year_month: string;
    payment_date: string;
    payroll_date: string;
    instructor_name: string;
    gross_amount: number;
    withholding_type: WithholdingType;
    withholding_rate: number;
    withholding_tax: number;
    local_tax: number;
    net_amount: number;
    hours_worked: number | null;
    hourly_rate: number | null;
    payment_method: string | null;
    bank_name: string | null;
    account_number: string | null;
    notes: string | null;
    total_amount: number;
    status: string;
}

interface ExportDateRange {
    startDate: string;
    endDate: string;
}

interface TaxReportExportOptions extends ExportDateRange {
    includeRevenue?: boolean;
    includePayroll?: boolean;
    includeExpenses?: boolean;
    includeProfitLoss?: boolean;
}

async function parseErrorResponse(response: Response, fallback: string): Promise<Error> {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return new Error(payload?.error || fallback);
}

function parseAttachmentFilename(response: Response, fallback: string): string {
    const disposition = response.headers.get('content-disposition') || '';
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ''));

    const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
    return asciiMatch?.[1] || fallback;
}

function downloadBlob(filename: string, blob: Blob): string {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('CSV export is only available in the browser.');
    }

    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    return filename;
}

async function downloadAdminCsv(
    type: 'tax' | 'payroll',
    options: TaxReportExportOptions | ExportDateRange,
    fallbackFilename: string,
): Promise<string> {
    const academyId = await requireCurrentAcademyId();
    const response = await fetch('/api/lms/admin/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academyId, type, options }),
    });

    if (!response.ok) {
        throw await parseErrorResponse(response, `Export failed with HTTP ${response.status}`);
    }

    const filename = parseAttachmentFilename(response, fallbackFilename);
    return downloadBlob(filename, await response.blob());
}

// 회계 API - Supabase 연동
export const accountingApi = {
    // 대시보드 통계
    dashboard: async (yearMonth?: string): Promise<Result<DashboardData>> => {
        const now = new Date();
        const ym = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const startDate = `${ym}-01`;
        const lastDay = new Date(parseInt(ym.split('-')[0]), parseInt(ym.split('-')[1]), 0).getDate();
        const endDate = `${ym}-${String(lastDay).padStart(2, '0')}`;

        // 월별 수입 (학생 납부 - completed 상태)
        const { data: payments, error: paymentsError } = await supabase
            .from('student_payments')
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate)
            .in('status', LEGACY_COMPLETED_STUDENT_PAYMENT_STATUSES);

        if (paymentsError) return err(new Error(paymentsError.message));

        const monthlyRevenue = (payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);

        // 월별 지출 (expenses)
        const { data: expenses, error: expensesError } = await supabase
            .from('expenses')
            .select('amount')
            .gte('expense_date', startDate)
            .lte('expense_date', endDate);

        if (expensesError) return err(new Error(expensesError.message));

        const otherExpenses = (expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);

        // 강사 급여 (지급된 금액)
        const { data: instructorPayments, error: instructorPaymentsError } = await supabase
            .from('instructor_payments')
            .select('amount, gross_amount, net_amount, withholding_tax, local_tax')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (instructorPaymentsError) return err(new Error(instructorPaymentsError.message));

        const instructorCosts = (instructorPayments || []).reduce((sum, p) => sum + getPayrollGrossAmount(p), 0);
        const monthlyExpenses = otherExpenses + instructorCosts;

        // 예상 수입: 활성 학생들의 월 수강료 합계
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select('monthly_tuition, enrollment_date')
            .in('status', ['active', 'on_leave']);

        if (studentsError) return err(new Error(studentsError.message));

        // 선택한 월에 등록된 학생만 포함
        const eligibleStudents = (students || []).filter(s => {
            if (!s.enrollment_date) return true;
            return s.enrollment_date <= endDate;
        });
        const expectedRevenue = eligibleStudents.reduce((sum, s) => sum + (s.monthly_tuition || 0), 0);

        // 예상 지출: 강사 예상 급여 계산 (해당 월 수업 시간 * 시급)
        const { data: instructors, error: instructorsError } = await supabase
            .from('instructors')
            .select('id, hourly_rate, hire_date')
            .in('status', ['active', 'on_leave']);

        if (instructorsError) return err(new Error(instructorsError.message));

        // 선택한 월에 입사한 강사만 포함
        const eligibleInstructors = (instructors || []).filter(i => {
            if (!i.hire_date) return true;
            return i.hire_date <= endDate;
        });

        // 해당 월 수업 스케줄 조회
        const { data: schedules, error: schedulesError } = await supabase
            .from('lesson_schedules')
            .select('start_time, end_time, lessons!inner(instructor_id), substitute_instructor_id')
            .gte('date', startDate)
            .lte('date', endDate)
            .in('status', BILLABLE_LESSON_SCHEDULE_STATUSES);

        if (schedulesError) return err(new Error(schedulesError.message));

        // 강사별 예상 급여 계산
        let expectedExpenses = otherExpenses;
        eligibleInstructors.forEach(instructor => {
            let totalMinutes = 0;
            (schedules || []).forEach(s => {
                const lesson = Array.isArray(s.lessons) ? s.lessons[0] : s.lessons;
                // 대리 강의인 경우: substitute_instructor_id가 이 강사
                const isSubstitute = s.substitute_instructor_id === instructor.id;
                // 원래 강의인 경우: 원래 강사이고 대리가 없는 경우
                const isOriginal = lesson?.instructor_id === instructor.id && !s.substitute_instructor_id;

                if (isSubstitute || isOriginal) {
                    const start = s.start_time?.split(':').map(Number) || [0, 0];
                    const end = s.end_time?.split(':').map(Number) || [0, 0];
                    totalMinutes += (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
                }
            });
            const totalHours = totalMinutes / 60;
            expectedExpenses += Math.round(totalHours * (instructor.hourly_rate || 0));
        });

        // 미납 학생 수 (해당 월)
        const { data: pendingPayments, error: pendingError } = await supabase
            .from('student_payments')
            .select('id')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate)
            .eq('status', 'pending');

        if (pendingError) return err(new Error(pendingError.message));

        // 연체 (expected_date 지남)
        const today = new Date().toISOString().split('T')[0];
        const { data: overduePayments, error: overdueError } = await supabase
            .from('student_payments')
            .select('id')
            .eq('status', 'pending')
            .lt('expected_date', today);

        if (overdueError) return err(new Error(overdueError.message));

        const netIncome = monthlyRevenue - monthlyExpenses;

        return ok({
            monthlyRevenue,
            monthlyExpenses,
            pendingPayments: pendingPayments?.length || 0,
            overduePayments: overduePayments?.length || 0,
            expectedRevenue,
            expectedExpenses,
            netIncome,
        });
    },

    // 학생별 월 납부 현황
    studentMonthlyStatus: async (yearMonth?: string): Promise<Result<StudentMonthlyStatus[]>> => {
        const now = new Date();
        const ym = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const startDate = `${ym}-01`;
        const lastDay = new Date(parseInt(ym.split('-')[0]), parseInt(ym.split('-')[1]), 0).getDate();
        const endDate = `${ym}-${String(lastDay).padStart(2, '0')}`;

        // 모든 학생 가져오기 (등록일 포함)
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select('id, name, monthly_tuition, payment_cycle_day, enrollment_date, status')
            .in('status', ['active', 'on_leave']);

        if (studentsError) return err(new Error(studentsError.message));

        // 해당 월 납부 기록
        const { data: payments, error: paymentsError } = await supabase
            .from('student_payments')
            .select('student_id, amount, payment_date, status')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (paymentsError) return err(new Error(paymentsError.message));

        const completedPaymentMap = new Map<number, { amount: number; payment_date: string | null }>();
        (payments || []).forEach((payment) => {
            if (!isLegacyCompletedStudentPaymentStatus(payment.status)) return;
            const current = completedPaymentMap.get(payment.student_id) || { amount: 0, payment_date: null };
            const paymentDate = payment.payment_date || null;
            completedPaymentMap.set(payment.student_id, {
                amount: current.amount + toCurrencyNumber(payment.amount),
                payment_date: paymentDate && (!current.payment_date || paymentDate > current.payment_date)
                    ? paymentDate
                    : current.payment_date,
            });
        });

        // 선택한 월 이후에 등록된 학생은 제외
        const filteredStudents = (students || []).filter(s => {
            if (!s.enrollment_date) return true; // 등록일이 없으면 표시
            // 등록일이 선택한 월의 마지막 날보다 이후면 제외
            return s.enrollment_date <= endDate;
        });

        return ok(filteredStudents.map(s => {
            const payment = completedPaymentMap.get(s.id);
            const studentName = s.name || '이름없음';
            const isPaid = !!payment;
            return {
                student_id: s.id,
                student_name: studentName,
                monthly_tuition: s.monthly_tuition || 0,
                payment_cycle_day: s.payment_cycle_day || 1,
                is_paid: isPaid,
                paid_amount: isPaid ? payment?.amount || 0 : 0,
                payment_date: isPaid ? payment?.payment_date || null : null,
            };
        }));
    },

    // 강사별 월 예상 급여
    instructorEstimates: async (yearMonth?: string): Promise<Result<InstructorEstimate[]>> => {
        const now = new Date();
        const ym = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const startDate = `${ym}-01`;
        const year = parseInt(ym.split('-')[0]);
        const month = parseInt(ym.split('-')[1]);
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${ym}-${String(lastDay).padStart(2, '0')}`;

        // 강사 목록 (입사일 포함)
        const { data: instructors, error: instructorsError } = await supabase
            .from('instructors')
            .select('id, name, hourly_rate, hire_date, status')
            .in('status', ['active', 'on_leave']);

        if (instructorsError) return err(new Error(instructorsError.message));

        // 선택한 월 이후에 입사한 강사는 제외
        const filteredInstructors = (instructors || []).filter(i => {
            if (!i.hire_date) return true; // 입사일이 없으면 표시
            // 입사일이 선택한 월의 마지막 날보다 이후면 제외
            return i.hire_date <= endDate;
        });

        // 해당 월 급여 지급 기록
        const { data: payments, error: paymentsError } = await supabase
            .from('instructor_payments')
            .select('instructor_id, payment_date')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (paymentsError) return err(new Error(paymentsError.message));

        const paidSet = new Set((payments || []).map(p => p.instructor_id));

        // 각 강사별로 calculateInstructorMonthlySalary 호출하여 정확한 급여 계산
        const results: InstructorEstimate[] = [];

        for (const i of filteredInstructors) {
            const salaryResult = await calculateInstructorMonthlySalary(i.id, year, month);

            if (salaryResult.success && salaryResult.data) {
                results.push({
                    id: i.id,
                    name: i.name || '이름없음',
                    hourly_rate: i.hourly_rate || 0,
                    total_hours: salaryResult.data.totalHours,
                    estimated_salary: Math.round(salaryResult.data.estimatedSalary),
                    paid: paidSet.has(i.id),
                    paid_date: payments?.find(p => p.instructor_id === i.id)?.payment_date,
                });
            } else {
                // 급여 계산 실패 시 기본값 사용
                results.push({
                    id: i.id,
                    name: i.name || '이름없음',
                    hourly_rate: i.hourly_rate || 0,
                    total_hours: 0,
                    estimated_salary: 0,
                    paid: paidSet.has(i.id),
                    paid_date: payments?.find(p => p.instructor_id === i.id)?.payment_date,
                });
            }
        }

        return ok(results);
    },

    // 학생별 납부 내역
    studentPayments: async (studentId: number): Promise<Result<unknown[]>> => {
        const { data, error } = await supabase
            .from('student_payments')
            .select('*')
            .eq('student_id', studentId)
            .order('payment_date', { ascending: false });

        if (error) return err(new Error(error.message));
        return ok(data || []);
    },

    // 학생 납부 기록
    studentPayment: async (data: StudentPaymentData): Promise<Result<unknown>> => {
        const { data: created, error } = await supabase
            .from('student_payments')
            .insert({
                student_id: data.student_id,
                payment_date: data.payment_date,
                amount: data.amount,
                payment_method: data.payment_method || 'cash',
                expected_date: data.expected_date || null,
                status: data.status || 'completed',
                notes: data.notes || null,
            })
            .select()
            .single();

        if (error) return err(new Error(error.message));
        return ok(created);
    },

    // 학생 납부 취소
    cancelStudentPayment: async (studentId: number, yearMonth: string): Promise<Result<void>> => {
        const startDate = `${yearMonth}-01`;
        const lastDay = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]), 0).getDate();
        const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

        const { error } = await supabase
            .from('student_payments')
            .delete()
            .eq('student_id', studentId)
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (error) return err(new Error(error.message));
        return ok(undefined);
    },

    // 지출 목록
    getExpenses: async (startDate: string, endDate: string): Promise<Result<unknown[]>> => {
        const { data, error } = await supabase
            .from('expenses')
            .select('*')
            .gte('expense_date', startDate)
            .lte('expense_date', endDate)
            .order('expense_date', { ascending: false });

        if (error) return err(new Error(error.message));
        return ok(data || []);
    },

    // 지출 생성
    createExpense: async (data: ExpenseData): Promise<Result<unknown>> => {
        const { data: created, error } = await supabase
            .from('expenses')
            .insert({
                expense_date: data.expense_date,
                category: data.category,
                amount: data.amount,
                payment_method: data.payment_method || null,
                recipient: data.recipient || null,
                description: data.description || null,
                notes: data.notes || null,
            })
            .select()
            .single();

        if (error) return err(new Error(error.message));
        return ok(created);
    },

    // 지출 삭제
    deleteExpense: async (id: number): Promise<Result<void>> => {
        const { error } = await supabase
            .from('expenses')
            .delete()
            .eq('id', id);

        if (error) return err(new Error(error.message));
        return ok(undefined);
    },

    // 급여 생성
    createPayroll: async (data: {
        instructor_id: number | null;
        recipient_name?: string | null;
        year_month: string;
        payment_date: string;
        gross_amount: number;
        withholding_type?: WithholdingType;
        withholding_rate?: number;
        withholding_tax?: number;
        local_tax?: number;
        net_amount?: number;
        hours_worked?: number | null;
        hourly_rate?: number | null;
        payment_method?: string | null;
        notes?: string | null;
    }): Promise<Result<unknown>> => {
        const grossAmount = Number(data.gross_amount || 0);
        const withholdingType = data.withholding_type ?? 'none';
        const preview = calculateWithholding(grossAmount, withholdingType);
        const withholdingTax = data.withholding_tax ?? preview.incomeTax;
        const localTax = data.local_tax ?? preview.localTax;
        const netAmount = data.net_amount ?? Math.max(0, grossAmount - withholdingTax - localTax);
        const [year, month] = data.year_month.split('-').map(Number);
        const periodEndDay = new Date(year, month, 0).getDate();

        const { data: created, error } = await supabase
            .from('instructor_payments')
            .insert({
                instructor_id: data.instructor_id,
                payment_date: data.payment_date,
                recipient_name: data.recipient_name || null,
                gross_amount: grossAmount,
                withholding_type: withholdingType,
                withholding_rate: data.withholding_rate ?? preview.taxRate,
                withholding_tax: withholdingTax,
                local_tax: localTax,
                net_amount: netAmount,
                amount: netAmount,
                work_hours: data.hours_worked || null,
                period_start: `${data.year_month}-01`,
                period_end: `${data.year_month}-${String(periodEndDay).padStart(2, '0')}`,
                payment_method: data.payment_method || null,
                status: 'paid',
                notes: data.notes || null,
            })
            .select()
            .single();

        if (error) return err(new Error(error.message));
        return ok(created);
    },

    // 급여 목록
    listPayroll: async (yearMonth?: string): Promise<Result<PayrollRecord[]>> => {
        let query = supabase
            .from('instructor_payments')
            .select(`
        id,
        instructor_id,
        recipient_name,
        payment_date,
        amount,
        gross_amount,
        withholding_type,
        withholding_rate,
        withholding_tax,
        local_tax,
        net_amount,
        work_hours,
        period_start,
        period_end,
        payment_method,
        status,
        notes,
        instructors(name)
      `)
            .order('payment_date', { ascending: false });

        if (yearMonth) {
            const startDate = `${yearMonth}-01`;
            const lastDay = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]), 0).getDate();
            const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
            query = query.gte('payment_date', startDate).lte('payment_date', endDate);
        }

        const { data, error } = await query;
        if (error) return err(new Error(error.message));

        return ok((data || []).map((p) => {
            const instructor = Array.isArray(p.instructors) ? p.instructors[0] : p.instructors;
            const grossAmount = getPayrollGrossAmount(p);
            const withholdingTax = Number(p.withholding_tax ?? 0);
            const localTax = Number(p.local_tax ?? 0);
            const netAmount = getPayrollNetAmount(p);
            const recipientName = p.recipient_name || instructor?.name || '이름없음';
            return {
                id: p.id,
                instructor_id: p.instructor_id ?? null,
                recipient_name: recipientName,
                year_month: p.period_start?.slice(0, 7) || p.payment_date?.slice(0, 7) || '',
                payment_date: p.payment_date,
                payroll_date: p.payment_date,
                instructor_name: instructor?.name || recipientName,
                gross_amount: grossAmount,
                withholding_type: (p.withholding_type || 'none') as WithholdingType,
                withholding_rate: Number(p.withholding_rate ?? 0),
                withholding_tax: withholdingTax,
                local_tax: localTax,
                net_amount: netAmount,
                hours_worked: p.work_hours === null || p.work_hours === undefined ? null : Number(p.work_hours),
                hourly_rate: null,
                payment_method: p.payment_method ?? null,
                bank_name: null,
                account_number: null,
                notes: p.notes ?? null,
                total_amount: netAmount,
                status: p.status,
            };
        }));
    },

    // 강사별 급여 내역
    instructorPayments: async (instructorId: number): Promise<Result<unknown[]>> => {
        const { data, error } = await supabase
            .from('instructor_payments')
            .select('*')
            .eq('instructor_id', instructorId)
            .order('payment_date', { ascending: false });

        if (error) return err(new Error(error.message));
        return ok(data || []);
    },

    // 세금 설정 가져오기
    getTaxSettings: async (): Promise<Result<TaxSettings>> => {
        const { data, error } = await supabase
            .from('settings')
            .select('key, value')
            .like('key', 'tax_%');

        if (error) {
            return ok({
                business_type: 'sole_proprietor',
                tax_type: 'exempt',
                default_withholding: 'freelance_3.3',
                vat_rate: '10',
            });
        }

        const settings = (data || []).reduce((acc: Record<string, string>, row) => {
            acc[row.key.replace(/^tax_/, '')] = row.value;
            return acc;
        }, {});

        return ok({
            business_type: settings.business_type || 'sole_proprietor',
            tax_type: settings.tax_type || 'exempt',
            default_withholding: settings.default_withholding || 'freelance_3.3',
            vat_rate: settings.vat_rate || '10',
            withholdingType: settings.withholding_type || 'fixed',
            withholdingRate: parseFloat(settings.withholding_rate) || 3.3,
            localTaxRate: parseFloat(settings.local_rate) || 10,
            businessNumber: settings.business_number || '',
            taxReportEmail: settings.report_email || '',
        });
    },

    // 세금 설정 저장
    updateTaxSettings: async (newSettings: Record<string, string>): Promise<Result<void>> => {
        try {
            const academyId = await requireCurrentAcademyId();
            const response = await fetch('/api/lms/admin/tax-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ academyId, settings: newSettings }),
            });

            if (!response.ok) {
                return err(await parseErrorResponse(response, `Failed to save tax settings with HTTP ${response.status}`));
            }

            return ok(undefined);
        } catch (error) {
            return err(error instanceof Error ? error : new Error(String(error)));
        }
    },

    // 소득세 예상
    estimateIncomeTax: async (year: string): Promise<Result<IncomeTaxEstimate>> => {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const { data: incomeData, error: incomeError } = await supabase
            .from('student_payments')
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate)
            .in('status', LEGACY_COMPLETED_STUDENT_PAYMENT_STATUSES);

        if (incomeError) return err(new Error(incomeError.message));

        const grossIncome = (incomeData || []).reduce((sum, p) => sum + (p.amount || 0), 0);

        const { data: expenseData, error: expenseError } = await supabase
            .from('expenses')
            .select('amount')
            .gte('expense_date', startDate)
            .lte('expense_date', endDate);

        if (expenseError) return err(new Error(expenseError.message));

        // All expenses are considered tax deductible since the column doesn't exist
        const deductibleExpenses = (expenseData || [])
            .reduce((sum, e) => sum + (e.amount || 0), 0);

        const { data: payrollData, error: payrollError } = await supabase
            .from('instructor_payments')
            .select('amount, gross_amount, net_amount, withholding_tax, local_tax')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (payrollError) return err(new Error(payrollError.message));

        const instructorCosts = (payrollData || []).reduce((sum, p) => sum + getPayrollGrossAmount(p), 0);

        const taxableIncome = grossIncome - deductibleExpenses - instructorCosts;

        let calculatedTax = 0;
        if (taxableIncome > 0) {
            if (taxableIncome <= 14000000) calculatedTax = taxableIncome * 0.06;
            else if (taxableIncome <= 50000000) calculatedTax = 840000 + (taxableIncome - 14000000) * 0.15;
            else if (taxableIncome <= 88000000) calculatedTax = 6240000 + (taxableIncome - 50000000) * 0.24;
            else calculatedTax = 15360000 + (taxableIncome - 88000000) * 0.35;
        }

        const localTax = Math.round(calculatedTax * 0.1);
        const totalTax = Math.round(calculatedTax + localTax);
        const withholdingPaid = (payrollData || []).reduce(
            (sum, p) => sum + Number(p.withholding_tax || 0) + Number(p.local_tax || 0),
            0,
        );

        return ok({
            grossIncome,
            deductibleExpenses: deductibleExpenses + instructorCosts,
            taxableIncome: Math.max(0, taxableIncome),
            calculatedTax: Math.round(calculatedTax),
            localTax,
            totalTax,
            withholdingPaid,
            additionalTax: Math.max(0, totalTax - withholdingPaid),
            refundAmount: Math.max(0, withholdingPaid - totalTax),
            effectiveRate: grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0,
        });
    },

    // 원천징수 요약
    getWithholdingSummary: async (year: string): Promise<Result<WithholdingSummary>> => {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const { data, error } = await supabase
            .from('instructor_payments')
            .select('payment_date, amount, gross_amount, net_amount, withholding_tax, local_tax')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (error) return err(new Error(error.message));

        const byMonth: Array<{ month: string; incomeTax: number; localTax: number; total: number }> = [];
        const monthMap = new Map<string, { incomeTax: number; localTax: number }>();

        (data || []).forEach(p => {
            const month = p.payment_date?.substring(0, 7) || '';
            const savedIncomeTax = Number(p.withholding_tax || 0);
            const savedLocalTax = Number(p.local_tax || 0);
            const fallbackIncomeTax = Math.round(getPayrollGrossAmount(p) * 0.03);
            const fallbackLocalTax = Math.round(fallbackIncomeTax * 0.1);
            const current = monthMap.get(month) || { incomeTax: 0, localTax: 0 };
            monthMap.set(month, {
                incomeTax: current.incomeTax + (savedIncomeTax > 0 ? savedIncomeTax : fallbackIncomeTax),
                localTax: current.localTax + (savedLocalTax > 0 ? savedLocalTax : fallbackLocalTax),
            });
        });

        Array.from(monthMap.entries()).sort().forEach(([month, values]) => {
            byMonth.push({
                month,
                incomeTax: values.incomeTax,
                localTax: values.localTax,
                total: values.incomeTax + values.localTax,
            });
        });

        const total = byMonth.reduce((sum, m) => sum + m.total, 0);

        return ok({ byMonth, total });
    },

    // 부가세 요약
    getVatSummary: async (year: string): Promise<Result<VatSummary>> => {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const { data, error } = await supabase
            .from('student_payments')
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate)
            .in('status', LEGACY_COMPLETED_STUDENT_PAYMENT_STATUSES);

        if (error) return err(new Error(error.message));

        const totalRevenue = (data || []).reduce((sum, p) => sum + (p.amount || 0), 0);

        return ok({
            taxType: '면세',
            vatRate: 0,
            totalRevenue,
            taxableRevenue: 0,
            exemptRevenue: totalRevenue,
            estimatedVat: 0,
        });
    },

    // 손익계산서
    incomeStatement: async (startDate: string, endDate: string): Promise<Result<IncomeStatement>> => {
        const { data: tuitionData, error: tuitionError } = await supabase
            .from('student_payments')
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate)
            .in('status', LEGACY_COMPLETED_STUDENT_PAYMENT_STATUSES);

        if (tuitionError) return err(new Error(tuitionError.message));

        const tuitionIncome = (tuitionData || []).reduce((sum, p) => sum + (p.amount || 0), 0);

        const { data: expenseData, error: expenseError } = await supabase
            .from('expenses')
            .select('amount, category')
            .gte('expense_date', startDate)
            .lte('expense_date', endDate);

        if (expenseError) return err(new Error(expenseError.message));

        const expensesByCategory: Array<{ category: string; amount: number }> = [];
        const categoryMap = new Map<string, number>();
        let totalExpenses = 0;

        (expenseData || []).forEach(e => {
            const cat = e.category || 'other';
            const amt = e.amount || 0;
            categoryMap.set(cat, (categoryMap.get(cat) || 0) + amt);
            totalExpenses += amt;
        });

        categoryMap.forEach((amount, category) => {
            expensesByCategory.push({ category, amount });
        });

        const { data: payrollData, error: payrollError } = await supabase
            .from('instructor_payments')
            .select('amount, gross_amount, net_amount, withholding_tax, local_tax')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (payrollError) return err(new Error(payrollError.message));

        const instructorSalary = (payrollData || []).reduce((sum, p) => sum + getPayrollGrossAmount(p), 0);

        return ok({
            tuitionIncome,
            otherIncome: 0,
            otherIncomeByCategory: [],
            totalIncome: tuitionIncome,
            instructorSalary,
            otherExpenses: totalExpenses,
            expensesByCategory,
            totalExpenses: totalExpenses + instructorSalary,
            netIncome: tuitionIncome - totalExpenses - instructorSalary,
            taxDeductibleExpenses: totalExpenses + instructorSalary, // All expenses considered deductible
            withReceiptExpenses: 0, // Column doesn't exist in DB
        });
    },

    exportTaxReport: async (options: TaxReportExportOptions): Promise<string> => {
        return downloadAdminCsv('tax', options, 'nextum-lms-tax-report.csv');
    },

    exportPayrollReport: async (options: ExportDateRange): Promise<string> => {
        return downloadAdminCsv('payroll', options, 'nextum-lms-payroll.csv');
    },
};

// Reset accounting data
export async function resetAccounting(): Promise<Result<void>> {
    return resetAccountingViaAdmin();
}
