import { ClassroomMaterialsRoute } from '@/app-routes/ClassroomsRoute';
import { ClassDetailNavigation } from '@/features/lms/classrooms/class-detail-navigation';

export default async function Page({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  return <ClassDetailNavigation classId={classId}><ClassroomMaterialsRoute classId={classId} /></ClassDetailNavigation>;
}
