import { AssignmentsRoute } from '@/app-routes/AssignmentsRoute';

export default async function AssignmentDetailPage({
    params,
}: {
    params: Promise<{ assignmentId: string }>;
}) {
    const { assignmentId } = await params;
    return <AssignmentsRoute initialAssignmentId={assignmentId} />;
}
