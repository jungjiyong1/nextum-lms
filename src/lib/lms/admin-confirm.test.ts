import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertAdminConfirmToken, createAdminConfirmToken, type AdminConfirmScope } from './admin-confirm';

const scope: AdminConfirmScope = {
    userId: 'user-1',
    academyId: 'academy-1',
    action: 'lms.admin.reset',
    target: 'students',
};

const originalSecret = process.env.LMS_ADMIN_CONFIRM_SECRET;

describe('admin confirmation tokens', () => {
    beforeEach(() => {
        process.env.LMS_ADMIN_CONFIRM_SECRET = 'test-admin-confirm-secret';
    });

    afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.LMS_ADMIN_CONFIRM_SECRET;
        } else {
            process.env.LMS_ADMIN_CONFIRM_SECRET = originalSecret;
        }
    });

    it('accepts a token that matches the expected scope', () => {
        const { token } = createAdminConfirmToken(scope, { nowSeconds: 1000, maxAgeSeconds: 60 });

        expect(() => assertAdminConfirmToken(token, scope, 1030)).not.toThrow();
    });

    it('rejects a token for another reset target', () => {
        const { token } = createAdminConfirmToken(scope, { nowSeconds: 1000, maxAgeSeconds: 60 });

        expect(() => assertAdminConfirmToken(token, { ...scope, target: 'all' }, 1030)).toThrow(
            'Invalid admin confirmation token.',
        );
    });

    it('rejects expired tokens', () => {
        const { token } = createAdminConfirmToken(scope, { nowSeconds: 1000, maxAgeSeconds: 60 });

        expect(() => assertAdminConfirmToken(token, scope, 1061)).toThrow('Invalid admin confirmation token.');
    });

    it('rejects tampered tokens', () => {
        const { token } = createAdminConfirmToken(scope, { nowSeconds: 1000, maxAgeSeconds: 60 });

        expect(() => assertAdminConfirmToken(`${token}tampered`, scope, 1030)).toThrow(
            'Invalid admin confirmation token.',
        );
    });
});
