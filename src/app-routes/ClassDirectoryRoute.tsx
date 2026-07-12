'use client';

import { ClassDirectoryPageView } from '@/features/lms/classrooms/class-directory-page';
import { RouteScroll } from './RouteScroll';

export function ClassDirectoryRoute() {
    return (
        <RouteScroll>
            <ClassDirectoryPageView />
        </RouteScroll>
    );
}
