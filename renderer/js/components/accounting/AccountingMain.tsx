import React, { useEffect, useCallback } from 'react';
import { useAccountingStore } from '../../stores/accountingStore';
import { AccountingStats } from './AccountingStats';
import { StudentPayment } from './StudentPayment';
import { ExpenseTracker } from './ExpenseTracker';
import { PayrollManager } from './PayrollManager';
import { TaxCalculator } from './TaxCalculator';
import { TaxReportExport } from './TaxReportExport';
import { Input } from '@/components/ui/input';
import { cn } from '../../lib/utils';
import { emitDataChange } from '../../core/events';
import type { Expense } from '../../core/types';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';

export function AccountingMain() {
    const yearMonth = useAccountingStore((state) => state.yearMonth);
    const activeTab = useAccountingStore((state) => state.activeTab);
    const setYearMonth = useAccountingStore((state) => state.setYearMonth);
    const setActiveTab = useAccountingStore((state) => state.setActiveTab);

    return (
        <div className="flex h-full flex-col bg-background">
            <div className="flex items-center justify-between border-b p-6">
                <h2 className="text-2xl font-bold tracking-tight">회계 관리</h2>
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">조회 월:</label>
                    <Input
                        type="month"
                        value={yearMonth}
                        onChange={(e) => setYearMonth(e.target.value)}
                        className="w-auto"
                    />
                </div>
            </div>

            <div className="p-6 pb-2">
                <AccountingStats />
            </div>

            <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)} className="flex-1 flex flex-col px-6" layoutId="accounting-main-tabs">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="students">학생 수납</TabsTrigger>
                    {/* <TabsTrigger value="expenses">지출 장부</TabsTrigger> */}
                    <TabsTrigger value="payroll">급여 관리</TabsTrigger>
                    {/* <TabsTrigger value="tax">세금/손익</TabsTrigger> */}
                    {/* <TabsTrigger value="export">자료 내보내기</TabsTrigger> */}
                </TabsList>

                <div className="flex-1 overflow-auto rounded-lg border bg-card text-card-foreground shadow-sm p-6">
                    <TabsContent value="students" className="h-full m-0 data-[state=active]:flex flex-col">
                        <StudentPayment />
                    </TabsContent>
                    {/* <TabsContent value="expenses" className="h-full m-0 data-[state=active]:flex flex-col">
                        <ExpenseTrackerWrapper yearMonth={yearMonth} />
                    </TabsContent> */}
                    <TabsContent value="payroll" className="h-full m-0 data-[state=active]:flex flex-col">
                        <PayrollManager />
                    </TabsContent>
                    {/* <TabsContent value="tax" className="h-full m-0 data-[state=active]:flex flex-col">
                        <TaxCalculator />
                    </TabsContent> */}
                    {/* <TabsContent value="export" className="h-full m-0 data-[state=active]:flex flex-col">
                        <TaxReportExport />
                    </TabsContent> */}
                </div>
            </Tabs>
        </div>
    );
}

// Wrapper to handle data fetching for the prop-based ExpenseTracker
function ExpenseTrackerWrapper({ yearMonth }: { yearMonth: string }) {
    const [expenses, setExpenses] = React.useState<Expense[]>([]);

    const loadExpenses = useCallback(async () => {
        const [year, month] = yearMonth.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        const startDate = `${yearMonth}-01`;
        const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

        const result = await window.api.accounting.getExpenses(startDate, endDate);
        if ((result as any).success) {
            setExpenses((result as any).data);
        } else {
            console.error((result as any).error);
        }
    }, [yearMonth]);

    useEffect(() => {
        loadExpenses();
    }, [loadExpenses]);

    return (
        <ExpenseTracker
            expenses={expenses}
            yearMonth={yearMonth}
            onAddExpense={async (data) => {
                const result = await window.api.accounting.createExpense(data);
                if ((result as any).success) {
                    loadExpenses();
                    emitDataChange('accounting');
                }
            }}
            onDeleteExpense={async (id) => {
                const result = await window.api.accounting.deleteExpense(id);
                if ((result as any).success) {
                    loadExpenses();
                }
            }}
        />
    );
}
