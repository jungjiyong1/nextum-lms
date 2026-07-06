import { describe, expect, it } from 'vitest';

import { getCookieValue, isValidCsrfPair, LMS_CSRF_COOKIE } from './csrf';

describe('LMS CSRF helpers', () => {
    it('reads a cookie value from a cookie header', () => {
        expect(getCookieValue(`a=1; ${LMS_CSRF_COOKIE}=token-1; b=2`, LMS_CSRF_COOKIE)).toBe('token-1');
    });

    it('accepts matching header and cookie values', () => {
        expect(isValidCsrfPair('token-1', `${LMS_CSRF_COOKIE}=token-1`)).toBe(true);
    });

    it('rejects missing or mismatched values', () => {
        expect(isValidCsrfPair(null, `${LMS_CSRF_COOKIE}=token-1`)).toBe(false);
        expect(isValidCsrfPair('token-2', `${LMS_CSRF_COOKIE}=token-1`)).toBe(false);
        expect(isValidCsrfPair('token-1', null)).toBe(false);
    });
});
