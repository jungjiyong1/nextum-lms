import { StudentsRoute } from '@/app-routes/StudentsRoute';

export default async function StudentDetailPage({
    params,
}: {
    params: Promise<{ studentId: string }>;
}) {
    const { studentId } = await params;
    return <StudentsRoute initialStudentId={studentId} />;
}
