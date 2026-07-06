import type { AttendanceRow, ClassSummary, ScheduleItem, ScheduleRuleSummary } from './types';

export interface AssignedClassScopeInput {
  staffMemberId: string | null | undefined;
  classes: ClassSummary[];
  schedule: ScheduleItem[];
  scheduleRules: ScheduleRuleSummary[];
  attendance: AttendanceRow[];
}

export function resolveAssignedClassIds(
  staffMemberId: string | null | undefined,
  classes: ClassSummary[],
  schedule: ScheduleItem[],
  scheduleRules: ScheduleRuleSummary[],
): Set<string> {
  const ids = new Set<string>();
  if (!staffMemberId) return ids;

  classes
    .filter((row) => row.defaultInstructorId === staffMemberId)
    .forEach((row) => ids.add(row.id));
  schedule
    .filter((row) => row.instructorId === staffMemberId)
    .forEach((row) => ids.add(row.classId));
  scheduleRules
    .filter((row) => row.instructorId === staffMemberId)
    .forEach((row) => ids.add(row.classId));

  return ids;
}

export function applyAssignedClassScope(input: AssignedClassScopeInput) {
  const classIds = resolveAssignedClassIds(
    input.staffMemberId,
    input.classes,
    input.schedule,
    input.scheduleRules,
  );

  return {
    classIds,
    classes: input.classes.filter((row) => classIds.has(row.id)),
    schedule: input.schedule.filter((row) => classIds.has(row.classId)),
    scheduleRules: input.scheduleRules.filter((row) => classIds.has(row.classId)),
    attendance: input.attendance.filter((row) => classIds.has(row.classId)),
  };
}
