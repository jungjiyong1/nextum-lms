import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Missing Supabase environment variables for LMS.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    db: {
        schema: 'lms',
    },
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        storage: {
            getItem: (key: string): string | null => {
                if (typeof window !== 'undefined') {
                    return window.localStorage.getItem(key);
                }
                return null;
            },
            setItem: (key: string, value: string): void => {
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem(key, value);
                }
            },
            removeItem: (key: string): void => {
                if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(key);
                }
            },
        },
    },
});

export type AppSchema =
    | 'core'
    | 'lms'
    | 'content'
    | 'learning'
    | 'ai'
    | 'data'
    | 'reporting'
    | 'audit';

export const db = {
    core: supabase.schema('core'),
    lms: supabase.schema('lms'),
    content: supabase.schema('content'),
    learning: supabase.schema('learning'),
    ai: supabase.schema('ai'),
    data: supabase.schema('data'),
    reporting: supabase.schema('reporting'),
    audit: supabase.schema('audit'),
} satisfies Record<AppSchema, ReturnType<typeof supabase.schema>>;

export const coreDb = db.core;
export const lmsDb = db.lms;
export const contentDb = db.content;
export const learningDb = db.learning;
export const reportingDb = db.reporting;
export const auditDb = db.audit;

export function schemaDb(schema: AppSchema) {
    return db[schema];
}

export type { User, Session } from '@supabase/supabase-js';
