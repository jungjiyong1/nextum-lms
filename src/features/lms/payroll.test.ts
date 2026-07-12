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

function staffSummaryForPayroll(id: string, name: string, hourlyRate: number): StaffSummary {
  return {
    id,
    personId: `person-${id}`,
    name,
    phone: null,
    email: null,
    role: 'instructor',
    status: 'active',
    hourlyRate,
  };
}

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
    baseAmount: 20000,
    additionalAmount: 0,
    deductionAmount: 0,
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
      estimatedBase: 45000,
      paidGrossAmount: 20000,
      paidBase: 20000,
      remainingEstimatedAmount: 25000,
      remainingBase: 25000,
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

  it('pays every co-teacher for their own participation minutes', () => {
    const estimates = buildInstructorPayrollEstimates({
      staff,
      schedule: [lesson({
        instructors: [
          {
            instructorId: 'staff-a',
            instructorName: '강사 A',
            participationKind: 'regular',
            payableMinutes: 60,
          },
          {
            instructorId: 'staff-b',
            instructorName: '강사 B',
            participationKind: 'assistant',
            payableMinutes: 30,
          },
        ],
      })],
      payments: [],
    });

    expect(estimates.find((row) => row.instructorId === 'staff-a')).toMatchObject({
      completedLessonCount: 1,
      completedMinutes: 60,
      estimatedBase: 30000,
    });
    expect(estimates.find((row) => row.instructorId === 'staff-b')).toMatchObject({
      completedLessonCount: 1,
      completedMinutes: 30,
      estimatedBase: 10000,
    });
  });

  it('treats an occurrence participant snapshot as a full substitute override', () => {
    const replacement = staffSummaryForPayroll('staff-c', '강사 C', 40000);
    const estimates = buildInstructorPayrollEstimates({
      staff: [staff[0], replacement],
      schedule: [lesson({
        instructorId: 'staff-a',
        instructorName: '강사 A',
        substituteInstructorId: 'staff-c',
        instructors: [{
          instructorId: 'staff-c',
          instructorName: '강사 C',
          participationKind: 'substitute',
          payableMinutes: 60,
          replacesInstructorId: 'staff-a',
        }],
      })],
      payments: [],
    });

    expect(estimates.find((row) => row.instructorId === 'staff-c')).toMatchObject({
      completedLessonCount: 1,
      completedMinutes: 60,
      estimatedBase: 40000,
    });
    expect(estimates.find((row) => row.instructorId === 'staff-a')).toMatchObject({
      completedLessonCount: 0,
      completedMinutes: 0,
      estimatedBase: 0,
    });
  });

  it('pays zero minutes for every participant when a joint lesson is cancelled', () => {
    const estimates = buildInstructorPayrollEstimates({
      staff,
      schedule: [lesson({
        status: 'cancelled',
        instructors: [
          { instructorId: 'staff-a', instructorName: '강사 A', participationKind: 'regular', payableMinutes: 60 },
          { instructorId: 'staff-b', instructorName: '강사 B', participationKind: 'assistant', payableMinutes: 60 },
        ],
      })],
      payments: [],
    });

    expect(estimates.every((row) => (
      row.completedMinutes === 0
      && row.scheduledMinutes === 0
      && row.estimatedBase === 0
    ))).toBe(true);
  });

  it('uses the rate effective on each lesson date and exposes a mixed-rate breakdown', () => {
    const [estimate] = buildInstructorPayrollEstimates({
      staff: [staff[0]],
      schedule: [
        lesson({ id: 'before-change', date: '2026-07-05' }),
        lesson({ id: 'after-change', date: '2026-07-20' }),
      ],
      payments: [],
      payRates: [
        { instructorId: 'staff-a', effectiveFrom: '2026-06-01', hourlyRate: 25000 },
        { instructorId: 'staff-a', effectiveFrom: '2026-07-15', hourlyRate: 35000 },
      ],
    });

    expect(estimate).toMatchObject({
      instructorId: 'staff-a',
      completedMinutes: 120,
      estimatedBase: 60000,
      remainingBase: 60000,
    });
    expect(estimate.rateBreakdown).toEqual([
      { hourlyRate: 25000, minutes: 60, amount: 25000, effectiveFrom: '2026-06-01' },
      { hourlyRate: 35000, minutes: 60, amount: 35000, effectiveFrom: '2026-07-15' },
    ]);
  });

  it('does not change historical lesson pay when a future rate is added', () => {
    const schedule = [lesson({ date: '2026-07-05' })];
    const historicalRate = { instructorId: 'staff-a', effectiveFrom: '2026-06-01', hourlyRate: 25000 };
    const before = buildInstructorPayrollEstimates({
      staff: [staff[0]],
      schedule,
      payments: [],
      payRates: [historicalRate],
    })[0];
    const after = buildInstructorPayrollEstimates({
      staff: [staff[0]],
      schedule,
      payments: [],
      payRates: [
        historicalRate,
        { instructorId: 'staff-a', effectiveFrom: '2026-07-15', hourlyRate: 40000 },
      ],
    })[0];

    expect(before.estimatedBase).toBe(25000);
    expect(after.estimatedBase).toBe(before.estimatedBase);
    expect(after.rateBreakdown).toEqual(before.rateBreakdown);
  });

  it('keeps an active instructor visible when only normalized pay-rate history is configured', () => {
    const [estimate] = buildInstructorPayrollEstimates({
      schedule: [],
      staff: [{ ...staff[0], hourlyRate: null }],
      payments: [],
      payRates: [{ instructorId: 'staff-a', effectiveFrom: '2026-07-01', hourlyRate: 32000 }],
    });

    expect(estimate).toMatchObject({
      instructorId: 'staff-a',
      hourlyRate: 32000,
      completedMinutes: 0,
      estimatedBase: 0,
    });
  });

  it('subtracts only paid base pay from the remaining lesson pay', () => {
    const [estimate] = buildInstructorPayrollEstimates({
      staff: [staff[0]],
      schedule: [lesson({ startTime: '10:00', endTime: '12:00' })],
      payments: [payment({
        grossAmount: 25000,
        baseAmount: 20000,
        additionalAmount: 10000,
        deductionAmount: 5000,
      })],
    });

    expect(estimate).toMatchObject({
      estimatedBase: 60000,
      paidBase: 20000,
      paidGrossAmount: 25000,
      additionalAmount: 10000,
      deductionAmount: 5000,
      remainingBase: 40000,
      remainingEstimatedAmount: 40000,
    });
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

  it('uses the academy payroll tax settings for the freelance preview', () => {
    expect(calculatePayrollDraft({
      hoursWorked: 10,
      hourlyRate: 20000,
      additionalAmount: 0,
      deductionAmount: 0,
      withholdingType: 'freelance_3.3',
      incomeTaxRate: 2,
      localTaxRate: 0.2,
    })).toEqual({
      baseAmount: 200000,
      additionalAmount: 0,
      deductionAmount: 0,
      grossAmount: 200000,
      withholdingTax: 4000,
      localTax: 400,
      netAmount: 195600,
    });
  });
});
