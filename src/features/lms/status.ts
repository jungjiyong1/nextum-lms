import type { PaymentStatus, PayrollStatus } from './types';

export type InvoiceStatus = 'draft' | 'issued' | 'partial' | 'paid' | 'overdue' | 'void' | 'not_issued';

export const COMPLETED_PAYMENT_STATUS: PaymentStatus = 'completed';
export const PAID_PAYROLL_STATUS: PayrollStatus = 'paid';
export const PAID_INVOICE_STATUS: InvoiceStatus = 'paid';
export const LEGACY_COMPLETED_STUDENT_PAYMENT_STATUSES = ['paid', 'completed'] as const;

export function isCompletedPaymentStatus(status: string | null | undefined): boolean {
  return status === COMPLETED_PAYMENT_STATUS;
}

export function isPaidPayrollStatus(status: string | null | undefined): boolean {
  return status === PAID_PAYROLL_STATUS;
}

export function isPaidInvoiceStatus(status: string | null | undefined): boolean {
  return status === PAID_INVOICE_STATUS;
}

export function isLegacyCompletedStudentPaymentStatus(status: string | null | undefined): boolean {
  return status === 'paid' || status === COMPLETED_PAYMENT_STATUS;
}

export function normalizePaymentStatus(value: PaymentStatus | undefined): PaymentStatus {
  if (value === 'pending' || value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'refunded') {
    return value;
  }
  return COMPLETED_PAYMENT_STATUS;
}

export function normalizePayrollStatus(value: PayrollStatus | undefined): PayrollStatus {
  if (value === 'pending' || value === 'paid' || value === 'cancelled') return value;
  return PAID_PAYROLL_STATUS;
}
