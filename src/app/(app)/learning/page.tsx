import { redirect } from 'next/navigation';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string | string[] }>;
}) {
  const params = await searchParams;
  const classId = typeof params.classId === 'string' && params.classId ? params.classId : null;
  redirect(classId ? `/classrooms/${encodeURIComponent(classId)}/learning` : '/classrooms');
}
