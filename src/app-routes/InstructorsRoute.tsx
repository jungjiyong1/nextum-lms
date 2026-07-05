'use client';

import { StaffOperationsPage } from '@/features/lms/pages';
import { RouteScroll } from './RouteScroll';

export function InstructorsRoute() {
    return (
        <RouteScroll>
            <StaffOperationsPage />
        </RouteScroll>
    );
}
