import { InstructorsRoute } from '@/app-routes/InstructorsRoute';

export default async function StaffDetailPage({
    params,
}: {
    params: Promise<{ staffId: string }>;
}) {
    const { staffId } = await params;
    return <InstructorsRoute initialStaffId={staffId} />;
}
