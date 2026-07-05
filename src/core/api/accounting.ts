// Accounting APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { ExpenseData, StudentPaymentData, Result } from './shared/types';
import { ok, err } from './shared/result';
import { calculateInstructorMonthlySalary } from './instructors';

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

interface TaxSettings {
    withholdingType: string;
    withholdingRate: number;
    localTaxRate: number;
    businessNumber: string;
    taxReportEmail: string;
}

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
    payroll_date: string;
    instructor_name: string;
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

type CsvValue = string | number | boolean | null | undefined;

function csvEscape(value: CsvValue): string {
    const text = value === null || value === undefined ? '' : String(value);
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

function downloadCsv(filename: string, content: string): string {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        throw new Error('CSV export is only available in the browser.');
    }

    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
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

function fileDateRange({ startDate, endDate }: ExportDateRange): string {
    return `${startDate}_${endDate}`.replace(/[^0-9_-]/g, '');
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
            .eq('status', 'completed');

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
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (instructorPaymentsError) return err(new Error(instructorPaymentsError.message));

        const instructorCosts = (instructorPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
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
            .in('status', ['scheduled', 'completed', 'substitute']);

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

        const paymentMap = new Map((payments || []).map(p => [p.student_id, p]));

        // 선택한 월 이후에 등록된 학생은 제외
        const filteredStudents = (students || []).filter(s => {
            if (!s.enrollment_date) return true; // 등록일이 없으면 표시
            // 등록일이 선택한 월의 마지막 날보다 이후면 제외
            return s.enrollment_date <= endDate;
        });

        return ok(filteredStudents.map(s => {
            const payment = paymentMap.get(s.id);
            const studentName = s.name || '이름없음';
            return {
                student_id: s.id,
                student_name: studentName,
                monthly_tuition: s.monthly_tuition || 0,
                payment_cycle_day: s.payment_cycle_day || 1,
                is_paid: payment?.status === 'completed',
                paid_amount: payment?.amount || 0,
                payment_date: payment?.payment_date || null,
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
        instructor_id: number;
        year_month: string;
        payment_date: string;
        gross_amount: number;
        withholding_type?: string;
        withholding_rate?: number;
        withholding_tax?: number;
        local_tax?: number;
        net_amount: number;
        hours_worked?: number;
        hourly_rate?: number;
        payment_method?: string;
        notes?: string;
    }): Promise<Result<unknown>> => {
        const { data: created, error } = await supabase
            .from('instructor_payments')
            .insert({
                instructor_id: data.instructor_id,
                payment_date: data.payment_date,
                amount: data.net_amount,
                work_hours: data.hours_worked || null,
                period_start: `${data.year_month}-01`,
                period_end: `${data.year_month}-${new Date(parseInt(data.year_month.split('-')[0]), parseInt(data.year_month.split('-')[1]), 0).getDate()}`,
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
        payment_date,
        amount,
        work_hours,
        period_start,
        period_end,
        status,
        notes,
        instructors!inner(name)
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
            return {
                id: p.id,
                payroll_date: p.payment_date,
                instructor_name: instructor?.name || '이름없음',
                total_amount: p.amount,
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
                withholdingType: 'fixed',
                withholdingRate: 3.3,
                localTaxRate: 10,
                businessNumber: '',
                taxReportEmail: '',
            });
        }

        const settings = (data || []).reduce((acc: Record<string, string>, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});

        return ok({
            withholdingType: settings['tax_withholding_type'] || 'fixed',
            withholdingRate: parseFloat(settings['tax_withholding_rate']) || 3.3,
            localTaxRate: parseFloat(settings['tax_local_rate']) || 10,
            businessNumber: settings['tax_business_number'] || '',
            taxReportEmail: settings['tax_report_email'] || '',
        });
    },

    // 세금 설정 저장
    updateTaxSettings: async (newSettings: Record<string, string>): Promise<Result<void>> => {
        const entries = Object.entries(newSettings).map(([key, value]) => ({
            key: `tax_${key}`,
            value: String(value),
        }));

        for (const entry of entries) {
            const { error } = await supabase
                .from('settings')
                .upsert({ key: entry.key, value: entry.value }, { onConflict: 'key' });
            if (error) console.error('Failed to save setting:', entry.key, error);
        }

        return ok(undefined);
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
            .eq('status', 'paid');

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
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (payrollError) return err(new Error(payrollError.message));

        const instructorCosts = (payrollData || []).reduce((sum, p) => sum + (p.amount || 0), 0);

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
        const withholdingPaid = Math.round(instructorCosts * 0.033);

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
            effectiveRate: grossIncome > 0 ? (totalTax / grossIncome) : 0,
        });
    },

    // 원천징수 요약
    getWithholdingSummary: async (year: string): Promise<Result<WithholdingSummary>> => {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        const { data, error } = await supabase
            .from('instructor_payments')
            .select('payment_date, amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (error) return err(new Error(error.message));

        const byMonth: Array<{ month: string; incomeTax: number; localTax: number; total: number }> = [];
        const monthMap = new Map<string, number>();

        (data || []).forEach(p => {
            const month = p.payment_date?.substring(0, 7) || '';
            monthMap.set(month, (monthMap.get(month) || 0) + (p.amount || 0));
        });

        Array.from(monthMap.entries()).sort().forEach(([month, amount]) => {
            const incomeTax = Math.round(amount * 0.03);
            const localTax = Math.round(incomeTax * 0.1);
            byMonth.push({
                month,
                incomeTax,
                localTax,
                total: incomeTax + localTax,
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
            .eq('status', 'paid');

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
            .eq('status', 'paid');

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
            .select('amount')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate);

        if (payrollError) return err(new Error(payrollError.message));

        const instructorSalary = (payrollData || []).reduce((sum, p) => sum + (p.amount || 0), 0);

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
        const sections: string[] = [];

        if (options.includeRevenue) {
            const { data, error } = await supabase
                .from('student_payments')
                .select('payment_date, amount, payment_method, status, notes, students(name)')
                .gte('payment_date', options.startDate)
                .lte('payment_date', options.endDate)
                .order('payment_date', { ascending: true });

            if (error) throw new Error(error.message);

            sections.push(csvSection('Revenue', ['Date', 'Student', 'Amount', 'Method', 'Status', 'Notes'], (data || []).map((row) => {
                const student = Array.isArray(row.students) ? row.students[0] : row.students;
                return [row.payment_date, student?.name, row.amount, row.payment_method, row.status, row.notes];
            })));
        }

        if (options.includePayroll) {
            const { data, error } = await supabase
                .from('instructor_payments')
                .select('payment_date, amount, work_hours, status, notes, instructors(name)')
                .gte('payment_date', options.startDate)
                .lte('payment_date', options.endDate)
                .order('payment_date', { ascending: true });

            if (error) throw new Error(error.message);

            sections.push(csvSection('Payroll', ['Date', 'Instructor', 'Amount', 'Hours', 'Status', 'Notes'], (data || []).map((row) => {
                const instructor = Array.isArray(row.instructors) ? row.instructors[0] : row.instructors;
                return [row.payment_date, instructor?.name, row.amount, row.work_hours, row.status, row.notes];
            })));
        }

        if (options.includeExpenses) {
            const { data, error } = await supabase
                .from('expenses')
                .select('expense_date, category, amount, payment_method, recipient, description, notes')
                .gte('expense_date', options.startDate)
                .lte('expense_date', options.endDate)
                .order('expense_date', { ascending: true });

            if (error) throw new Error(error.message);

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
            const result = await accountingApi.incomeStatement(options.startDate, options.endDate);
            if (!result.success) throw result.error;

            sections.push(csvSection('Profit And Loss', ['Metric', 'Amount'], [
                ['Tuition income', result.data.tuitionIncome],
                ['Other income', result.data.otherIncome],
                ['Total income', result.data.totalIncome],
                ['Instructor salary', result.data.instructorSalary],
                ['Other expenses', result.data.otherExpenses],
                ['Total expenses', result.data.totalExpenses],
                ['Net income', result.data.netIncome],
            ]));
        }

        return downloadCsv(`nextum-lms-tax-report-${fileDateRange(options)}.csv`, sections.join('\r\n\r\n'));
    },

    exportPayrollReport: async (options: ExportDateRange): Promise<string> => {
        const { data, error } = await supabase
            .from('instructor_payments')
            .select('payment_date, amount, work_hours, period_start, period_end, status, notes, instructors(name)')
            .gte('payment_date', options.startDate)
            .lte('payment_date', options.endDate)
            .order('payment_date', { ascending: true });

        if (error) throw new Error(error.message);

        const csv = csvSection('Payroll', ['Date', 'Instructor', 'Amount', 'Hours', 'Period Start', 'Period End', 'Status', 'Notes'], (data || []).map((row) => {
            const instructor = Array.isArray(row.instructors) ? row.instructors[0] : row.instructors;
            return [
                row.payment_date,
                instructor?.name,
                row.amount,
                row.work_hours,
                row.period_start,
                row.period_end,
                row.status,
                row.notes,
            ];
        }));

        return downloadCsv(`nextum-lms-payroll-${fileDateRange(options)}.csv`, csv);
    },
};

// Reset accounting data
export async function resetAccounting(): Promise<Result<void>> {
    const { error: paymentsError } = await supabase.from('student_payments').delete().neq('id', 0);
    if (paymentsError) return err(new Error(paymentsError.message));

    const { error: instructorPaymentsError } = await supabase.from('instructor_payments').delete().neq('id', 0);
    if (instructorPaymentsError) return err(new Error(instructorPaymentsError.message));

    const { error: expensesError } = await supabase.from('expenses').delete().neq('id', 0);
    if (expensesError) return err(new Error(expensesError.message));

    return ok(undefined);
}
