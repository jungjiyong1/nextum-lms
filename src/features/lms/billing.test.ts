import { describe, expect, it } from 'vitest';
import { calculateInvoiceDraft } from './billing';

describe('calculateInvoiceDraft', () => {
  it('charges a monthly base fee and extra class fee', () => {
    const draft = calculateInvoiceDraft({
      contract: {
        studentId: 'student-1',
        billingMode: 'monthly_plus_classes',
        baseMonthlyFee: 300000,
        hourlyRate: null,
      },
      rules: [
        { classId: 'class-a', className: '중1 A반', ruleType: 'included', amount: 0 },
        { classId: 'class-b', className: '중1 B반', ruleType: 'extra_flat', amount: 80000 },
      ],
      attendances: [],
    });

    expect(draft.subtotalAmount).toBe(380000);
    expect(draft.discountAmount).toBe(0);
    expect(draft.totalAmount).toBe(380000);
    expect(draft.lines.map((line) => line.lineType)).toEqual(['base_fee', 'class_extra']);
  });

  it('subtracts class discounts without making totals negative', () => {
    const draft = calculateInvoiceDraft({
      contract: {
        studentId: 'student-1',
        billingMode: 'monthly_plus_classes',
        baseMonthlyFee: 50000,
        hourlyRate: null,
      },
      rules: [{ classId: 'class-a', className: '할인반', ruleType: 'discount', amount: 80000 }],
      attendances: [],
    });

    expect(draft.subtotalAmount).toBe(50000);
    expect(draft.discountAmount).toBe(80000);
    expect(draft.totalAmount).toBe(0);
  });

  it('charges usage-based contracts from billable attendance minutes', () => {
    const draft = calculateInvoiceDraft({
      contract: {
        studentId: 'student-1',
        billingMode: 'usage_based',
        baseMonthlyFee: 0,
        hourlyRate: 50000,
      },
      rules: [],
      attendances: [
        {
          classId: 'class-a',
          className: '시간제반',
          occurrenceId: 'occ-1',
          status: 'present',
          billableMinutes: 90,
        },
        {
          classId: 'class-a',
          className: '시간제반',
          occurrenceId: 'occ-2',
          status: 'absent',
          billableMinutes: 0,
        },
      ],
    });

    expect(draft.subtotalAmount).toBe(75000);
    expect(draft.totalAmount).toBe(75000);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].quantity).toBe(1.5);
  });

  it('charges usage rules on top of monthly base fees', () => {
    const draft = calculateInvoiceDraft({
      contract: {
        studentId: 'student-1',
        billingMode: 'monthly_plus_classes',
        baseMonthlyFee: 250000,
        hourlyRate: null,
      },
      rules: [{ classId: 'class-b', className: '특강', ruleType: 'usage_based', amount: 40000 }],
      attendances: [
        {
          classId: 'class-b',
          className: '특강',
          occurrenceId: 'occ-1',
          status: 'makeup',
          billableMinutes: 120,
        },
      ],
    });

    expect(draft.subtotalAmount).toBe(330000);
    expect(draft.lines.map((line) => line.lineType)).toEqual(['base_fee', 'usage']);
  });

  it('does not auto-generate lines for manual billing contracts', () => {
    const draft = calculateInvoiceDraft({
      contract: {
        studentId: 'student-1',
        billingMode: 'manual',
        baseMonthlyFee: 100000,
        hourlyRate: 30000,
      },
      rules: [{ classId: 'class-a', className: '수동반', ruleType: 'extra_flat', amount: 50000 }],
      attendances: [
        {
          classId: 'class-a',
          className: '수동반',
          occurrenceId: 'occ-1',
          status: 'present',
          billableMinutes: 60,
        },
      ],
    });

    expect(draft.totalAmount).toBe(0);
    expect(draft.lines).toEqual([]);
  });
});
