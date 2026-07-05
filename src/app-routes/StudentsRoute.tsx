'use client';

import { StudentsOperationsPage } from '@/features/lms/pages';
import { RouteScroll } from './RouteScroll';

export function StudentsRoute() {
    return (
        <RouteScroll>
            <StudentsOperationsPage />
        </RouteScroll>
    );
}
