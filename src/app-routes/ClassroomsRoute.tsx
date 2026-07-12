'use client';

import { ClassroomsOperationsPage } from '@/features/lms/classrooms-operations-page';
import { RouteScroll } from './RouteScroll';

export function ClassroomScheduleRoute({ classId }: { classId: string }) {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="schedule" initialClassId={classId} />
        </RouteScroll>
    );
}

export function ClassroomStudentsRoute({ classId }: { classId: string }) {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="overview" initialClassId={classId} detailSection="students" />
        </RouteScroll>
    );
}

export function ClassroomMaterialsRoute({ classId }: { classId: string }) {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="overview" initialClassId={classId} detailSection="materials" />
        </RouteScroll>
    );
}

export function ClassroomSettingsRoute({ classId }: { classId: string }) {
    return (
        <RouteScroll>
            <ClassroomsOperationsPage view="overview" initialClassId={classId} detailSection="settings" />
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
