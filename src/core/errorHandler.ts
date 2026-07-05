/**
 * Central error handler utility
 * Provides consistent error handling across the application
 */

import { toast } from 'sonner';
import { logger } from './logger';

/**
 * Handle API errors with logging and user notification
 */
export function handleApiError(error: unknown, context: string): void {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    logger.error(context, message, error);
    toast.error(`${context} 실패`);
}

/**
 * Wrap an async function with error handling
 */
export async function withErrorHandling<T>(
    fn: () => Promise<T>,
    context: string
): Promise<T | null> {
    try {
        return await fn();
    } catch (error) {
        handleApiError(error, context);
        return null;
    }
}

/**
 * Type guard for Error objects
 */
export function isError(value: unknown): value is Error {
    return value instanceof Error;
}
