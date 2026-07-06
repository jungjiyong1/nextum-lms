import { AssignmentsOperationsPage } from '@/features/lms/assignments-operations-page';
import { RouteScroll } from './RouteScroll';

export function AssignmentsRoute() {
    return (
        <RouteScroll>
            <AssignmentsOperationsPage />
        </RouteScroll>
    );
}
