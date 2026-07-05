import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';

export class LmsAuthError extends Error {
    constructor(
        message: string,
        public readonly status: 401 | 403 = 403,
    ) {
        super(message);
        this.name = 'LmsAuthError';
    }
}

export interface LmsAdminContext {
    userId: string;
    academyId: number;
    role: 'admin' | 'owner';
}

function normalizeAcademyId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function isAdminRole(value: unknown): value is 'admin' | 'owner' {
    return value === 'admin' || value === 'owner';
}

export async function assertLmsAdmin(): Promise<LmsAdminContext> {
    const serverClient = await createServerClient();
    const { data, error } = await serverClient.auth.getClaims();
    const userId = data?.claims?.sub;

    if (error || !userId) {
        throw new LmsAuthError('Authentication is required.', 401);
    }

    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('role, current_academy_id')
        .eq('id', userId)
        .maybeSingle();

    if (profileError) {
        throw profileError;
    }

    const profileAcademyId = normalizeAcademyId(profile?.current_academy_id);
    if (profile?.role === 'admin' && profileAcademyId) {
        return {
            userId,
            academyId: profileAcademyId,
            role: 'admin',
        };
    }

    const { data: member, error: memberError } = await admin
        .from('academy_members')
        .select('academy_id, role, active')
        .eq('user_id', userId)
        .eq('active', true)
        .in('role', ['owner', 'admin'])
        .limit(1)
        .maybeSingle();

    if (memberError) {
        throw memberError;
    }

    const memberAcademyId = normalizeAcademyId(member?.academy_id);
    if (memberAcademyId && isAdminRole(member?.role)) {
        return {
            userId,
            academyId: memberAcademyId,
            role: member.role,
        };
    }

    throw new LmsAuthError('LMS admin permission is required.', 403);
}

export function authErrorResponse(error: unknown): Response | null {
    if (!(error instanceof LmsAuthError)) return null;

    return Response.json(
        { success: false, error: error.message },
        { status: error.status },
    );
}
