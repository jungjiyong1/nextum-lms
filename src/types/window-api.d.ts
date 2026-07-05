import type { supabaseApi } from '../core/api';

declare global {
    interface Window {
        api: typeof supabaseApi;
    }
}

export {};
