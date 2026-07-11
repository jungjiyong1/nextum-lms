import type {
  InstructorPaymentRow,
  InstructorPayrollEstimate,
  ScheduleItem,
  StaffSummary,
  WithholdingType,
} from './types';

export interface PayrollDraftPreview {
  baseAmount: number;
  additionalAmount: number;
  deductionAmount: number;
  grossAmount: number;
  withholdingTax: number;
  localTax: number;
  netAmount: number;
}

function nonNegativeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function money(value: unknown): number {
  return Math.round(nonNegativeNumber(value));
}

export function lessonDurationMinutes(startTime: string, endTime: string): number {
  const parse = (value: string) => {
    const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };

  const start = parse(startTime);
  const end = parse(endTime);
  if (start === null || end === null) return 0;
  const duration = end >= start ? end - start : end + (24 * 60) - start;
  return Math.max(0, duration);
}

export function buildInstructorPayrollEstimates({
  schedule,
  staff,
  payments,
}: {
  schedule: ScheduleItem[];
  staff: StaffSummary[];
  payments: InstructorPaymentRow[];
}): InstructorPayrollEstimate[] {
  const staffById = new Map(staff.map((row) => [row.id, row]));
  const activity = new Map<string, {
    instructorName: string;
    completedLessonCount: number;
    completedMinutes: number;
    scheduledLessonCount: number;
    scheduledMinutes: number;
  }>();

  const ensureActivity = (instructorId: string, fallbackName?: string | null) => {
    const current = activity.get(instructorId);
    if (current) return current;
    const created = {
      instructorName: staffById.get(instructorId)?.name || fallbackName || '이름 미확인',
      completedLessonCount: 0,
      completedMinutes: 0,
      scheduledLessonCount: 0,
      scheduledMinutes: 0,
    };
    activity.set(instructorId, created);
    return created;
  };

  for (const lesson of schedule) {
    if (!lesson.instructorId || lesson.status === 'cancelled') continue;
    const minutes = lessonDurationMinutes(lesson.startTime, lesson.endTime);
    if (minutes <= 0) continue;
    const row = ensureActivity(lesson.instructorId, lesson.instructorName);
    row.scheduledLessonCount += 1;
    row.scheduledMinutes += minutes;
    if (lesson.hasEnded) {
      row.completedLessonCount += 1;
      row.completedMinutes += minutes;
    }
  }

  const paidByInstructor = new Map<string, number>();
  for (const payment of payments) {
    if (!payment.instructorId || payment.status !== 'paid') continue;
    paidByInstructor.set(
      payment.instructorId,
      (paidByInstructor.get(payment.instructorId) || 0) + nonNegativeNumber(payment.grossAmount),
    );
    ensureActivity(payment.instructorId, payment.instructorName || payment.recipientName);
  }

  for (const member of staff) {
    if (member.status !== 'inactive' && nonNegativeNumber(member.hourlyRate) > 0) {
      ensureActivity(member.id, member.name);
    }
  }

  return [...activity.entries()]
    .map(([instructorId, row]) => {
      const hourlyRate = staffById.get(instructorId)?.hourlyRate ?? null;
      const estimatedGrossAmount = hourlyRate
        ? money((row.completedMinutes / 60) * hourlyRate)
        : 0;
      const paidGrossAmount = money(paidByInstructor.get(instructorId));
      return {
        instructorId,
        instructorName: row.instructorName,
        hourlyRate,
        completedLessonCount: row.completedLessonCount,
        completedMinutes: row.completedMinutes,
        scheduledLessonCount: row.scheduledLessonCount,
        scheduledMinutes: row.scheduledMinutes,
        estimatedGrossAmount,
        paidGrossAmount,
        remainingEstimatedAmount: Math.max(0, estimatedGrossAmount - paidGrossAmount),
      };
    })
    .sort((a, b) => (
      b.completedMinutes - a.completedMinutes
      || b.scheduledMinutes - a.scheduledMinutes
      || a.instructorName.localeCompare(b.instructorName, 'ko')
    ));
}

export function calculatePayrollDraft({
  hoursWorked,
  hourlyRate,
  additionalAmount,
  deductionAmount,
  withholdingType,
  customWithholdingRate,
}: {
  hoursWorked: number;
  hourlyRate: number;
  additionalAmount: number;
  deductionAmount: number;
  withholdingType: WithholdingType;
  customWithholdingRate?: number;
}): PayrollDraftPreview {
  const baseAmount = money(nonNegativeNumber(hoursWorked) * nonNegativeNumber(hourlyRate));
  const additional = money(additionalAmount);
  const deduction = money(deductionAmount);
  const grossAmount = Math.max(0, baseAmount + additional - deduction);

  let withholdingTax = 0;
  let localTax = 0;
  if (withholdingType === 'freelance_3.3') {
    withholdingTax = money(grossAmount * 0.03);
    localTax = money(withholdingTax * 0.1);
  } else if (withholdingType === 'custom') {
    withholdingTax = money(grossAmount * nonNegativeNumber(customWithholdingRate) / 100);
  }

  return {
    baseAmount,
    additionalAmount: additional,
    deductionAmount: deduction,
    grossAmount,
    withholdingTax,
    localTax,
    netAmount: Math.max(0, grossAmount - withholdingTax - localTax),
  };
}
