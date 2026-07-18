import { describe, expect, it } from 'vitest';

import { isApiPath, isProtectedAppPath, isPublicAuthPath } from './routes';

describe('LMS route guards', () => {
    it('marks app pages as protected', () => {
        expect(isProtectedAppPath('/')).toBe(true);
        expect(isProtectedAppPath('/students')).toBe(true);
        expect(isProtectedAppPath('/students/abc')).toBe(true);
        expect(isProtectedAppPath('/accounting/')).toBe(true);
        expect(isProtectedAppPath('/learning')).toBe(true);
        expect(isProtectedAppPath('/learning/exams?planId=plan-1')).toBe(true);
        expect(isProtectedAppPath('/select-academy')).toBe(true);
    });

    it('leaves public and API paths unprotected by page redirect logic', () => {
        expect(isProtectedAppPath('/login')).toBe(false);
        expect(isProtectedAppPath('/api/lms/students')).toBe(false);
        expect(isProtectedAppPath('/icon.png')).toBe(false);
    });

    it('identifies public auth pages', () => {
        expect(isPublicAuthPath('/login')).toBe(true);
        expect(isPublicAuthPath('/signup')).toBe(false);
        expect(isPublicAuthPath('/students')).toBe(false);
    });

    it('classifies API paths so the page proxy can avoid duplicate authentication', () => {
        expect(isApiPath('/api')).toBe(true);
        expect(isApiPath('/api/lms/dashboard')).toBe(true);
        expect(isApiPath('/assignments')).toBe(false);
    });
});
