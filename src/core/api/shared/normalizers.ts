// Shared normalizers for API responses
import type { Lesson, ScheduleLesson, LessonRow, ScheduleRow } from '../../types';
import { getDayIndex } from '../../utils/date';
import { timeToSlot, slotToTime as centralSlotToTime } from '../../utils/time';

export function normalizeLesson(row: LessonRow): Lesson {
    return {
        id: Number(row.id),
        classroomId: Number(row.classroom_id),
        day: row.day ?? null,
        startSlot: row.start_slot ?? null,
        endSlot: row.end_slot ?? null,
        title: row.title || '',
        instructor: row.instructor || '',
        instructorId: row.instructor_id ?? null,
        note: row.note || '',
    };
}

export function normalizeSchedule(row: ScheduleRow): ScheduleLesson {
    return {
        id: Number(row.schedule_id),
        lessonId: Number(row.lesson_id),
        ruleId: row.rule_id ?? null,
        classroomId: Number(row.classroom_id ?? 0),
        day: getDayIndex(row.date),
        startSlot: timeToSlot(row.start_time),
        endSlot: timeToSlot(row.end_time),
        title: row.title || '',
        instructor: row.instructor || '',
        instructorId: row.instructor_id ?? null,
        note: row.lesson_note ?? row.schedule_notes ?? '',
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status as ScheduleLesson['status'],
        substituteInstructorId: row.substitute_instructor_id ?? null,
        substituteInstructorName: row.substitute_instructor_name ?? null,
        cancelReason: row.cancel_reason ?? null,
    };
}

// Slot to time conversion helper - re-export from central utils
export const slotToTime = centralSlotToTime;
