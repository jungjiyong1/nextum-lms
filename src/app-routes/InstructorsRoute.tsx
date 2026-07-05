'use client';

import { InstructorList } from '@/components/people/InstructorList';
import { RouteScroll } from './RouteScroll';

export function InstructorsRoute() {
    return (
        <RouteScroll>
            <InstructorList />
        </RouteScroll>
    );
}
