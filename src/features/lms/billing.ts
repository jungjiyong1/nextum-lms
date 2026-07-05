import type { AttendanceStatus, BillingClassRuleType, BillingMode } from './types';

export interface BillingContractSnapshot {
  studentId: string;
  billingMode: BillingMode;
  baseMonthlyFee: number;
  hourlyRate: number | null;
}

export interface BillingClassRuleSnapshot {
  classId: string;
  className: string | null;
  ruleType: BillingClassRuleType;
  amount: number;
}

export interface AttendanceUsageSnapshot {
  classId: string;
  className: string | null;
  occurrenceId: string;
  status: AttendanceStatus;
  billableMinutes: number | null;
}

export interface InvoiceDraftLine {
  lineType: 'base_fee' | 'class_extra' | 'usage' | 'discount' | 'manual';
  classId: string | null;
  occurrenceId: string | null;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
}

export interface InvoiceDraft {
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  lines: InvoiceDraftLine[];
}

function money(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric);
}

function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function labelForClass(className: string | null, fallback = '반'): string {
  return className || fallback;
}

function sumUsage(
  attendances: AttendanceUsageSnapshot[],
  classId: string | null,
): { minutes: number; occurrences: string[] } {
  const relevant = attendances.filter((row) => {
    if (classId && row.classId !== classId) return false;
    return (row.billableMinutes || 0) > 0;
  });

  return {
    minutes: relevant.reduce((sum, row) => sum + (row.billableMinutes || 0), 0),
    occurrences: relevant.map((row) => row.occurrenceId),
  };
}

export function calculateInvoiceDraft({
  contract,
  rules,
  attendances,
}: {
  contract: BillingContractSnapshot;
  rules: BillingClassRuleSnapshot[];
  attendances: AttendanceUsageSnapshot[];
}): InvoiceDraft {
  if (contract.billingMode === 'manual') {
    return { subtotalAmount: 0, discountAmount: 0, totalAmount: 0, lines: [] };
  }

  const lines: InvoiceDraftLine[] = [];

  if (contract.billingMode === 'monthly_plus_classes' && contract.baseMonthlyFee > 0) {
    lines.push({
      lineType: 'base_fee',
      classId: null,
      occurrenceId: null,
      description: '월 기본 수강료',
      quantity: 1,
      unitAmount: money(contract.baseMonthlyFee),
      amount: money(contract.baseMonthlyFee),
    });
  }

  if (contract.billingMode === 'usage_based') {
    const grouped = new Map<string, AttendanceUsageSnapshot[]>();
    for (const attendance of attendances) {
      if ((attendance.billableMinutes || 0) <= 0) continue;
      const key = attendance.classId;
      grouped.set(key, [...(grouped.get(key) || []), attendance]);
    }

    for (const [classId, rows] of grouped) {
      const minutes = rows.reduce((sum, row) => sum + (row.billableMinutes || 0), 0);
      const hours = hoursFromMinutes(minutes);
      const rate = money(contract.hourlyRate);
      if (hours <= 0 || rate <= 0) continue;
      lines.push({
        lineType: 'usage',
        classId,
        occurrenceId: null,
        description: `${labelForClass(rows[0]?.className, '시간제 수업')} 사용료`,
        quantity: hours,
        unitAmount: rate,
        amount: money(hours * rate),
      });
    }
  }

  if (contract.billingMode === 'monthly_plus_classes') {
    for (const rule of rules) {
      const amount = money(rule.amount);
      if (rule.ruleType === 'extra_flat' && amount > 0) {
        lines.push({
          lineType: 'class_extra',
          classId: rule.classId,
          occurrenceId: null,
          description: `${labelForClass(rule.className)} 추가 수강료`,
          quantity: 1,
          unitAmount: amount,
          amount,
        });
      }

      if (rule.ruleType === 'usage_based') {
        const usage = sumUsage(attendances, rule.classId);
        const hours = hoursFromMinutes(usage.minutes);
        const rate = amount > 0 ? amount : money(contract.hourlyRate);
        if (hours > 0 && rate > 0) {
          lines.push({
            lineType: 'usage',
            classId: rule.classId,
            occurrenceId: null,
            description: `${labelForClass(rule.className)} 시간제 추가 수강료`,
            quantity: hours,
            unitAmount: rate,
            amount: money(hours * rate),
          });
        }
      }

      if (rule.ruleType === 'discount' && amount > 0) {
        lines.push({
          lineType: 'discount',
          classId: rule.classId,
          occurrenceId: null,
          description: `${labelForClass(rule.className)} 할인`,
          quantity: 1,
          unitAmount: -amount,
          amount: -amount,
        });
      }
    }
  }

  const positive = lines
    .filter((line) => line.amount > 0)
    .reduce((sum, line) => sum + line.amount, 0);
  const discount = Math.abs(
    lines.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0),
  );

  return {
    subtotalAmount: positive,
    discountAmount: discount,
    totalAmount: Math.max(0, positive - discount),
    lines,
  };
}
