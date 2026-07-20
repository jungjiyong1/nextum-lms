import { WorksheetCartPage } from '@/features/lms/worksheet-cart-page';

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ studentId?: string }>;
}) {
    const params = await searchParams;
    return <WorksheetCartPage studentId={params.studentId ?? ''} />;
}
