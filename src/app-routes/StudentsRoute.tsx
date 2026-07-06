'use client';

import { StudentsOperationsPage } from '@/features/lms/students-operations-page';
import { RouteScroll } from './RouteScroll';

export function StudentsRoute() {
    return (
        <RouteScroll>
            <StudentsOperationsPage />
        </RouteScroll>
    );
}
