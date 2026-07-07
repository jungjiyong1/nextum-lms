import { AssignmentCreatePage, AssignmentsStatusPage } from '@/features/lms/assignments-operations-page';
import { RouteScroll } from './RouteScroll';

export function AssignmentsRoute() {
    return (
        <RouteScroll>
            <AssignmentsStatusPage />
        </RouteScroll>
    );
}

export function AssignmentCreateRoute() {
    return (
        <RouteScroll>
            <AssignmentCreatePage />
        </RouteScroll>
    );
}
