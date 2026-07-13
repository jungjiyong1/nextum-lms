import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assertSameOrigin: vi.fn(),
    assertRole: vi.fn(),
    authErrorResponse: vi.fn<(error: unknown) => Response | null>(() => null),
    matchErrorResponse: vi.fn<(error: unknown, request: Request) => Response | null>(() => null),
    createBatch: vi.fn(),
    loadBatch: vi.fn(),
    loadJob: vi.fn(),
    resolveJob: vi.fn(),
    patchJob: vi.fn(),
    finalizeJob: vi.fn(),
    finalizeBatch: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
    assertSameOrigin: mocks.assertSameOrigin,
    assertLmsRoleForAcademy: mocks.assertRole,
    authErrorResponse: mocks.authErrorResponse,
}));

vi.mock('@/lib/lms/assignment-match', () => ({
    assignmentMatchErrorResponse: mocks.matchErrorResponse,
    createAssignmentMatchBatch: mocks.createBatch,
    loadAssignmentMatchBatch: mocks.loadBatch,
    loadAssignmentMatchJob: mocks.loadJob,
    resolveAssignmentMatchJob: mocks.resolveJob,
    patchAssignmentMatchJob: mocks.patchJob,
    finalizeAssignmentMatchJob: mocks.finalizeJob,
    finalizeAssignmentMatchBatch: mocks.finalizeBatch,
}));

import { POST as createBatchRoute } from './assignment-match-batches/route';
import { GET as loadBatchRoute } from './assignment-match-batches/[batchId]/route';
import { POST as finalizeBatchRoute } from './assignment-match-batches/[batchId]/finalize/route';
import { GET as loadJobRoute, PATCH as patchJobRoute } from './assignment-match-jobs/[jobId]/route';
import { POST as resolveJobRoute } from './assignment-match-jobs/[jobId]/resolve/route';
import { POST as finalizeJobRoute } from './assignment-match-jobs/[jobId]/finalize/route';

const ACADEMY_ID = '00000000-0000-4000-8000-000000000001';
const actor = { academyId: ACADEMY_ID, userId: 'u', accountId: 'a', personId: 'p', role: 'admin' };

function postRequest(path: string, body: Record<string, unknown>, method = 'POST'): Request {
    return new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('PDF assignment match API routes', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.assertRole.mockResolvedValue(actor);
        mocks.authErrorResponse.mockReturnValue(null);
        mocks.matchErrorResponse.mockReturnValue(null);
        mocks.createBatch.mockResolvedValue({ batch: { id: 'batch-1', jobs: [] }, uploads: [] });
        mocks.loadBatch.mockResolvedValue({ id: 'batch-1', mode: 'single', status: 'draft', jobs: [] });
        mocks.loadJob.mockResolvedValue({ id: 'job-1', batchId: 'batch-1', items: [] });
        mocks.resolveJob.mockResolvedValue({ id: 'job-1', revision: 2 });
        mocks.patchJob.mockResolvedValue({ id: 'job-1', revision: 3 });
        mocks.finalizeJob.mockResolvedValue({
            jobId: 'job-1', assignmentId: 'assignment-1', revision: 3,
            itemCount: 2, recipientCount: 1, mutationId: 'mutation-1',
        });
        mocks.finalizeBatch.mockResolvedValue({ batchId: 'batch-1', succeeded: [], failed: [] });
    });

    it('creates a staff-scoped batch', async () => {
        const body = {
            academyId: ACADEMY_ID,
            mode: 'single',
            clientRequestId: 'request-1',
            jobs: [{ fileName: 'student.pdf', fileSize: 100, title: '과제' }],
        };
        const response = await createBatchRoute(postRequest('/api/lms/assignment-match-batches', body));
        expect(response.status).toBe(200);
        expect(mocks.assertSameOrigin).toHaveBeenCalled();
        expect(mocks.assertRole).toHaveBeenCalledWith(ACADEMY_ID, ['owner', 'admin', 'staff', 'teacher', 'instructor']);
        expect(mocks.createBatch).toHaveBeenCalledWith(actor, expect.objectContaining({ clientRequestId: 'request-1' }));
    });

    it('loads only through the academy authorization boundary', async () => {
        const request = new Request(`http://localhost/api/lms/assignment-match-batches/batch-1?academyId=${ACADEMY_ID}`);
        const response = await loadBatchRoute(request, { params: Promise.resolve({ batchId: 'batch-1' }) });
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(mocks.loadBatch).toHaveBeenCalledWith(actor, 'batch-1');
    });

    it('loads one review job lazily through the same academy authorization boundary', async () => {
        const request = new Request(`http://localhost/api/lms/assignment-match-jobs/job-1?academyId=${ACADEMY_ID}`);
        const response = await loadJobRoute(request, { params: Promise.resolve({ jobId: 'job-1' }) });
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(mocks.loadJob).toHaveBeenCalledWith(actor, 'job-1');
    });

    it('resolves ordered codes and patches a revision through distinct methods', async () => {
        const resolveBody = { academyId: ACADEMY_ID, revision: 1, pageCount: 1, codes: [{ externalCode: '1234567', page: 1 }] };
        const resolveResponse = await resolveJobRoute(
            postRequest('/api/lms/assignment-match-jobs/job-1/resolve', resolveBody),
            { params: Promise.resolve({ jobId: 'job-1' }) },
        );
        const patchBody = { academyId: ACADEMY_ID, revision: 2, title: '수정 과제' };
        const patchResponse = await patchJobRoute(
            postRequest('/api/lms/assignment-match-jobs/job-1', patchBody, 'PATCH'),
            { params: Promise.resolve({ jobId: 'job-1' }) },
        );
        expect(resolveResponse.status).toBe(200);
        expect(patchResponse.status).toBe(200);
        expect(mocks.resolveJob).toHaveBeenCalledWith(actor, 'job-1', expect.objectContaining({ revision: 1 }));
        expect(mocks.patchJob).toHaveBeenCalledWith(actor, 'job-1', expect.objectContaining({ revision: 2 }));
    });

    it('finalizes one job and emits assignment invalidation', async () => {
        const response = await finalizeJobRoute(
            postRequest('/api/lms/assignment-match-jobs/job-1/finalize', {
                academyId: ACADEMY_ID,
                revision: 2,
                idempotencyKey: 'finalize-1',
            }),
            { params: Promise.resolve({ jobId: 'job-1' }) },
        );
        const body = await response.json();
        expect(body.invalidation).toEqual({ eventId: 'mutation-1', domains: ['assignments'] });
        expect(mocks.finalizeJob).toHaveBeenCalledWith(actor, 'job-1', expect.objectContaining({ idempotencyKey: 'finalize-1' }));
    });

    it('finalizes a batch while preserving per-job partial results', async () => {
        const response = await finalizeBatchRoute(
            postRequest('/api/lms/assignment-match-batches/batch-1/finalize', {
                academyId: ACADEMY_ID,
                idempotencyKey: 'batch-finalize-1',
            }),
            { params: Promise.resolve({ batchId: 'batch-1' }) },
        );
        expect(response.status).toBe(200);
        expect(mocks.finalizeBatch).toHaveBeenCalledWith(actor, 'batch-1', expect.objectContaining({ idempotencyKey: 'batch-finalize-1' }));
    });

    it('rejects a missing academy before authorization', async () => {
        const response = await createBatchRoute(postRequest('/api/lms/assignment-match-batches', {
            mode: 'single', clientRequestId: 'r', jobs: [],
        }));
        expect(response.status).toBe(400);
        expect(mocks.assertRole).not.toHaveBeenCalled();
    });
});
