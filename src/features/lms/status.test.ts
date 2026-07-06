import { describe, expect, it } from 'vitest';
import {
  COMPLETED_PAYMENT_STATUS,
  PAID_INVOICE_STATUS,
  PAID_PAYROLL_STATUS,
  isCompletedPaymentStatus,
  isLegacyCompletedStudentPaymentStatus,
  isPaidInvoiceStatus,
  isPaidPayrollStatus,
  normalizePaymentStatus,
  normalizePayrollStatus,
} from './status';

describe('LMS status helpers', () => {
  it('keeps payment, invoice, and payroll completion states distinct', () => {
    expect(COMPLETED_PAYMENT_STATUS).toBe('completed');
    expect(PAID_INVOICE_STATUS).toBe('paid');
    expect(PAID_PAYROLL_STATUS).toBe('paid');

    expect(isCompletedPaymentStatus('completed')).toBe(true);
    expect(isCompletedPaymentStatus('paid')).toBe(false);
    expect(isPaidInvoiceStatus('paid')).toBe(true);
    expect(isPaidInvoiceStatus('completed')).toBe(false);
    expect(isPaidPayrollStatus('paid')).toBe(true);
  });

  it('accepts legacy student payment completion states for the old accounting API', () => {
    expect(isLegacyCompletedStudentPaymentStatus('paid')).toBe(true);
    expect(isLegacyCompletedStudentPaymentStatus('completed')).toBe(true);
    expect(isLegacyCompletedStudentPaymentStatus('pending')).toBe(false);
  });

  it('normalizes invalid statuses to write-safe defaults', () => {
    expect(normalizePaymentStatus(undefined)).toBe('completed');
    expect(normalizePaymentStatus('pending')).toBe('pending');
    expect(normalizePayrollStatus(undefined)).toBe('paid');
    expect(normalizePayrollStatus('cancelled')).toBe('cancelled');
  });
});
