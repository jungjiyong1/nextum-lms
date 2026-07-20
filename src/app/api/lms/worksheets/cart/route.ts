import { assertLmsRoleForAcademy, authErrorResponse } from '@/lib/lms/auth';
import { loadWorksheetCart } from '@/lib/lms/worksheet-queries';

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
        const url = new URL(request.url);
        const academyId = url.searchParams.get('academyId') || '';
        const studentId = url.searchParams.get('studentId') || '';
        const asOf = url.searchParams.get('asOf') || undefined;
        const seed = url.searchParams.get('seed') || undefined;

        if (!academyId || !studentId) {
            return noStoreJson(
                { success: false, error: 'Invalid worksheet cart request.' },
                { status: 400 },
            );
        }

        const actor = await assertLmsRoleForAcademy(academyId, [
            'owner', 'admin', 'staff', 'teacher', 'instructor',
        ]);
        const { cart } = await loadWorksheetCart(actor, { studentId, asOf, seed });

        return noStoreJson({ success: true, data: cart });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Worksheet Cart] Failed:', error);
        return noStoreJson(
            { success: false, error: 'Worksheet cart loading failed.' },
            { status: 500 },
        );
    }
}
