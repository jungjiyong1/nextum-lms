import { AssignmentCreatePage, AssignmentsStatusPage } from '@/features/lms/assignments-operations-page';
import { RouteScroll } from './RouteScroll';

export function AssignmentsRoute({ initialAssignmentId }: { initialAssignmentId?: string }) {
    return (
        <RouteScroll>
            <AssignmentsStatusPage initialAssignmentId={initialAssignmentId} />
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
