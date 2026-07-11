import { describe, expect, it } from 'vitest';

import { applyAssignedClassScope, resolveAssignedClassIds } from './classScope';
import type { AttendanceRow, ClassSummary, ScheduleItem, ScheduleRuleSummary } from './types';

function classRow(id: string, defaultInstructorId: string | null): ClassSummary {
  return {
    id,
    defaultInstructorId,
    name: id,
    grade: null,
    active: true,
    status: 'active',
    color: null,
    capacity: null,
    defaultClassroomId: null,
    courseTitle: null,
    instructorName: null,
    classroomName: null,
    studentCount: 0,
    weakTypeCount: 0,
    avgTypeScore: null,
    lastLearningAt: null,
  };
}

function scheduleRow(classId: string, instructorId: string | null): ScheduleItem {
  return {
    id: `schedule-${classId}`,
    actualId: null,
    virtual: true,
    classId,
    className: classId,
    ruleId: null,
    date: '2026-07-06',
    startTime: '10:00',
    endTime: '11:00',
    status: 'normal',
    hasEnded: false,
    classroomName: null,
    instructorId,
    instructorName: null,
    cancelReason: null,
  };
}

function ruleRow(classId: string, instructorId: string | null): ScheduleRuleSummary {
  return {
    id: `rule-${classId}`,
    classId,
    className: classId,
    dayOfWeek: 0,
    startTime: '10:00',
    endTime: '11:00',
    startDate: '2026-07-06',
    endDate: null,
    active: true,
    classroomName: null,
    instructorId,
    instructorName: null,
  };
}

function attendanceRow(classId: string): AttendanceRow {
  return {
    id: `attendance-${classId}`,
    occurrenceId: `occurrence-${classId}`,
    studentId: `student-${classId}`,
    studentName: 'Student',
    classId,
    className: classId,
    date: '2026-07-06',
    startTime: '10:00',
    endTime: '11:00',
    status: 'present',
    attendedMinutes: 60,
    billableMinutes: 60,
    notes: null,
  };
}

describe('assigned class scope', () => {
  it('includes classes assigned by default instructor, schedule item, or schedule rule', () => {
    const ids = resolveAssignedClassIds(
      'staff-1',
      [classRow('default-class', 'staff-1'), classRow('hidden-class', 'staff-2')],
      [scheduleRow('schedule-class', 'staff-1')],
      [ruleRow('rule-class', 'staff-1')],
    );

    expect([...ids].sort()).toEqual(['default-class', 'rule-class', 'schedule-class']);
  });

  it('filters all class-scoped rows to assigned classes', () => {
    const result = applyAssignedClassScope({
      staffMemberId: 'staff-1',
      classes: [classRow('class-a', 'staff-1'), classRow('class-b', 'staff-2')],
      schedule: [scheduleRow('class-a', 'staff-1'), scheduleRow('class-b', 'staff-2')],
      scheduleRules: [ruleRow('class-a', 'staff-1'), ruleRow('class-b', 'staff-2')],
      attendance: [attendanceRow('class-a'), attendanceRow('class-b')],
    });

    expect(result.classes.map((row) => row.id)).toEqual(['class-a']);
    expect(result.schedule.map((row) => row.classId)).toEqual(['class-a']);
    expect(result.scheduleRules.map((row) => row.classId)).toEqual(['class-a']);
    expect(result.attendance.map((row) => row.classId)).toEqual(['class-a']);
  });

  it('returns no rows without a staff member id', () => {
    const result = applyAssignedClassScope({
      staffMemberId: null,
      classes: [classRow('class-a', 'staff-1')],
      schedule: [scheduleRow('class-a', 'staff-1')],
      scheduleRules: [ruleRow('class-a', 'staff-1')],
      attendance: [attendanceRow('class-a')],
    });

    expect(result.classes).toEqual([]);
    expect(result.classIds.size).toBe(0);
  });
});
