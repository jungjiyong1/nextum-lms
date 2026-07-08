import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { createStaffForAcademy, updateStaffForAcademy } from '@/lib/lms/mutations';
import { loadStaffSummariesForAcademy } from '@/lib/lms/staff-queries';
import type { CreateStaffInput, UpdateStaffInput } from '@/features/lms/types';

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
            return noStoreJson({ success: false, error: 'Invalid staff request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(academyId, ['owner', 'admin', 'staff']);
        const staff = await loadStaffSummariesForAcademy(academyId);

        return noStoreJson({ success: true, data: staff });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff] Failed:', error);
        return noStoreJson({
            success: false,
            error: error instanceof Error ? error.message : 'Staff loading failed.',
        }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as { academyId?: string; staffId?: string; input?: CreateStaffInput | UpdateStaffInput };
        if (!body.academyId || !body.input) {
            return Response.json({ success: false, error: 'Invalid staff request.' }, { status: 400 });
        }

        await assertLmsRoleForAcademy(body.academyId, ['owner', 'admin']);
        if (body.staffId) {
            await updateStaffForAcademy(body.academyId, body.staffId, body.input as UpdateStaffInput);
        } else {
            await createStaffForAcademy(body.academyId, body.input as CreateStaffInput);
        }

        return Response.json({ success: true });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Staff] Failed:', error);
        return Response.json({
            success: false,
            error: error instanceof Error ? error.message : 'Staff creation failed.',
        }, { status: 500 });
    }
}
