/**
 * Environment-aware logger utility
 * - debug/info: Only outputs in development mode
 * - warn/error: Always outputs
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
    /**
     * Debug logs - only in development
     */
    debug: (tag: string, message: string, ...args: unknown[]) => {
        if (isDev) console.log(`[${tag}] ${message}`, ...args);
    },

    /**
     * Info logs - only in development
     */
    info: (tag: string, message: string, ...args: unknown[]) => {
        if (isDev) console.info(`[${tag}] ${message}`, ...args);
    },

    /**
     * Warning logs - always outputs
     */
    warn: (tag: string, message: string, ...args: unknown[]) => {
        console.warn(`[${tag}] ${message}`, ...args);
    },

    /**
     * Error logs - always outputs
     */
    error: (tag: string, message: string, ...args: unknown[]) => {
        console.error(`[${tag}] ${message}`, ...args);
    },
};

export default logger;
