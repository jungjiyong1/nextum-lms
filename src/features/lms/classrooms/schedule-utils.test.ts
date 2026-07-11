import { describe, expect, it } from 'vitest';

import type { ScheduleItem } from '../types';
import {
  addDateValue,
  isSpecialLessonStatus,
  layoutScheduleOverlaps,
  lessonSpecialStatusSelection,
  resolveLessonOccurrenceStatus,
  scheduleHourRange,
  startOfWeekValue,
  weekDateValues,
} from './schedule-utils';

function lesson(id: string, startTime: string, endTime: string): ScheduleItem {
  return {
    id,
    actualId: null,
    virtual: true,
    classId: `class-${id}`,
    className: `Class ${id}`,
    ruleId: `rule-${id}`,
    date: '2026-07-06',
    startTime,
    endTime,
    status: 'normal',
    hasEnded: false,
    classroomName: null,
    instructorId: null,
    instructorName: null,
    cancelReason: null,
  };
}

describe('class schedule date and layout helpers', () => {
  it('normalizes any date to its Monday-first week', () => {
    expect(startOfWeekValue('2026-07-10')).toBe('2026-07-06');
    expect(weekDateValues('2026-07-06')).toEqual([
      '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
      '2026-07-10', '2026-07-11', '2026-07-12',
    ]);
    expect(addDateValue('2026-07-31', 1)).toBe('2026-08-01');
  });

  it('assigns overlapping lessons to separate lanes and reuses free lanes', () => {
    const positioned = layoutScheduleOverlaps([
      lesson('a', '09:00', '10:00'),
      lesson('b', '09:30', '11:00'),
      lesson('c', '10:00', '10:30'),
      lesson('d', '12:00', '13:00'),
    ]);
    const byId = new Map(positioned.map((row) => [row.item.id, row]));

    expect(byId.get('a')).toMatchObject({ lane: 0, laneCount: 2 });
    expect(byId.get('b')).toMatchObject({ lane: 1, laneCount: 2 });
    expect(byId.get('c')).toMatchObject({ lane: 0, laneCount: 2 });
    expect(byId.get('d')).toMatchObject({ lane: 0, laneCount: 1 });
  });

  it('keeps a readable hour range around the scheduled lessons', () => {
    expect(scheduleHourRange([lesson('a', '16:30', '18:10')])).toEqual({ startHour: 15, endHour: 20 });
    expect(scheduleHourRange([])).toEqual({ startHour: 9, endHour: 22 });
  });

  it('treats normal lessons separately from operational exceptions', () => {
    expect(lessonSpecialStatusSelection('normal')).toBe('');
    expect(isSpecialLessonStatus('cancelled')).toBe(true);
    expect(isSpecialLessonStatus('makeup')).toBe(true);
    expect(isSpecialLessonStatus('substitute')).toBe(true);

    expect(resolveLessonOccurrenceStatus('')).toBe('normal');
    expect(resolveLessonOccurrenceStatus('makeup')).toBe('makeup');
  });
});
