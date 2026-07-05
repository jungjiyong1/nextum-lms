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
    authIssuedAt: number | null;
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

function getNumberClaim(claims: Record<string, unknown> | undefined, key: string): number | null {
    const value = claims?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

export async function assertLmsAdmin(): Promise<LmsAdminContext> {
    const serverClient = await createServerClient();
    const { data, error } = await serverClient.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : null;

    if (error || !userId) {
        throw new LmsAuthError('Authentication is required.', 401);
    }

    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('current_academy_id')
        .eq('id', userId)
        .maybeSingle();

    if (profileError) {
        throw profileError;
    }

    const profileAcademyId = normalizeAcademyId(profile?.current_academy_id);

    let memberQuery = admin
        .from('academy_members')
        .select('academy_id, role, active')
        .eq('user_id', userId)
        .eq('active', true)
        .in('role', ['owner', 'admin'])
        .limit(1);

    if (profileAcademyId) {
        memberQuery = memberQuery.eq('academy_id', profileAcademyId);
    }

    let { data: member, error: memberError } = await memberQuery
        .maybeSingle();

    if (memberError) {
        throw memberError;
    }

    if (!member && profileAcademyId) {
        const fallback = await admin
            .from('academy_members')
            .select('academy_id, role, active')
            .eq('user_id', userId)
            .eq('active', true)
            .in('role', ['owner', 'admin'])
            .limit(1)
            .maybeSingle();

        if (fallback.error) throw fallback.error;
        member = fallback.data;
    }

    const memberAcademyId = normalizeAcademyId(member?.academy_id);
    if (memberAcademyId && isAdminRole(member?.role)) {
        return {
            userId,
            academyId: memberAcademyId,
            role: member.role,
            authIssuedAt: getNumberClaim(claims, 'iat'),
        };
    }

    throw new LmsAuthError('LMS admin permission is required.', 403);
}

export function assertSameOrigin(request: Request) {
    const origin = request.headers.get('origin');
    if (!origin) return;

    try {
        const requestOrigin = new URL(request.url).origin;
        const suppliedOrigin = new URL(origin).origin;

        if (requestOrigin !== suppliedOrigin) {
            throw new LmsAuthError('Cross-origin admin requests are not allowed.', 403);
        }
    } catch (error) {
        if (error instanceof LmsAuthError) throw error;
        throw new LmsAuthError('Invalid admin request origin.', 403);
    }
}

export function assertRecentAuth(admin: LmsAdminContext, maxAgeSeconds = 300) {
    if (!admin.authIssuedAt) {
        throw new LmsAuthError('Recent authentication is required.', 403);
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - admin.authIssuedAt;
    if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
        throw new LmsAuthError('Recent authentication is required.', 403);
    }
}

export async function assertLmsAdminRequest(
    request: Request,
    options: { requireRecentAuth?: boolean; maxAgeSeconds?: number } = {},
): Promise<LmsAdminContext> {
    assertSameOrigin(request);
    const admin = await assertLmsAdmin();

    if (options.requireRecentAuth) {
        assertRecentAuth(admin, options.maxAgeSeconds);
    }

    return admin;
}

export function authErrorResponse(error: unknown): Response | null {
    if (!(error instanceof LmsAuthError)) return null;

    return Response.json(
        { success: false, error: error.message },
        { status: error.status },
    );
}
