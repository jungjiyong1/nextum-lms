import { redirect } from 'next/navigation';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string | string[]; planId?: string | string[] }>;
}) {
  const params = await searchParams;
  const classId = typeof params.classId === 'string' && params.classId ? params.classId : null;
  const planId = typeof params.planId === 'string' && params.planId ? params.planId : null;
  if (!classId) redirect('/classrooms');
  const suffix = planId ? `?planId=${encodeURIComponent(planId)}` : '';
  redirect(`/classrooms/${encodeURIComponent(classId)}/learning${suffix}`);
}
