import { randomUUID } from 'node:crypto';

import type { CreateWorksheetDraftInput } from '@/features/lms/worksheet-types';
import { mutationError, mutationException, mutationSuccess } from '@/lib/lms/api-response';
import { assertLmsRoleForAcademy, assertSameOrigin, authErrorResponse } from '@/lib/lms/auth';
import { assertCsrfToken } from '@/lib/lms/csrf-server';
import { createWorksheetDraft, WorksheetInputError } from '@/lib/lms/worksheet-mutations';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        assertCsrfToken(request);
        const body = await request.json() as Partial<CreateWorksheetDraftInput>;
        if (
            !body.academyId || !body.studentId || !body.seed || !body.asOf ||
            !Array.isArray(body.selections)
        ) {
            return mutationError(
                'INVALID_WORKSHEET_DRAFT_REQUEST',
                'Invalid worksheet draft request.',
                { request },
            );
        }

        const actor = await assertLmsRoleForAcademy(body.academyId, [
            'owner', 'admin', 'staff', 'teacher', 'instructor',
        ]);
        const result = await createWorksheetDraft(actor, {
            academyId: body.academyId,
            studentId: body.studentId,
            asOf: body.asOf,
            seed: body.seed,
            selections: body.selections,
        });

        return mutationSuccess(result, {
            request,
            invalidation: { eventId: randomUUID(), domains: ['worksheets'] },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof WorksheetInputError) {
            return mutationError('INVALID_WORKSHEET_DRAFT', error.message, { request });
        }

        console.error('[LMS Worksheet Draft] Failed:', error);
        return mutationException(error, 'WORKSHEET_DRAFT_FAILED', 'Worksheet draft creation failed.', { request });
    }
}
