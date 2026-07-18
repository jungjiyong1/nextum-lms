import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';

import type { AppShellContext } from '@/core/auth/profile';
import { createAdminClient } from '@/lib/supabase/admin';

import { loadAcademyAccessContext } from './academy-access';
import {
    academySelectionRequired,
    findSelectedAcademy,
    LMS_ACADEMY_COOKIE,
} from './academy-selection';
import { LmsAuthError, type LmsRoleContext } from './auth';

export class AcademySelectionRequiredError extends LmsAuthError {
    constructor() {
        super('Academy selection is required.', 403);
        this.name = 'AcademySelectionRequiredError';
    }
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
    const access = await loadAcademyAccessContext();
    const cookieStore = await cookies();
    const selectedAcademyId = cookieStore.get(LMS_ACADEMY_COOKIE)?.value;

    if (academySelectionRequired(access.academies, selectedAcademyId)) {
        throw new AcademySelectionRequiredError();
    }

    const academy = findSelectedAcademy(access.academies, selectedAcademyId)
        ?? access.academies[0];
    if (!academy) {
        throw new LmsAuthError('An active academy membership is required.', 403);
    }

    const { account, person } = access;
    const admin = createAdminClient();
    const { data: staffMember, error: staffError } = await admin
        .schema('core')
        .from('staff_members')
        .select('id')
        .eq('academy_id', academy.id)
        .eq('person_id', account.person_id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

    if (staffError) throw staffError;

    const staffMemberId = typeof staffMember?.id === 'string'
        ? staffMember.id
        : null;
    const createdAt = account.created_at ?? person?.created_at ?? new Date(0).toISOString();
    const updatedAt = account.updated_at ?? person?.updated_at ?? createdAt;

    return {
        academyName: academy.name,
        academyCount: access.academies.length,
        actor: {
            userId: access.userId,
            accountId: account.id,
            personId: account.person_id,
            academyId: academy.id,
            role: academy.role,
            authIssuedAt: access.authIssuedAt,
        },
        profile: {
            id: access.userId,
            email: account.auth_email ?? person?.email ?? null,
            full_name: person?.full_name ?? null,
            role: academy.role,
            current_academy_id: academy.id,
            staff_member_id: staffMemberId,
            created_at: createdAt,
            updated_at: updatedAt,
        },
    };
}

export const loadAppShellContext = cache(loadAppShellContextUncached);
