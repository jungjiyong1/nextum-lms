import { LearningRoute } from '@/app-routes/LearningRoute';
import { ClassDetailNavigation } from '@/features/lms/classrooms/class-detail-navigation';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ planId?: string | string[] }>;
}) {
  const [{ classId }, query] = await Promise.all([params, searchParams]);
  const planId = typeof query.planId === 'string' && query.planId ? query.planId : null;
  return (
    <ClassDetailNavigation classId={classId}>
      <LearningRoute
        initialClassId={classId}
        initialPlanId={planId}
        initialTab={planId ? 'exam-preparation' : 'class-learning'}
      />
    </ClassDetailNavigation>
  );
}
