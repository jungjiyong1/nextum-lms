import { createClient } from '@/lib/supabase/client';

export const supabase = createClient();

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
export const aiDb = db.ai;
export const dataDb = db.data;
export const auditDb = db.audit;

export function schemaDb(schema: AppSchema) {
    return db[schema];
}

export type { User, Session } from '@supabase/supabase-js';
