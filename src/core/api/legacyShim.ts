'use client';

import { supabaseApi } from './index';

if (typeof window !== 'undefined') {
    window.api = supabaseApi;
}
