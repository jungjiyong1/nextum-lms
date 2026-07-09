'use client';

import { ClassroomsOperationsPage } from '@/features/lms/classrooms-operations-page';
import { RouteScroll } from './RouteScroll';

export function ClassroomsRoute() {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="overview" />
        </RouteScroll>
    );
}

export function ClassroomsScheduleRoute() {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="schedule" />
        </RouteScroll>
    );
}

export function ClassroomsAttendanceRoute() {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="attendance" />
        </RouteScroll>
    );
}

export function ClassroomsSettingsRoute() {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="settings" />
        </RouteScroll>
    );
}
