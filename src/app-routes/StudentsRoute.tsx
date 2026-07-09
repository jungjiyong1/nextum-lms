'use client';

import { StudentsOperationsPage } from '@/features/lms/students-operations-page';
import { RouteScroll } from './RouteScroll';

export function StudentsRoute({ initialStudentId }: { initialStudentId?: string }) {
    return (
        <RouteScroll>
            <StudentsOperationsPage initialStudentId={initialStudentId} />
        </RouteScroll>
    );
}
