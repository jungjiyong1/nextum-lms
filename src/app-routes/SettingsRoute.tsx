'use client';

import { SettingsOperationsPage } from '@/features/lms/pages';
import { RouteScroll } from './RouteScroll';

export function SettingsRoute() {
    return (
        <RouteScroll>
            <SettingsOperationsPage />
        </RouteScroll>
    );
}
