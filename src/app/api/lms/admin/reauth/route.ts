import { createClient } from '@supabase/supabase-js';
import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { setReauthCookie } from '@/lib/lms/reauth';
import { recordAdminAction } from '@/lib/lms/audit';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { shouldUseSecureCookies } from '@/lib/lms/secure-cookie';

function authClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Missing Supabase public environment variables for LMS.');

    return createClient(url, key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json().catch(() => null) as {
            academyId?: unknown;
            password?: unknown;
        } | null;

        const academyId = typeof body?.academyId === 'string' ? body.academyId : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        if (!academyId || !password) {
            return Response.json({ success: false, error: 'Invalid reauthentication request.' }, { status: 400 });
        }

        const adminContext = await assertLmsRoleForAcademy(academyId, ['owner', 'admin']);
        const admin = createAdminClient();
        const { data: userData, error: userError } = await admin.auth.admin.getUserById(adminContext.userId);
        if (userError) throw userError;

        const email = userData.user?.email;
        if (!email) {
            return Response.json({ success: false, error: 'Password confirmation is not available for this account.' }, { status: 403 });
        }

        const { data: verified, error: verifyError } = await authClient().auth.signInWithPassword({ email, password });
        if (verifyError || verified.user?.id !== adminContext.userId) {
            return Response.json({ success: false, error: 'Password confirmation failed.' }, { status: 403 });
        }

        await setReauthCookie(adminContext.userId, academyId, { secure: shouldUseSecureCookies(request) });
        await recordAdminAction({
            academyId,
            actorPersonId: adminContext.personId,
            action: 'lms.admin.reauth',
            target: 'admin_session',
            payload: { method: 'password' },
        });
        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Admin Reauth] Failed:', error);
        return Response.json({ success: false, error: 'Password confirmation failed.' }, { status: 500 });
    }
}
