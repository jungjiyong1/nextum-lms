import { describe, expect, it } from 'vitest';

import { isProtectedAppPath, isPublicAuthPath } from './routes';

describe('LMS route guards', () => {
    it('marks app pages as protected', () => {
        expect(isProtectedAppPath('/')).toBe(true);
        expect(isProtectedAppPath('/students')).toBe(true);
        expect(isProtectedAppPath('/students/abc')).toBe(true);
        expect(isProtectedAppPath('/accounting/')).toBe(true);
    });

    it('leaves public and API paths unprotected by page redirect logic', () => {
        expect(isProtectedAppPath('/login')).toBe(false);
        expect(isProtectedAppPath('/signup')).toBe(false);
        expect(isProtectedAppPath('/api/lms/students')).toBe(false);
        expect(isProtectedAppPath('/icon.png')).toBe(false);
    });

    it('identifies public auth pages', () => {
        expect(isPublicAuthPath('/login')).toBe(true);
        expect(isPublicAuthPath('/signup')).toBe(true);
        expect(isPublicAuthPath('/signup/invite')).toBe(true);
        expect(isPublicAuthPath('/students')).toBe(false);
    });
});
