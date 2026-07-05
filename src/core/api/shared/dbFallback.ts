type SupabaseErrorLike = {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
};

const FALLBACK_ERROR_CODES = new Set([
    '42P01', // undefined_table
    '42703', // undefined_column
    '42501', // insufficient_privilege during staged RLS rollout
    'PGRST106', // schema not exposed
    'PGRST116', // no rows for single()
    'PGRST200', // relationship not found
    'PGRST201',
    'PGRST202',
    'PGRST204',
    'PGRST205', // table/view not in schema cache
]);

const FALLBACK_MESSAGE_PATTERNS = [
    'does not exist',
    'not found',
    'not in the schema cache',
    'schema must be one of',
    'permission denied',
    'could not find',
    'column',
    'relation',
];

export function asSupabaseError(error: unknown): SupabaseErrorLike {
    if (error && typeof error === 'object') {
        return error as SupabaseErrorLike;
    }
    return { message: String(error) };
}

export function shouldFallbackToLegacy(error: unknown): boolean {
    const supabaseError = asSupabaseError(error);
    if (supabaseError.code && FALLBACK_ERROR_CODES.has(supabaseError.code)) {
        return true;
    }

    const combinedMessage = [
        supabaseError.message,
        supabaseError.details,
        supabaseError.hint,
    ].filter(Boolean).join(' ').toLowerCase();

    return FALLBACK_MESSAGE_PATTERNS.some((pattern) => combinedMessage.includes(pattern));
}

export function toError(error: unknown): Error {
    if (error instanceof Error) return error;
    const supabaseError = asSupabaseError(error);
    return new Error(supabaseError.message || String(error));
}

export function firstRecord<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}
