import { describe, it, expect } from 'vitest';
import { getWeekStart, addDays, formatDate, parseDate, getDayIndex, getWeekRange } from './date';

describe('date utils', () => {
    describe('getWeekStart', () => {
        it('should return Monday for a Wednesday', () => {
            // 2026-01-28 is Wednesday
            const wednesday = new Date(2026, 0, 28);
            const result = getWeekStart(wednesday);
            expect(result.getDay()).toBe(1); // Monday
            expect(formatDate(result)).toBe('2026-01-26');
        });

        it('should return same day for Monday', () => {
            // 2026-01-26 is Monday
            const monday = new Date(2026, 0, 26);
            const result = getWeekStart(monday);
            expect(result.getDay()).toBe(1);
            expect(formatDate(result)).toBe('2026-01-26');
        });

        it('should handle Sunday correctly', () => {
            // 2026-02-01 is Sunday
            const sunday = new Date(2026, 1, 1);
            const result = getWeekStart(sunday);
            expect(result.getDay()).toBe(1); // Monday of previous week
            expect(formatDate(result)).toBe('2026-01-26');
        });
    });

    describe('addDays', () => {
        it('should add positive days', () => {
            const start = new Date(2026, 0, 15);
            const result = addDays(start, 5);
            expect(formatDate(result)).toBe('2026-01-20');
        });

        it('should handle negative days', () => {
            const start = new Date(2026, 0, 15);
            const result = addDays(start, -5);
            expect(formatDate(result)).toBe('2026-01-10');
        });

        it('should cross month boundaries', () => {
            const start = new Date(2026, 0, 30);
            const result = addDays(start, 5);
            expect(formatDate(result)).toBe('2026-02-04');
        });
    });

    describe('formatDate', () => {
        it('should format date as YYYY-MM-DD', () => {
            const date = new Date(2026, 0, 5);
            expect(formatDate(date)).toBe('2026-01-05');
        });

        it('should pad single digit month and day', () => {
            const date = new Date(2026, 4, 9);
            expect(formatDate(date)).toBe('2026-05-09');
        });
    });

    describe('parseDate', () => {
        it('should parse YYYY-MM-DD string', () => {
            const result = parseDate('2026-03-15');
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(2); // March = 2
            expect(result.getDate()).toBe(15);
        });
    });

    describe('getDayIndex', () => {
        it('should return 0 for Monday', () => {
            // 2026-01-26 is Monday
            expect(getDayIndex('2026-01-26')).toBe(0);
        });

        it('should return 6 for Sunday', () => {
            // 2026-02-01 is Sunday
            expect(getDayIndex('2026-02-01')).toBe(6);
        });
    });

    describe('getWeekRange', () => {
        it('should return 7 day range from week start', () => {
            const range = getWeekRange('2026-01-26');
            expect(range.startDate).toBe('2026-01-26');
            expect(range.endDate).toBe('2026-02-01');
        });
    });
});
