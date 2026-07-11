import { describe, expect, it } from 'vitest';
import { buildInstructorPayrollEstimates, calculatePayrollDraft, lessonDurationMinutes } from './payroll';
import type { InstructorPaymentRow, ScheduleItem, StaffSummary } from './types';

const staff: StaffSummary[] = [
  {
    id: 'staff-a',
    personId: 'person-a',
    name: '강사 A',
    phone: null,
    email: null,
    role: 'instructor',
    status: 'active',
    hourlyRate: 30000,
  },
  {
    id: 'staff-b',
    personId: 'person-b',
    name: '강사 B',
    phone: null,
    email: null,
    role: 'teacher',
    status: 'active',
    hourlyRate: 20000,
  },
];

function lesson(overrides: Partial<ScheduleItem>): ScheduleItem {
  return {
    id: 'lesson',
    actualId: null,
    virtual: true,
    classId: 'class-a',
    className: '수학반',
    ruleId: 'rule-a',
    date: '2026-07-01',
    startTime: '10:00',
    endTime: '11:00',
    status: 'normal',
    hasEnded: true,
    classroomName: null,
    instructorId: 'staff-a',
    instructorName: '강사 A',
    cancelReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<InstructorPaymentRow>): InstructorPaymentRow {
  return {
    id: 'payment',
    instructorId: 'staff-a',
    instructorName: '강사 A',
    recipientName: '강사 A',
    serviceMonth: '2026-07',
    paymentDate: '2026-07-31',
    grossAmount: 20000,
    withholdingType: 'freelance_3.3',
    withholdingRate: 3.3,
    withholdingTax: 600,
    localTax: 60,
    netAmount: 19340,
    hoursWorked: 1,
    hourlyRate: 30000,
    paymentMethod: '계좌이체',
    status: 'paid',
    notes: null,
    ...overrides,
  };
}

describe('instructor payroll calculations', () => {
  it('counts completed lessons separately from the full monthly schedule', () => {
    const estimates = buildInstructorPayrollEstimates({
      staff,
      schedule: [
        lesson({ id: 'completed', startTime: '10:00', endTime: '11:30' }),
        lesson({ id: 'future', hasEnded: false, startTime: '12:00', endTime: '13:00' }),
        lesson({ id: 'cancelled', status: 'cancelled', startTime: '14:00', endTime: '16:00' }),
        lesson({ id: 'substitute', instructorId: 'staff-b', instructorName: '강사 B' }),
      ],
      payments: [
        payment({ id: 'paid', grossAmount: 20000 }),
        payment({ id: 'cancelled-payment', grossAmount: 100000, status: 'cancelled' }),
      ],
    });

    expect(estimates[0]).toMatchObject({
      instructorId: 'staff-a',
      completedLessonCount: 1,
      completedMinutes: 90,
      scheduledLessonCount: 2,
      scheduledMinutes: 150,
      estimatedGrossAmount: 45000,
      paidGrossAmount: 20000,
      remainingEstimatedAmount: 25000,
    });
    expect(estimates[1]).toMatchObject({
      instructorId: 'staff-b',
      completedLessonCount: 1,
      completedMinutes: 60,
      estimatedGrossAmount: 20000,
    });
  });

  it('supports lessons that end after midnight', () => {
    expect(lessonDurationMinutes('23:30', '01:00')).toBe(90);
  });

  it('applies additions, deductions, and freelance withholding to the preview', () => {
    expect(calculatePayrollDraft({
      hoursWorked: 10,
      hourlyRate: 20000,
      additionalAmount: 30000,
      deductionAmount: 10000,
      withholdingType: 'freelance_3.3',
    })).toEqual({
      baseAmount: 200000,
      additionalAmount: 30000,
      deductionAmount: 10000,
      grossAmount: 220000,
      withholdingTax: 6600,
      localTax: 660,
      netAmount: 212740,
    });
  });
});
