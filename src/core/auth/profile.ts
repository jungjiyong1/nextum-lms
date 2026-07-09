import type { AppRole } from './roles';

export interface AppProfile {
    id: string;
    email: string | null;
    full_name: string | null;
    role: AppRole;
    current_academy_id: string | null;
    staff_member_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface AppShellContext {
    profile: AppProfile;
    academyName: string;
}
