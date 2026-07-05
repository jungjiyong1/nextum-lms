/**
 * Result Pattern Helper Utilities
 * 
 * Provides utilities for working with the Result type pattern.
 * All API functions return Result<T> to enforce error handling.
 */

import type { Result } from './types';

/**
 * Create a success result.
 */
export function ok<T>(data: T): Result<T, never> {
    return { success: true, data };
}

/**
 * Create an error result.
 */
export function err<E = Error>(error: E): Result<never, E> {
    return { success: false, error };
}

/**
 * Create an error result from a message string.
 */
export function errMsg(message: string): Result<never, Error> {
    return { success: false, error: new Error(message) };
}

/**
 * Wrap an async function to return a Result.
 * Catches any thrown errors and converts them to Result.error.
 */
export async function wrapAsync<T>(
    fn: () => Promise<T>,
    context?: string
): Promise<Result<T, Error>> {
    try {
        const data = await fn();
        return ok(data);
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (context) {
            err.message = `[${context}] ${err.message}`;
        }
        return { success: false, error: err };
    }
}

/**
 * Unwrap a Result, throwing if it's an error.
 * Use sparingly - prefer pattern matching.
 */
export function unwrap<T>(result: Result<T>): T {
    if (result.success) {
        return result.data;
    }
    throw result.error;
}

/**
 * Unwrap a Result with a default value for errors.
 */
export function unwrapOr<T>(result: Result<T>, defaultValue: T): T {
    if (result.success) {
        return result.data;
    }
    return defaultValue;
}

/**
 * Map the data of a successful Result.
 */
export function mapResult<T, U>(
    result: Result<T>,
    fn: (data: T) => U
): Result<U> {
    if (result.success) {
        return ok(fn(result.data));
    }
    return result;
}
