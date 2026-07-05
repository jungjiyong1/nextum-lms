import 'server-only';

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export function createAdminClient() {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
        throw new Error('Missing Supabase admin environment variables for LMS.');
    }

    return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        db: {
            schema: 'lms',
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}
