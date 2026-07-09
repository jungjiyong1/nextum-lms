import { describe, expect, it } from 'vitest';

import {
    hasAssignedAssignmentScope,
    unresolvedAssignmentRecipientStudentIds,
} from './assignment-scope';

describe('assignment management class scope', () => {
    const assignedClassIds = new Set(['class-assigned']);

    it('allows an assignment with an explicit assigned class', () => {
        expect(hasAssignedAssignmentScope(
            assignedClassIds,
            [{ class_id: 'class-assigned' }],
            [],
        )).toBe(true);
    });

    it('allows a null-class direct recipient only through its own active assigned-class enrollment', () => {
        expect(hasAssignedAssignmentScope(
            assignedClassIds,
            [],
            [{ student_id: 'student-direct', class_id: null }],
            [{ student_id: 'student-direct', class_id: 'class-assigned', status: 'active' }],
        )).toBe(true);
    });

    it('allows an unassigned primary class only when that same recipient has an active assigned-class enrollment', () => {
        expect(hasAssignedAssignmentScope(
            assignedClassIds,
            [],
            [{ student_id: 'student-direct', class_id: 'class-primary-other' }],
            [{ student_id: 'student-direct', class_id: 'class-assigned', status: 'active' }],
        )).toBe(true);
    });

    it('rejects mixed explicit targets when any target is outside the actor scope', () => {
        expect(hasAssignedAssignmentScope(
            assignedClassIds,
            [{ class_id: 'class-assigned' }, { class_id: 'class-other' }],
            [{ student_id: 'student-assigned', class_id: 'class-assigned' }],
        )).toBe(false);
    });

    it('rejects mixed recipients unless every recipient resolves to the actor scope', () => {
        expect(hasAssignedAssignmentScope(
            assignedClassIds,
            [{ class_id: 'class-assigned' }],
            [
                { student_id: 'student-assigned', class_id: 'class-assigned' },
                { student_id: 'student-other', class_id: 'class-other' },
            ],
        )).toBe(false);
    });

    it('requests enrollment lookup only for unresolved recipients', () => {
        expect(unresolvedAssignmentRecipientStudentIds(assignedClassIds, [
            { student_id: 'student-assigned', class_id: 'class-assigned' },
            { student_id: 'student-other', class_id: 'class-other' },
            { student_id: 'student-null', class_id: null },
            { student_id: 'student-null', class_id: null },
        ])).toEqual(['student-other', 'student-null']);
    });

    it.each([
        {
            name: 'another student enrollment',
            enrollment: { student_id: 'student-other', class_id: 'class-assigned', status: 'active' },
        },
        {
            name: 'another class enrollment',
            enrollment: { student_id: 'student-direct', class_id: 'class-other', status: 'active' },
        },
        {
            name: 'inactive enrollment',
            enrollment: { student_id: 'student-direct', class_id: 'class-assigned', status: 'inactive' },
        },
    ])('rejects a direct recipient backed only by $name', ({ enrollment }) => {
        expect(hasAssignedAssignmentScope(
            assignedClassIds,
            [],
            [{ student_id: 'student-direct', class_id: null }],
            [enrollment],
        )).toBe(false);
    });
});
