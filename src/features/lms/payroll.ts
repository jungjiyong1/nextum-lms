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

export interface InstructorPayRateSnapshot {
  instructorId: string;
  effectiveFrom: string;
  hourlyRate: number;
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
  payRates = [],
}: {
  schedule: ScheduleItem[];
  staff: StaffSummary[];
  payments: InstructorPaymentRow[];
  payRates?: InstructorPayRateSnapshot[];
}): InstructorPayrollEstimate[] {
  const staffById = new Map(staff.map((row) => [row.id, row]));
  const ratesByInstructor = new Map<string, InstructorPayRateSnapshot[]>();
  for (const rate of payRates) {
    const rates = ratesByInstructor.get(rate.instructorId) || [];
    rates.push(rate);
    ratesByInstructor.set(rate.instructorId, rates);
  }
  for (const rates of ratesByInstructor.values()) {
    rates.sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));
  }
  const activity = new Map<string, {
    instructorName: string;
    completedLessonCount: number;
    completedMinutes: number;
    scheduledLessonCount: number;
    scheduledMinutes: number;
    estimatedBase: number;
    rateBreakdown: Map<string, { hourlyRate: number; minutes: number; amount: number; effectiveFrom: string | null }>;
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
      estimatedBase: 0,
      rateBreakdown: new Map(),
    };
    activity.set(instructorId, created);
    return created;
  };

  for (const lesson of schedule) {
    if (lesson.status === 'cancelled') continue;
    const lessonMinutes = lessonDurationMinutes(lesson.startTime, lesson.endTime);
    const participants = lesson.instructors?.length
      ? lesson.instructors
      : lesson.instructorId
        ? [{
            instructorId: lesson.instructorId,
            instructorName: lesson.instructorName,
            participationKind: lesson.substituteInstructorId ? 'substitute' as const : 'regular' as const,
            payableMinutes: lessonMinutes,
          }]
        : [];
    for (const participant of participants) {
      const minutes = Math.min(lessonMinutes, Math.max(0, participant.payableMinutes ?? lessonMinutes));
      if (minutes <= 0) continue;
      const row = ensureActivity(participant.instructorId, participant.instructorName);
      row.scheduledLessonCount += 1;
      row.scheduledMinutes += minutes;
      if (lesson.hasEnded) {
        row.completedLessonCount += 1;
        row.completedMinutes += minutes;
        const rateSnapshot = (ratesByInstructor.get(participant.instructorId) || [])
          .find((rate) => rate.effectiveFrom <= lesson.date);
        const hourlyRate = rateSnapshot?.hourlyRate ?? staffById.get(participant.instructorId)?.hourlyRate ?? 0;
        const amount = (minutes / 60) * nonNegativeNumber(hourlyRate);
        row.estimatedBase += amount;
        if (hourlyRate > 0) {
          const key = `${hourlyRate}:${rateSnapshot?.effectiveFrom || ''}`;
          const current = row.rateBreakdown.get(key) || {
            hourlyRate,
            minutes: 0,
            amount: 0,
            effectiveFrom: rateSnapshot?.effectiveFrom || null,
          };
          current.minutes += minutes;
          current.amount += amount;
          row.rateBreakdown.set(key, current);
        }
      }
    }
  }

  const paidByInstructor = new Map<string, { gross: number; base: number; additional: number; deduction: number }>();
  for (const payment of payments) {
    if (!payment.instructorId || payment.status !== 'paid') continue;
    const paid = paidByInstructor.get(payment.instructorId) || { gross: 0, base: 0, additional: 0, deduction: 0 };
    paid.gross += nonNegativeNumber(payment.grossAmount);
    paid.base += nonNegativeNumber(payment.baseAmount);
    paid.additional += nonNegativeNumber(payment.additionalAmount);
    paid.deduction += nonNegativeNumber(payment.deductionAmount);
    paidByInstructor.set(payment.instructorId, paid);
    ensureActivity(payment.instructorId, payment.instructorName || payment.recipientName);
  }

  for (const member of staff) {
    if (
      member.status !== 'inactive'
      && (nonNegativeNumber(member.hourlyRate) > 0 || (ratesByInstructor.get(member.id)?.length || 0) > 0)
    ) {
      ensureActivity(member.id, member.name);
    }
  }

  return [...activity.entries()]
    .map(([instructorId, row]) => {
      const rateBreakdown = [...row.rateBreakdown.values()].map((rate) => ({
        ...rate,
        amount: money(rate.amount),
      })).sort((left, right) => (left.effectiveFrom || '').localeCompare(right.effectiveFrom || ''));
      const latestConfiguredRate = ratesByInstructor.get(instructorId)?.[0]?.hourlyRate ?? null;
      const hourlyRate = rateBreakdown.length === 1
        ? rateBreakdown[0].hourlyRate
        : latestConfiguredRate ?? staffById.get(instructorId)?.hourlyRate ?? null;
      const estimatedBase = money(row.estimatedBase);
      const paid = paidByInstructor.get(instructorId) || { gross: 0, base: 0, additional: 0, deduction: 0 };
      const paidGrossAmount = money(paid.gross);
      const paidBase = money(paid.base);
      const remainingBase = Math.max(0, estimatedBase - paidBase);
      return {
        instructorId,
        instructorName: row.instructorName,
        hourlyRate,
        rateBreakdown,
        completedLessonCount: row.completedLessonCount,
        completedMinutes: row.completedMinutes,
        scheduledLessonCount: row.scheduledLessonCount,
        scheduledMinutes: row.scheduledMinutes,
        estimatedGrossAmount: estimatedBase,
        paidGrossAmount,
        remainingEstimatedAmount: remainingBase,
        estimatedBase,
        paidBase,
        additionalAmount: money(paid.additional),
        deductionAmount: money(paid.deduction),
        remainingBase,
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
  incomeTaxRate = 3,
  localTaxRate = 0.3,
}: {
  hoursWorked: number;
  hourlyRate: number;
  additionalAmount: number;
  deductionAmount: number;
  withholdingType: WithholdingType;
  customWithholdingRate?: number;
  incomeTaxRate?: number;
  localTaxRate?: number;
}): PayrollDraftPreview {
  const baseAmount = money(nonNegativeNumber(hoursWorked) * nonNegativeNumber(hourlyRate));
  const additional = money(additionalAmount);
  const deduction = money(deductionAmount);
  const grossAmount = Math.max(0, baseAmount + additional - deduction);

  let withholdingTax = 0;
  let localTax = 0;
  if (withholdingType === 'freelance_3.3') {
    withholdingTax = money(grossAmount * nonNegativeNumber(incomeTaxRate) / 100);
    localTax = money(grossAmount * nonNegativeNumber(localTaxRate) / 100);
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
