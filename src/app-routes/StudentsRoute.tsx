'use client';

import { StudentList } from '@/components/people/StudentList';
import { RouteScroll } from './RouteScroll';

export function StudentsRoute() {
    return (
        <RouteScroll>
            <StudentList />
        </RouteScroll>
    );
}
