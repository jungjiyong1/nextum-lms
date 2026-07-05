'use client';

import { AccountingMain } from '@/components/accounting/AccountingMain';
import { RouteScroll } from './RouteScroll';

export function AccountingRoute() {
    return (
        <RouteScroll>
            <AccountingMain />
        </RouteScroll>
    );
}
