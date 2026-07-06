import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldUseSecureCookies } from './secure-cookie';

function request(url: string, headers?: Record<string, string>) {
    return new Request(url, { headers });
}

describe('shouldUseSecureCookies', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('does not require secure cookies in development', () => {
        vi.stubEnv('NODE_ENV', 'development');

        expect(shouldUseSecureCookies(request('https://localhost:3100'))).toBe(false);
    });

    it('keeps secure cookies for direct HTTPS production requests', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(shouldUseSecureCookies(request('https://lms.example.com'))).toBe(true);
    });

    it('keeps secure cookies behind HTTPS forwarding', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(shouldUseSecureCookies(request('http://internal:3100', { 'x-forwarded-proto': 'https' }))).toBe(true);
    });

    it('allows local production HTTP smoke tests to store cookies', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(shouldUseSecureCookies(request('http://localhost:3100'))).toBe(false);
    });
});
