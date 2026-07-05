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
    academyId: string;
    role: 'admin' | 'owner';
    authIssuedAt: number | null;
}

export type LmsRole = 'owner' | 'admin' | 'staff' | 'teacher' | 'instructor' | 'student' | 'guardian';

export interface LmsRoleContext {
    userId: string;
    accountId: string;
    personId: string;
    academyId: string;
    role: LmsRole;
    authIssuedAt: number | null;
}

type Row = Record<string, any>;

function isAdminRole(value: unknown): value is 'admin' | 'owner' {
    return value === 'admin' || value === 'owner';
}

function isLmsRole(value: unknown): value is LmsRole {
    return value === 'owner'
        || value === 'admin'
        || value === 'staff'
        || value === 'teacher'
        || value === 'instructor'
        || value === 'student'
        || value === 'guardian';
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
    const core = admin.schema('core');

    const { data: account, error: accountError } = await core
        .from('user_accounts')
        .select('id,person_id,status')
        .eq('auth_user_id', userId)
        .maybeSingle();

    if (accountError) throw accountError;
    if (!account || account.status !== 'active') {
        throw new LmsAuthError('Active LMS account is required.', 403);
    }

    const accountRow = account as Row;
    const { data: member, error: memberError } = await core
        .from('academy_members')
        .select('academy_id,role,active')
        .eq('user_account_id', accountRow.id)
        .eq('active', true)
        .in('role', ['owner', 'admin'])
        .limit(1)
        .maybeSingle();

    if (memberError) throw memberError;
    if (member?.academy_id && isAdminRole(member.role)) {
        return {
            userId,
            academyId: member.academy_id,
            role: member.role,
            authIssuedAt: getNumberClaim(claims, 'iat'),
        };
    }

    const { data: personMember, error: personMemberError } = await core
        .from('academy_members')
        .select('academy_id,role,active')
        .eq('person_id', accountRow.person_id)
        .eq('active', true)
        .in('role', ['owner', 'admin'])
        .limit(1)
        .maybeSingle();

    if (personMemberError) throw personMemberError;
    if (personMember?.academy_id && isAdminRole(personMember.role)) {
        return {
            userId,
            academyId: personMember.academy_id,
            role: personMember.role,
            authIssuedAt: getNumberClaim(claims, 'iat'),
        };
    }

    throw new LmsAuthError('LMS admin permission is required.', 403);
}

export async function assertLmsRoleForAcademy(
    academyId: string,
    allowedRoles: readonly LmsRole[],
): Promise<LmsRoleContext> {
    const serverClient = await createServerClient();
    const { data, error } = await serverClient.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : null;

    if (error || !userId) {
        throw new LmsAuthError('Authentication is required.', 401);
    }

    const admin = createAdminClient();
    const core = admin.schema('core');
    const { data: account, error: accountError } = await core
        .from('user_accounts')
        .select('id,person_id,status')
        .eq('auth_user_id', userId)
        .maybeSingle();

    if (accountError) throw accountError;
    const accountRow = account as Row | null;
    if (!accountRow || accountRow.status !== 'active') {
        throw new LmsAuthError('Active LMS account is required.', 403);
    }

    const { data: member, error: memberError } = await core
        .from('academy_members')
        .select('academy_id,role,active')
        .eq('academy_id', academyId)
        .eq('active', true)
        .or(`user_account_id.eq.${accountRow.id},person_id.eq.${accountRow.person_id}`)
        .in('role', [...allowedRoles])
        .limit(1)
        .maybeSingle();

    if (memberError) throw memberError;
    if (!member?.academy_id || !isLmsRole(member.role)) {
        throw new LmsAuthError('LMS permission is required for this academy.', 403);
    }

    return {
        userId,
        accountId: accountRow.id,
        personId: accountRow.person_id,
        academyId: member.academy_id,
        role: member.role,
        authIssuedAt: getNumberClaim(claims, 'iat'),
    };
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
