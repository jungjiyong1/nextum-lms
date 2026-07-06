import { describe, expect, it } from 'vitest';
import { buildLessonScheduleKey, isBillableLessonScheduleStatus } from './scheduleStatus';

describe('schedule status helpers', () => {
    it('treats active teaching statuses as billable and cancelled as non-billable', () => {
        expect(isBillableLessonScheduleStatus('scheduled')).toBe(true);
        expect(isBillableLessonScheduleStatus('completed')).toBe(true);
        expect(isBillableLessonScheduleStatus('substitute')).toBe(true);
        expect(isBillableLessonScheduleStatus('makeup')).toBe(true);
        expect(isBillableLessonScheduleStatus('cancelled')).toBe(false);
    });

    it('keys materialized schedules by lesson, date, and time', () => {
        expect(buildLessonScheduleKey(10, '2026-07-06', '17:00', '18:30')).toBe('10-2026-07-06-17:00-18:30');
        expect(buildLessonScheduleKey(10, '2026-07-06', '19:00', '20:30')).not.toBe(
            buildLessonScheduleKey(10, '2026-07-06', '17:00', '18:30'),
        );
    });
});
