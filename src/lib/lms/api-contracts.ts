export const DEFAULT_CURSOR_LIMIT = 50;
export const MAX_CURSOR_LIMIT = 100;

const MAX_CURSOR_LENGTH = 4096;

export interface CursorPage<T> {
    items: T[];
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number | null;
}

export interface ApiError {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
}

export interface InvalidationMetadata {
    eventId: string;
    domains: string[];
}

export type ApiResult<T> =
    | { success: true; data: T }
    | { success: false; error: ApiError };

export type MutationResult<T = null> =
    | { success: true; data: T; invalidation?: InvalidationMetadata }
    | { success: false; error: ApiError };

export class ApiContractError extends Error {
    readonly apiError: ApiError;

    constructor(apiError: Omit<ApiError, 'requestId'> & { requestId?: string }) {
        const normalizedError: ApiError = {
            ...apiError,
            requestId: apiError.requestId || crypto.randomUUID(),
        };
        super(normalizedError.message);
        this.name = 'ApiContractError';
        this.apiError = normalizedError;
    }
}

function invalidCursor(): never {
    throw new ApiContractError({
        code: 'INVALID_CURSOR',
        message: 'The cursor is invalid or has expired.',
    });
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeCursorLimit(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return DEFAULT_CURSOR_LIMIT;

    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new ApiContractError({
            code: 'INVALID_LIMIT',
            message: 'limit must be a positive integer.',
        });
    }
    return Math.min(parsed, MAX_CURSOR_LIMIT);
}

export function encodeCursor<T extends object>(payload: T): string {
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeCursor<T>(
    cursor: string | null | undefined,
    validator: (value: unknown) => value is T,
): T | null {
    if (!cursor) return null;
    if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(cursor)) invalidCursor();

    try {
        const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(cursor))) as unknown;
        if (!validator(decoded)) invalidCursor();
        return decoded;
    } catch (error) {
        if (error instanceof ApiContractError) throw error;
        return invalidCursor();
    }
}

export function errorResult(error: ApiError): ApiResult<never> {
    return { success: false, error };
}
