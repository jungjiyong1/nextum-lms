import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { assertSameOrigin, LmsAuthError } from './auth';

function mutationRequest(headers: Record<string, string> = {}) {
    return new Request('https://lms.example.com/api/lms/classes', {
        method: 'POST',
        headers,
    });
}

describe('LMS mutation request guard', () => {
    it('accepts a same-origin request with a matching CSRF pair', () => {
        expect(() => assertSameOrigin(mutationRequest({
            origin: 'https://lms.example.com',
            cookie: 'nextum_lms_csrf=token-1',
            'x-nextum-lms-csrf': 'token-1',
        }))).not.toThrow();
    });

    it('rejects a mutation without a CSRF token even when Origin is omitted', () => {
        expect(() => assertSameOrigin(mutationRequest())).toThrowError(LmsAuthError);
    });

    it('rejects a cross-origin mutation', () => {
        expect(() => assertSameOrigin(mutationRequest({
            origin: 'https://evil.example',
            cookie: 'nextum_lms_csrf=token-1',
            'x-nextum-lms-csrf': 'token-1',
        }))).toThrow('Cross-origin admin requests are not allowed.');
    });

    it('does not require a CSRF token for a read request', () => {
        const request = new Request('https://lms.example.com/api/lms/classes', { method: 'GET' });
        expect(() => assertSameOrigin(request)).not.toThrow();
    });
});
