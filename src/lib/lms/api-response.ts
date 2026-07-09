import { randomUUID } from 'node:crypto';
import type { ApiError, InvalidationMetadata } from './api-contracts';

interface BaseApiResponseOptions {
    request?: Request;
    requestId?: string;
    status?: number;
    headers?: HeadersInit;
}

export interface MutationSuccessOptions extends BaseApiResponseOptions {
    invalidation?: InvalidationMetadata;
    aliases?: Record<string, unknown>;
}

export interface MutationErrorOptions extends BaseApiResponseOptions {
    fieldErrors?: Record<string, string[]>;
}

export function apiRequestId(options: Pick<BaseApiResponseOptions, 'request' | 'requestId'> = {}): string {
    const provided = options.requestId || options.request?.headers.get('x-request-id') || '';
    const normalized = provided.trim();
    return /^[A-Za-z0-9._:-]{1,128}$/.test(normalized) ? normalized : randomUUID();
}

function apiHeaders(requestId: string, headers?: HeadersInit): Headers {
    const result = new Headers(headers);
    result.set('Cache-Control', 'no-store');
    result.set('X-Request-Id', requestId);
    return result;
}

export function mutationSuccess<T>(data: T, options: MutationSuccessOptions = {}): Response {
    const requestId = apiRequestId(options);
    const body: Record<string, unknown> = {
        ...(options.aliases || {}),
        success: true,
        data,
    };
    if (options.invalidation) body.invalidation = options.invalidation;
    return Response.json(body, {
        status: options.status ?? 200,
        headers: apiHeaders(requestId, options.headers),
    });
}

export function mutationError(code: string, message: string, options: MutationErrorOptions = {}): Response {
    const requestId = apiRequestId(options);
    const error: ApiError = {
        code,
        message,
        requestId,
        ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    };
    return Response.json({ success: false, error }, {
        status: options.status ?? 400,
        headers: apiHeaders(requestId, options.headers),
    });
}

export function mutationException(
    _error: unknown,
    code: string,
    fallbackMessage: string,
    options: MutationErrorOptions = {},
): Response {
    // Routes log the original exception server-side. Database, storage, and
    // provider messages must not become a public API contract.
    return mutationError(code, fallbackMessage, { ...options, status: options.status ?? 500 });
}
