'use client';

import { InstructorsOperationsPage } from '@/features/lms/instructors-operations-page';
import { RouteScroll } from './RouteScroll';

export function InstructorsRoute() {
    return (
        <RouteScroll>
            <InstructorsOperationsPage />
        </RouteScroll>
    );
}
