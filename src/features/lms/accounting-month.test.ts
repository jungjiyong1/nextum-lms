import { describe, expect, it } from 'vitest';

import {
  accountingHref,
  accountingMonthRange,
  currentAccountingMonth,
  normalizeAccountingMonth,
} from './accounting-month';

describe('accounting month navigation', () => {
  const now = new Date('2026-06-30T15:30:00.000Z');

  it('uses the Seoul calendar month when the UTC month differs', () => {
    expect(currentAccountingMonth(now)).toBe('2026-07');
  });

  it('preserves valid months and corrects malformed or impossible months', () => {
    expect(normalizeAccountingMonth('2025-12', now)).toBe('2025-12');
    expect(normalizeAccountingMonth('2025-13', now)).toBe('2026-07');
    expect(normalizeAccountingMonth('2025-1', now)).toBe('2026-07');
    expect(normalizeAccountingMonth(undefined, now)).toBe('2026-07');
  });

  it('keeps the selected month in every accounting section href', () => {
    expect(accountingHref('payments', '2025-02')).toBe('/accounting/payments?month=2025-02');
    expect(accountingHref('payroll', '2025-02')).toBe('/accounting/payroll?month=2025-02');
    expect(accountingHref('expenses', '2025-02')).toBe('/accounting/expenses?month=2025-02');
    expect(accountingHref('reports', '2025-02')).toBe('/accounting/reports?month=2025-02');
  });

  it('builds an exact date range for leap and non-leap months', () => {
    expect(accountingMonthRange('2024-02')).toEqual({ startDate: '2024-02-01', endDate: '2024-02-29' });
    expect(accountingMonthRange('2025-02')).toEqual({ startDate: '2025-02-01', endDate: '2025-02-28' });
  });
});
