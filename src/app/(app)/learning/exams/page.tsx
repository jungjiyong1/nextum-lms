import { LearningRoute } from '@/app-routes/LearningRoute';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ planId?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialPlanId = typeof params.planId === 'string' && params.planId.length > 0
    ? params.planId
    : null;
  return <LearningRoute initialTab="exam-preparation" initialPlanId={initialPlanId} />;
}
