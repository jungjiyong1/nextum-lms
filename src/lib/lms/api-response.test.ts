import { describe, expect, it } from 'vitest';
import { apiRequestId, mutationError, mutationException, mutationSuccess } from './api-response';

describe('mutation API responses', () => {
    it('returns the canonical success contract with compatibility aliases', async () => {
        const response = mutationSuccess({ id: 'assignment-1' }, {
            request: new Request('http://localhost/api/lms/assignments', {
                headers: { 'X-Request-Id': 'request-1' },
            }),
            invalidation: { eventId: 'event-1', domains: ['assignments'] },
            aliases: { assignment: { id: 'assignment-1' } },
        });

        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('X-Request-Id')).toBe('request-1');
        await expect(response.json()).resolves.toEqual({
            success: true,
            data: { id: 'assignment-1' },
            assignment: { id: 'assignment-1' },
            invalidation: { eventId: 'event-1', domains: ['assignments'] },
        });
    });

    it('returns structured errors with field errors and a request id', async () => {
        const response = mutationError('INVALID_REQUEST', 'title is required', {
            requestId: 'request-2',
            status: 422,
            fieldErrors: { title: ['title is required'] },
        });

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: {
                code: 'INVALID_REQUEST',
                message: 'title is required',
                requestId: 'request-2',
                fieldErrors: { title: ['title is required'] },
            },
        });
    });

    it('does not expose internal exception messages', async () => {
        const known = mutationException(new Error('database unavailable'), 'WRITE_FAILED', 'fallback', {
            requestId: 'request-3',
        });
        const unknown = mutationException(null, 'WRITE_FAILED', 'fallback', { requestId: 'request-4' });

        expect(known.status).toBe(500);
        await expect(known.json()).resolves.toMatchObject({
            error: { code: 'WRITE_FAILED', message: 'fallback', requestId: 'request-3' },
        });
        await expect(unknown.json()).resolves.toMatchObject({
            error: { code: 'WRITE_FAILED', message: 'fallback', requestId: 'request-4' },
        });
    });

    it('does not reflect malformed request identifiers into response headers', () => {
        const requestId = apiRequestId({ requestId: 'invalid request id' });

        expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(requestId).not.toBe('invalid request id');
    });
});
