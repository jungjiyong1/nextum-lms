import { describe, expect, it } from 'vitest';
import {
    ApiContractError,
    DEFAULT_CURSOR_LIMIT,
    MAX_CURSOR_LIMIT,
    decodeCursor,
    encodeCursor,
    normalizeCursorLimit,
} from './api-contracts';

interface TestCursor {
    page: number;
    id: string;
}

function isTestCursor(value: unknown): value is TestCursor {
    if (!value || typeof value !== 'object') return false;
    const cursor = value as Partial<TestCursor>;
    return Number.isInteger(cursor.page) && typeof cursor.id === 'string' && cursor.id.length > 0;
}

describe('cursor API contracts', () => {
    it('uses the shared default and maximum page size', () => {
        expect(normalizeCursorLimit(undefined)).toBe(DEFAULT_CURSOR_LIMIT);
        expect(normalizeCursorLimit('')).toBe(DEFAULT_CURSOR_LIMIT);
        expect(normalizeCursorLimit('25')).toBe(25);
        expect(normalizeCursorLimit(1_000)).toBe(MAX_CURSOR_LIMIT);
    });

    it.each(['0', '-1', '1.5', 'nope'])("rejects invalid limit %s", (value) => {
        expect(() => normalizeCursorLimit(value)).toThrow(ApiContractError);
    });

    it('round-trips unicode-safe opaque cursors', () => {
        const cursor: TestCursor = { page: 17, id: '문항::17::가' };
        const encoded = encodeCursor(cursor);

        expect(encoded).not.toContain(cursor.id);
        expect(decodeCursor(encoded, isTestCursor)).toEqual(cursor);
    });

    it.each(['not a cursor', 'e30', '%%%%'])("rejects malformed cursor %s", (cursor) => {
        expect(() => decodeCursor(cursor, isTestCursor)).toThrow(ApiContractError);
    });

    it('attaches a traceable request id to contract errors', () => {
        try {
            normalizeCursorLimit('invalid');
        } catch (error) {
            expect(error).toBeInstanceOf(ApiContractError);
            expect((error as ApiContractError).apiError).toMatchObject({
                code: 'INVALID_LIMIT',
                requestId: expect.any(String),
            });
        }
    });
});
