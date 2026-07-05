'use client';

import { AccountingOperationsPage } from '@/features/lms/pages';
import { RouteScroll } from './RouteScroll';

export function AccountingRoute() {
    return (
        <RouteScroll>
            <AccountingOperationsPage />
        </RouteScroll>
    );
}
