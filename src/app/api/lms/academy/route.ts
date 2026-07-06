import { authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { createAdminClient } from '@/lib/supabase/admin';

function noStoreJson(body: unknown, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: {
            'Cache-Control': 'no-store',
            ...init?.headers,
        },
    });
}

export async function GET(request: Request) {
    try {
        const academyId = new URL(request.url).searchParams.get('academyId') || '';
        if (!academyId) {
            return noStoreJson({ success: false, error: 'Invalid academy request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff', 'teacher', 'instructor', 'student', 'guardian']);

        const client = createAdminClient();
        const { data, error } = await client
            .schema('core')
            .from('academies')
            .select('name')
            .eq('id', academyId)
            .maybeSingle();

        if (error) throw error;

        return noStoreJson({ success: true, data: data?.name ?? null });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Academy] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Academy loading failed.',
        }, { status: 500 });
    }
}
