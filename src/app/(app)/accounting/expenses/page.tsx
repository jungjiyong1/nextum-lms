import { AccountingExpensesRoute } from '@/app-routes/AccountingRoute';
import { redirect } from 'next/navigation';
import { accountingHref, normalizeAccountingMonth } from '@/features/lms/accounting-month';

export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const params = await searchParams;
  const requestedMonth = typeof params.month === 'string' ? params.month : null;
  const month = normalizeAccountingMonth(requestedMonth);
  if (requestedMonth !== month) redirect(accountingHref('expenses', month));
  return <AccountingExpensesRoute initialMonth={month} />;
}
