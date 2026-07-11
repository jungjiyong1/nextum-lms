import { redirect } from 'next/navigation';
import { accountingHref, normalizeAccountingMonth } from '@/features/lms/accounting-month';

export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ month?: string | string[] }>;
}) {
    const params = await searchParams;
    const month = normalizeAccountingMonth(typeof params.month === 'string' ? params.month : null);
    redirect(accountingHref('payments', month));
}
