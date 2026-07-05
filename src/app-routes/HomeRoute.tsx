'use client';

import { LearningHomePage } from '@/features/lms/pages';
import { RouteScroll } from './RouteScroll';

export function HomeRoute() {
    return (
        <RouteScroll>
            <LearningHomePage />
        </RouteScroll>
    );
}
