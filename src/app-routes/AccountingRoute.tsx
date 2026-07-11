'use client';

import { AccountingOperationsPage, AccountingReportsPage } from '@/features/lms/pages';
import { RouteScroll } from './RouteScroll';

export function AccountingPaymentsRoute({ initialMonth }: { initialMonth: string }) {
    return (
        <RouteScroll>
            <AccountingOperationsPage view="payments" initialMonth={initialMonth} />
        </RouteScroll>
    );
}

export function AccountingPayrollRoute({ initialMonth }: { initialMonth: string }) {
    return (
        <RouteScroll>
            <AccountingOperationsPage view="payroll" initialMonth={initialMonth} />
        </RouteScroll>
    );
}

export function AccountingExpensesRoute({ initialMonth }: { initialMonth: string }) {
    return (
        <RouteScroll>
            <AccountingOperationsPage view="expenses" initialMonth={initialMonth} />
        </RouteScroll>
    );
}

export function AccountingReportsRoute({ initialMonth }: { initialMonth: string }) {
    return (
        <RouteScroll>
            <AccountingReportsPage initialMonth={initialMonth} />
        </RouteScroll>
    );
}
