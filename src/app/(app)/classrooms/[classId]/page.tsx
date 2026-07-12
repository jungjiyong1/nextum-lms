import { redirect } from 'next/navigation';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const [{ classId }, query] = await Promise.all([params, searchParams]);
  const suffix = typeof query.returnTo === 'string' && query.returnTo.startsWith('/classrooms')
    ? `?returnTo=${encodeURIComponent(query.returnTo)}`
    : '';
  redirect(`/classrooms/${encodeURIComponent(classId)}/schedule${suffix}`);
}
