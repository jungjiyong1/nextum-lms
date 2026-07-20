import { randomUUID } from 'node:crypto';

import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import {
    assertSuperAdmin,
    loadProblemBankGrantOverview,
    setProblemBankGrant,
    WorksheetInputError,
} from '@/lib/lms/worksheet-mutations';

function noStoreJson(body: unknown, init?: ResponseInit) {
    return Response.json(body, {
        ...init,
        headers: {
            'Cache-Control': 'no-store',
            ...init?.headers,
        },
    });
}

export async function GET() {
    try {
        await assertSuperAdmin();
        const data = await loadProblemBankGrantOverview();
        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Problem Bank Grants] Failed:', error);
        return noStoreJson(
            { success: false, error: 'Problem bank grant loading failed.' },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const actor = await assertSuperAdmin();
        const body = await request.json() as { academyId?: string; action?: string; note?: string };
        if (!body.academyId || (body.action !== 'grant' && body.action !== 'revoke')) {
            return mutationError(
                'INVALID_PROBLEM_BANK_GRANT_REQUEST',
                'Invalid problem bank grant request.',
                { request },
            );
        }

        const result = await setProblemBankGrant(actor, {
            academyId: body.academyId,
            action: body.action,
            note: body.note,
        });

        return mutationSuccess(result, {
            request,
            invalidation: { eventId: randomUUID(), domains: ['worksheets'] },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof WorksheetInputError) {
            return mutationError('INVALID_PROBLEM_BANK_GRANT', error.message, { request });
        }

        console.error('[LMS Problem Bank Grant Update] Failed:', error);
        return mutationException(error, 'PROBLEM_BANK_GRANT_FAILED', 'Problem bank grant update failed.', { request });
    }
}
