import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningAnalysisValidationError } from '@/lib/lms/learning-analysis-mapper';

const { assertRole, assertOrigin, loadAnalysis, createPlan } = vi.hoisted(() => ({
    assertRole: vi.fn(),
    assertOrigin: vi.fn(),
    loadAnalysis: vi.fn(),
    createPlan: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
    assertLmsRoleForAcademy: assertRole,
    assertSameOrigin: assertOrigin,
    authErrorResponse: vi.fn(() => null),
}));

vi.mock('@/lib/lms/learning-analysis-service', () => ({
    loadLearningAnalysisData: loadAnalysis,
    createLearningAnalysisPlan: createPlan,
}));

import { GET, POST } from './route';

const ACADEMY_ID = '00000000-0000-4000-8000-000000000001';
const PLAN_ID = '00000000-0000-4000-8000-000000000002';

describe('learning analysis route', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        assertRole.mockResolvedValue({
            academyId: ACADEMY_ID,
            userId: '00000000-0000-4000-8000-000000000003',
            role: 'teacher',
        });
    });

    it('loads an accessible exam plan with no-store semantics', async () => {
        const data = { catalog: {}, tracks: [], actionQueue: [], examPlans: [], examStudents: [] };
        loadAnalysis.mockResolvedValue(data);

        const response = await GET(new Request(
            `http://localhost/api/lms/learning-analysis?academyId=${ACADEMY_ID}&planId=${PLAN_ID}`,
        ));

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({ success: true, data });
        expect(loadAnalysis).toHaveBeenCalledWith(expect.objectContaining({ academyId: ACADEMY_ID }), PLAN_ID);
    });

    it('rejects malformed identifiers before authorization', async () => {
        const response = await GET(new Request(
            'http://localhost/api/lms/learning-analysis?academyId=not-a-uuid',
        ));

        expect(response.status).toBe(400);
        expect(assertRole).not.toHaveBeenCalled();
        expect(loadAnalysis).not.toHaveBeenCalled();
    });

    it('creates a plan through the authenticated mutation contract', async () => {
        createPlan.mockResolvedValue({ planId: PLAN_ID });
        const response = await POST(new Request(
            'http://localhost/api/lms/learning-analysis',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'learning-plan-1' },
                body: JSON.stringify({ academyId: ACADEMY_ID, input: { kind: 'maintenance' } }),
            },
        ));

        expect(assertOrigin).toHaveBeenCalledOnce();
        expect(createPlan).toHaveBeenCalledWith(
            expect.objectContaining({ academyId: ACADEMY_ID }),
            { kind: 'maintenance' },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Request-Id')).toBe('learning-plan-1');
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            data: { planId: PLAN_ID },
            plan: { planId: PLAN_ID },
            invalidation: { domains: ['learning'] },
        });
    });

    it('returns field errors for invalid plan input', async () => {
        createPlan.mockRejectedValue(new LearningAnalysisValidationError(
            '범위 유형을 선택해 주세요.',
            { scopeSkillIds: ['하나 이상 선택해 주세요.'] },
        ));
        const response = await POST(new Request(
            'http://localhost/api/lms/learning-analysis',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'learning-plan-2' },
                body: JSON.stringify({ academyId: ACADEMY_ID, input: {} }),
            },
        ));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: {
                code: 'INVALID_LEARNING_PLAN',
                message: '범위 유형을 선택해 주세요.',
                requestId: 'learning-plan-2',
                fieldErrors: { scopeSkillIds: ['하나 이상 선택해 주세요.'] },
            },
        });
    });
});
