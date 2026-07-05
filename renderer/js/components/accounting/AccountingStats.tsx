import React, { useState, useEffect, useCallback } from 'react';
import { useAccountingStore } from '../../stores/accountingStore';
import { formatCurrency } from '../../modules/accounting/utils/formatters';
import { onDataChange } from '../../core/events';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '../../lib/utils';

interface DashboardStats {
    monthlyRevenue: number;
    monthlyExpenses: number;
    netIncome: number;
    expectedRevenue: number;
    expectedExpenses: number;
}

interface StudentStatus {
    monthly_tuition: number;
    is_paid: boolean;
}

interface InstructorEstimate {
    paid: boolean;
}

export function AccountingStats() {
    const yearMonth = useAccountingStore((state) => state.yearMonth);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [studentStatus, setStudentStatus] = useState<StudentStatus[]>([]);
    const [instructorEstimates, setInstructorEstimates] = useState<InstructorEstimate[]>([]);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const api = window.api;
            const [statsResult, studentsResult, instructorsResult] = await Promise.all([
                api.accounting.dashboard(yearMonth),
                api.accounting.studentMonthlyStatus(yearMonth),
                api.accounting.instructorEstimates(yearMonth)
            ]);

            if (statsResult.success) {
                setStats(statsResult.data);
            }
            if (studentsResult.success) {
                setStudentStatus(studentsResult.data);
            }
            if (instructorsResult.success) {
                setInstructorEstimates(instructorsResult.data);
            }
        } finally {
            setLoading(false);
        }
    }, [yearMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const unsubscribe = onDataChange(({ scope }) => {
            if (['accounting', 'students', 'instructors', 'general'].includes(scope)) {
                loadData();
            }
        });
        return unsubscribe;
    }, [loadData]);

    // Derived Stats
    const studentsWithTuition = studentStatus.filter(s => s.monthly_tuition > 0);
    const paidStudents = studentsWithTuition.filter(s => s.is_paid).length;
    const totalStudents = studentsWithTuition.length;
    const unpaidStudents = totalStudents - paidStudents;

    const paidInstructors = instructorEstimates.filter(i => i.paid).length;
    const totalInstructors = instructorEstimates.length;

    if (loading) {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                    label="이번 달 수입"
                    value={formatCurrency(stats?.monthlyRevenue || 0)}
                    sub={`예상: ${formatCurrency(stats?.expectedRevenue || 0)}`}
                    valueColor="text-blue-600"
                />
                <StatCard
                    label="이번 달 지출"
                    value={formatCurrency(stats?.monthlyExpenses || 0)}
                    sub={`예상: ${formatCurrency(stats?.expectedExpenses || 0)}`}
                    valueColor="text-red-600"
                />
                <StatCard
                    label="순이익"
                    value={formatCurrency(stats?.netIncome || 0)}
                    valueColor={(stats?.netIncome || 0) >= 0 ? 'text-blue-600' : 'text-red-600'}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">학생 납부</div>
                            <div className="text-2xl font-bold mt-1">{paidStudents} / {totalStudents}명</div>
                        </div>
                        <div className={cn(
                            "px-3 py-1 rounded-full text-xs font-semibold",
                            unpaidStudents > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        )}>
                            {unpaidStudents > 0 ? `미납 ${unpaidStudents}명` : "전원 완납"}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">강사 급여</div>
                            <div className="text-2xl font-bold mt-1">{paidInstructors} / {totalInstructors}명</div>
                        </div>
                        <div className={cn(
                            "px-3 py-1 rounded-full text-xs font-semibold",
                            totalInstructors - paidInstructors > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
                        )}>
                            {totalInstructors - paidInstructors > 0 ? `미지급 ${totalInstructors - paidInstructors}명` : "전원 지급"}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function StatCard({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="text-sm font-medium text-muted-foreground">{label}</div>
                <div className={cn("text-2xl font-bold mt-1", valueColor)}>{value}</div>
                {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            </CardContent>
        </Card>
    );
}
