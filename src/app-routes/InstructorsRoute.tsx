'use client';

import { InstructorsOperationsPage } from '@/features/lms/instructors-operations-page';
import { RouteScroll } from './RouteScroll';

export function InstructorsRoute({ initialStaffId }: { initialStaffId?: string }) {
    return (
        <RouteScroll>
            <InstructorsOperationsPage initialStaffId={initialStaffId} />
        </RouteScroll>
    );
}
