export type AccountingSection = 'payments' | 'payroll' | 'expenses' | 'reports';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const accountingSectionPath: Record<AccountingSection, string> = {
  payments: '/accounting/payments',
  payroll: '/accounting/payroll',
  expenses: '/accounting/expenses',
  reports: '/accounting/reports',
};

export function currentAccountingMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : now.toISOString().slice(0, 7);
}

export function normalizeAccountingMonth(value: unknown, now: Date = new Date()): string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
    ? value
    : currentAccountingMonth(now);
}

export function accountingHref(section: AccountingSection, month: string): string {
  return `${accountingSectionPath[section]}?month=${encodeURIComponent(normalizeAccountingMonth(month))}`;
}

export function accountingMonthRange(month: string): { startDate: string; endDate: string } {
  const normalized = normalizeAccountingMonth(month);
  const [year, monthNumber] = normalized.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: `${normalized}-01`,
    endDate: `${normalized}-${String(lastDay).padStart(2, '0')}`,
  };
}
