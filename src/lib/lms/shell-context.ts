import 'server-only';

import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { normalizeAppRole } from '@/core/auth/roles';
import type { AppShellContext } from '@/core/auth/profile';

import { LmsAuthError, type LmsRoleContext } from './auth';

type Claims = Record<string, unknown>;

interface AccountRow {
    id: string;
    person_id: string;
    auth_email: string | null;
    created_at: string;
    updated_at: string;
    status: string;
}

interface MemberRow {
    academy_id: string;
    role: string;
}

interface PersonRow {
    full_name: string | null;
    email: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * Loads the authenticated shell once on the server. Feature pages consume this
 * initial context instead of hydrating and then issuing a browser-side identity
 * waterfall before they can render.
 */
export interface AppShellServerContext extends AppShellContext {
    actor: LmsRoleContext;
}

async function loadAppShellContextUncached(): Promise<AppShellServerContext> {
    const serverClient = await createServerClient();
    const { data: claimsData, error: claimsError } = await serverClient.auth.getClaims();
    const claims = claimsData?.claims as Claims | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : null;
    const issuedAt = typeof claims?.iat === 'number'
        ? claims.iat
        : (typeof claims?.iat === 'string' ? Number(claims.iat) : Number.NaN);

    if (claimsError || !userId) {
        throw new LmsAuthError('Authentication is required.', 401);
    }

    const admin = createAdminClient();
    const core = admin.schema('core');
    const { data: rawAccount, error: accountError } = await core
        .from('user_accounts')
        .select('id,person_id,auth_email,created_at,updated_at,status')
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
            .or(`user_account_id.eq.${account.id},person_id.eq.${account.person_id}`)
            .limit(1)
            .maybeSingle(),
        core
            .from('people')
            .select('full_name,email,created_at,updated_at')
            .eq('id', account.person_id)
            .maybeSingle(),
    ]);

    if (memberResult.error) throw memberResult.error;
    if (personResult.error) throw personResult.error;

    const member = memberResult.data as MemberRow | null;
    const person = personResult.data as PersonRow | null;
    if (!member?.academy_id) {
        throw new LmsAuthError('An active academy membership is required.', 403);
    }

    const [academyResult, staffResult] = await Promise.all([
        core
            .from('academies')
            .select('name')
            .eq('id', member.academy_id)
            .eq('status', 'active')
            .maybeSingle(),
        core
            .from('staff_members')
            .select('id')
            .eq('academy_id', member.academy_id)
            .eq('person_id', account.person_id)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle(),
    ]);

    if (academyResult.error) throw academyResult.error;
    if (staffResult.error) throw staffResult.error;

    const academyName = typeof academyResult.data?.name === 'string'
        ? academyResult.data.name
        : 'NEXTUM LMS';
    const staffMemberId = typeof staffResult.data?.id === 'string'
        ? staffResult.data.id
        : null;
    const createdAt = account.created_at ?? person?.created_at ?? new Date(0).toISOString();
    const updatedAt = account.updated_at ?? person?.updated_at ?? createdAt;

    const role = normalizeAppRole(member.role);
    return {
        academyName,
        actor: {
            userId,
            accountId: account.id,
            personId: account.person_id,
            academyId: member.academy_id,
            role,
            authIssuedAt: Number.isFinite(issuedAt) ? issuedAt : null,
        },
        profile: {
            id: userId,
            email: account.auth_email ?? person?.email ?? null,
            full_name: person?.full_name ?? null,
            role,
            current_academy_id: member.academy_id,
            staff_member_id: staffMemberId,
            created_at: createdAt,
            updated_at: updatedAt,
        },
    };
}

export const loadAppShellContext = cache(loadAppShellContextUncached);
