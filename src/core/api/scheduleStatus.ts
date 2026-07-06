export const BILLABLE_LESSON_SCHEDULE_STATUSES = ['scheduled', 'completed', 'substitute', 'makeup'] as const;

export function isBillableLessonScheduleStatus(status: string | null | undefined): boolean {
    return BILLABLE_LESSON_SCHEDULE_STATUSES.includes(status as typeof BILLABLE_LESSON_SCHEDULE_STATUSES[number]);
}

export function buildLessonScheduleKey(
    lessonId: number | string,
    date: string | null | undefined,
    startTime: string | null | undefined,
    endTime: string | null | undefined,
): string {
    return `${lessonId}-${date || ''}-${startTime || ''}-${endTime || ''}`;
}
