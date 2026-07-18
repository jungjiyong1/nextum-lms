import 'server-only';

import { cache } from 'react';

import { normalizeAppRole, type AppRole } from '@/core/auth/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';

import type { AccessibleAcademy } from './academy-selection';
import { LmsAuthError } from './auth';

type Claims = Record<string, unknown>;

interface AccountRow {
    id: string;
    person_id: string;
    auth_email: string | null;
    login_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
    status: string;
}

interface AcademyRow {
    id: string;
    name: string;
}

interface MemberRow {
    academy_id: string;
    role: string;
}

export interface AcademyAccessContext {
    userId: string;
    authIssuedAt: number | null;
    account: AccountRow;
    person: {
        full_name: string | null;
        email: string | null;
        created_at: string;
        updated_at: string;
    } | null;
    academies: AccessibleAcademy[];
    isSuperAdmin: boolean;
}

const ROLE_PRIORITY: Record<AppRole, number> = {
    owner: 0,
    admin: 1,
    staff: 2,
    teacher: 3,
    instructor: 4,
    student: 5,
    guardian: 6,
};

function highestRole(current: AppRole | undefined, candidate: AppRole): AppRole {
    if (!current) return candidate;
    return ROLE_PRIORITY[candidate] < ROLE_PRIORITY[current] ? candidate : current;
}

function numberClaim(claims: Claims | undefined, key: string): number | null {
    const value = claims?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

async function loadAcademyAccessContextUncached(): Promise<AcademyAccessContext> {
    const serverClient = await createServerClient();
    const { data: claimsData, error: claimsError } = await serverClient.auth.getClaims();
    const claims = claimsData?.claims as Claims | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : null;

    if (claimsError || !userId) {
        throw new LmsAuthError('Authentication is required.', 401);
    }

    const admin = createAdminClient();
    const core = admin.schema('core');
    const { data: rawAccount, error: accountError } = await core
        .from('user_accounts')
        .select('id,person_id,auth_email,login_id,metadata,created_at,updated_at,status')
        .eq('auth_user_id', userId)
        .maybeSingle();

    if (accountError) throw accountError;
    const account = rawAccount as AccountRow | null;
    if (!account || account.status !== 'active') {
        throw new LmsAuthError('Active LMS account is required.', 403);
    }

    const [memberResult, personResult] = await Promise.all([
        core
            .from('academy_members')
            .select('academy_id,role')
            .eq('active', true)
            .or(`user_account_id.eq.${account.id},person_id.eq.${account.person_id}`),
        core
            .from('people')
            .select('full_name,email,created_at,updated_at')
            .eq('id', account.person_id)
            .maybeSingle(),
    ]);

    if (memberResult.error) throw memberResult.error;
    if (personResult.error) throw personResult.error;

    const isSuperAdmin = account.metadata?.super_admin === true;
    const members = (memberResult.data ?? []) as MemberRow[];
    const rolesByAcademy = new Map<string, AppRole>();
    for (const member of members) {
        const role = normalizeAppRole(member.role);
        rolesByAcademy.set(member.academy_id, highestRole(rolesByAcademy.get(member.academy_id), role));
    }

    const academyQuery = core
        .from('academies')
        .select('id,name')
        .eq('status', 'active')
        .order('name', { ascending: true });
    const { data: rawAcademies, error: academyError } = isSuperAdmin
        ? await academyQuery
        : rolesByAcademy.size > 0
            ? await academyQuery.in('id', [...rolesByAcademy.keys()])
            : { data: [], error: null };

    if (academyError) throw academyError;

    const academies = ((rawAcademies ?? []) as AcademyRow[]).map((academy) => ({
        id: academy.id,
        name: academy.name,
        role: isSuperAdmin ? 'admin' : (rolesByAcademy.get(academy.id) ?? 'student'),
    } satisfies AccessibleAcademy));

    if (academies.length === 0) {
        throw new LmsAuthError('An active academy membership is required.', 403);
    }

    return {
        userId,
        authIssuedAt: numberClaim(claims, 'iat'),
        account,
        person: personResult.data as AcademyAccessContext['person'],
        academies,
        isSuperAdmin,
    };
}

export const loadAcademyAccessContext = cache(loadAcademyAccessContextUncached);
