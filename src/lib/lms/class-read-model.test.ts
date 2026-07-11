import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { classOverviewFromReadModel } from './class-queries';

describe('class operations v2 read model adapter', () => {
    it('merges actual and virtual schedule rows without duplicating an occurrence', () => {
        const overview = classOverviewFromReadModel({
            classes: [{ id: 'class-1', name: 'A반', color: '#2563eb' }],
            scheduleRules: [{
                id: 'rule-1',
                class_id: 'class-1',
                class_name: 'A반',
                day_of_week: 0,
                start_time: '10:30:00',
                end_time: '11:30:00',
                start_date: '2026-07-06',
                end_date: null,
                active: true,
                classroom_name: '1강의실',
                instructor_id: 'staff-1',
                instructor_name: '김강사',
                interval_weeks: 1,
            }],
            occurrences: [{
                id: 'occurrence-1',
                class_id: 'class-1',
                class_name: 'A반',
                rule_id: 'rule-1',
                occurrence_date: '2026-07-06',
                start_time: '10:00:00',
                end_time: '11:00:00',
                status: 'completed',
                classroom_name: '1강의실',
                instructor_id: 'staff-1',
                instructor_name: '김강사',
                cancel_reason: null,
            }],
            attendance: [],
            books: [],
            staff: [],
            classrooms: [],
            truncated: { classes: true, scheduleRules: false, occurrences: true, attendance: false },
        }, '2026-07-06', '2026-07-13');

        expect(overview.schedule).toHaveLength(2);
        expect(overview.schedule.filter((row) => row.date === '2026-07-06')).toHaveLength(1);
        expect(overview.schedule[0]).toMatchObject({
            actualId: 'occurrence-1',
            virtual: false,
            status: 'completed',
            classColor: '#2563eb',
        });
        expect(overview.schedule[1]).toMatchObject({
            id: 'virtual:rule-1:2026-07-13',
            virtual: true,
            status: 'scheduled',
            classColor: '#2563eb',
        });
        expect(overview.truncated).toEqual({
            classes: true,
            scheduleRules: false,
            occurrences: true,
            attendance: false,
            books: false,
            staff: false,
            classrooms: false,
        });
    });

    it('suppresses a deleted recurring occurrence without regenerating its virtual row', () => {
        const overview = classOverviewFromReadModel({
            classes: [{ id: 'class-1', name: 'A반', color: '#dc2626' }],
            scheduleRules: [{
                id: 'rule-1', class_id: 'class-1', class_name: 'A반', day_of_week: 0,
                start_time: '10:00:00', end_time: '11:00:00', start_date: '2026-07-06',
                end_date: null, active: true, interval_weeks: 1,
            }],
            occurrences: [{
                id: 'deleted-occurrence', class_id: 'class-1', class_name: 'A반', rule_id: 'rule-1',
                occurrence_date: '2026-07-06', start_time: '10:00:00', end_time: '11:00:00',
                status: 'cancelled', cancel_reason: '__nextum_schedule_deleted__',
            }],
            attendance: [], books: [], staff: [], classrooms: [],
        }, '2026-07-06', '2026-07-13');

        expect(overview.schedule).toEqual([
            expect.objectContaining({
                id: 'virtual:rule-1:2026-07-13',
                date: '2026-07-13',
                classColor: '#dc2626',
            }),
        ]);
    });

    it('maps bounded attendance DTO fields', () => {
        const overview = classOverviewFromReadModel({
            classes: [], scheduleRules: [], occurrences: [], books: [], staff: [], classrooms: [],
            attendance: [{
                id: 'attendance-1', occurrence_id: 'occurrence-1', student_id: 'student-1',
                student_name: '박학생', class_id: 'class-1', class_name: 'A반',
                occurrence_date: '2026-07-10', start_time: '10:00:00', end_time: '11:00:00',
                status: 'present', attended_minutes: 60, billable_minutes: 55, notes: null,
            }],
        }, '2026-07-10', '2026-07-10');

        expect(overview.attendance[0]).toEqual({
            id: 'attendance-1', occurrenceId: 'occurrence-1', studentId: 'student-1',
            studentName: '박학생', classId: 'class-1', className: 'A반', date: '2026-07-10',
            startTime: '10:00', endTime: '11:00', status: 'present', attendedMinutes: 60,
            billableMinutes: 55, notes: null, updatedAt: null,
        });
        expect(Object.values(overview.truncated)).not.toContain(true);
    });
});
