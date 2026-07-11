import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseStudentGradeAppAccount } from './student-queries';

describe('student Grade app account visibility', () => {
    it.each(['owner', 'admin'] as const)('returns the login identifier for %s', (role) => {
        expect(parseStudentGradeAppAccount(role, {
            login_id: ' student-dev ',
            auth_email: 'student-dev@nextum.local',
            status: 'active',
            auth_user_id: 'must-not-leak',
            encrypted_password: 'must-not-leak',
        })).toEqual({
            loginId: 'student-dev',
            status: 'active',
        });
    });

    it('uses the authentication email when a legacy account has no login id', () => {
        expect(parseStudentGradeAppAccount('admin', {
            login_id: null,
            auth_email: 'legacy-student@nextum.local',
            status: 'active',
        })).toEqual({
            loginId: 'legacy-student@nextum.local',
            status: 'active',
        });
    });

    it.each(['staff', 'teacher', 'instructor', 'student', 'guardian'] as const)(
        'does not expose the account to %s',
        (role) => {
            expect(parseStudentGradeAppAccount(role, {
                login_id: 'student-dev',
                auth_email: 'student-dev@nextum.local',
                status: 'active',
            })).toBeNull();
        },
    );
});
