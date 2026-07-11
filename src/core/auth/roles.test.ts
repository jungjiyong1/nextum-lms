import { describe, expect, it } from 'vitest';

import {
    appPageFromPath,
    canAccessAppPath,
    canManageScheduleRules,
    canAccessAppPage,
    firstAccessibleAppPage,
    getRoleLabel,
    normalizeAppRole,
    requiresAssignedClassScope,
} from './roles';

describe('LMS app roles', () => {
    it('preserves canonical LMS roles', () => {
        expect(normalizeAppRole('owner')).toBe('owner');
        expect(normalizeAppRole('teacher')).toBe('teacher');
        expect(normalizeAppRole('student')).toBe('student');
        expect(normalizeAppRole('guardian')).toBe('guardian');
    });

    it('normalizes legacy manager and defaults unknown roles to least privilege', () => {
        expect(normalizeAppRole('manager')).toBe('admin');
        expect(normalizeAppRole('unexpected')).toBe('student');
        expect(normalizeAppRole(null)).toBe('student');
    });

    it('limits operational pages by role', () => {
        expect(canAccessAppPage('owner', 'settings')).toBe(true);
        expect(canAccessAppPage('admin', 'instructors')).toBe(true);
        expect(canAccessAppPage('staff', 'students')).toBe(true);
        expect(canAccessAppPage('staff', 'instructors')).toBe(true);
        expect(canAccessAppPage('staff', 'settings')).toBe(false);
        expect(canAccessAppPage('instructor', 'classrooms')).toBe(true);
        expect(canAccessAppPage('instructor', 'students')).toBe(true);
        expect(canAccessAppPage('instructor', 'instructors')).toBe(true);
        expect(canAccessAppPage('instructor', 'learning')).toBe(true);
        expect(canAccessAppPage('student', 'learning')).toBe(false);
        expect(canAccessAppPage('student', 'home')).toBe(false);
        expect(canAccessAppPage('guardian', 'home')).toBe(false);
    });

    it('finds the first allowed page or null for non-operational roles', () => {
        expect(firstAccessibleAppPage('staff')).toBe('home');
        expect(firstAccessibleAppPage('student')).toBeNull();
    });

    it('separates schedule rule management from assigned-class operations', () => {
        expect(canManageScheduleRules('owner')).toBe(true);
        expect(canManageScheduleRules('staff')).toBe(true);
        expect(canManageScheduleRules('teacher')).toBe(false);
        expect(canManageScheduleRules('instructor')).toBe(false);
        expect(requiresAssignedClassScope('teacher')).toBe(true);
        expect(requiresAssignedClassScope('instructor')).toBe(true);
        expect(requiresAssignedClassScope('staff')).toBe(false);
    });

    it('maps paths to app pages', () => {
        expect(appPageFromPath('/')).toBe('home');
        expect(appPageFromPath('/students/123')).toBe('students');
        expect(appPageFromPath('/learning/exams')).toBe('learning');
        expect(appPageFromPath('/settings')).toBe('settings');
    });

    it('limits tax reports to owners and administrators while keeping operations available to staff', () => {
        expect(canAccessAppPath('owner', '/accounting/reports')).toBe(true);
        expect(canAccessAppPath('admin', '/accounting/reports?month=2026-07')).toBe(true);
        expect(canAccessAppPath('staff', '/accounting/reports')).toBe(false);
        expect(canAccessAppPath('staff', '/accounting/payments')).toBe(true);
        expect(canAccessAppPath('staff', '/accounting/payroll')).toBe(true);
        expect(canAccessAppPath('staff', '/accounting/expenses')).toBe(true);
    });

    it('returns Korean labels for visible roles', () => {
        expect(getRoleLabel('owner')).toBe('소유자');
        expect(getRoleLabel('student')).toBe('학생');
    });
});
