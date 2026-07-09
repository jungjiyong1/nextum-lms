import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContractError } from '@/lib/lms/api-contracts';

const { assertRole, loadCatalog } = vi.hoisted(() => ({
    assertRole: vi.fn(),
    loadCatalog: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
    assertLmsRoleForAcademy: assertRole,
    authErrorResponse: vi.fn(() => null),
}));

vi.mock('@/lib/lms/problem-catalog', () => ({
    loadProblemCatalogPage: loadCatalog,
}));

import { GET } from './route';

describe('assignment catalog route', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        assertRole.mockResolvedValue({ academyId: 'academy-1', role: 'teacher' });
    });

    it('returns a request id and the cursor page', async () => {
        const page = {
            items: [],
            nextCursor: null,
            hasMore: false,
            totalCount: 0,
        };
        loadCatalog.mockResolvedValue(page);

        const response = await GET(new Request(
            'http://localhost/api/lms/assignments/catalog?academyId=academy-1&bookId=book-1',
            { headers: { 'X-Request-Id': 'request-123' } },
        ));

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Request-Id')).toBe('request-123');
        await expect(response.json()).resolves.toEqual({ success: true, data: page });
    });

    it('uses the standard error contract for invalid input', async () => {
        const response = await GET(new Request(
            'http://localhost/api/lms/assignments/catalog?academyId=academy-1',
            { headers: { 'X-Request-Id': 'request-456' } },
        ));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: {
                code: 'INVALID_REQUEST',
                message: 'academyId and bookId are required.',
                requestId: 'request-456',
            },
        });
        expect(assertRole).not.toHaveBeenCalled();
    });

    it('maps catalog contract failures to the standard error response', async () => {
        loadCatalog.mockRejectedValue(new ApiContractError({
            code: 'CATALOG_NOT_FOUND',
            message: 'Catalog is unavailable.',
        }));

        const response = await GET(new Request(
            'http://localhost/api/lms/assignments/catalog?academyId=academy-1&bookId=missing',
            { headers: { 'X-Request-Id': 'request-404' } },
        ));

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: {
                code: 'CATALOG_NOT_FOUND',
                message: 'Catalog is unavailable.',
                requestId: 'request-404',
            },
        });
    });

    it('returns a traceable 500 response for unexpected failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        loadCatalog.mockRejectedValue(new Error('database unavailable'));

        const response = await GET(new Request(
            'http://localhost/api/lms/assignments/catalog?academyId=academy-1&bookId=book-1',
            { headers: { 'X-Request-Id': 'request-500' } },
        ));

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: {
                code: 'CATALOG_LOAD_FAILED',
                message: 'database unavailable',
                requestId: 'request-500',
            },
        });
        expect(consoleError).toHaveBeenCalledOnce();
        consoleError.mockRestore();
    });
});
