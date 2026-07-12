import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningAnalysisValidationError } from '@/lib/lms/learning-analysis-mapper';

const { assertRole, assertOrigin, loadAnalysis, createPlan, startPath, changePathStatus } = vi.hoisted(() => ({
    assertRole: vi.fn(),
    assertOrigin: vi.fn(),
    loadAnalysis: vi.fn(),
    createPlan: vi.fn(),
    startPath: vi.fn(),
    changePathStatus: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
    assertLmsRoleForAcademy: assertRole,
    assertSameOrigin: assertOrigin,
    authErrorResponse: vi.fn(() => null),
}));

vi.mock('@/lib/lms/learning-analysis-service', () => ({
    loadLearningAnalysisData: loadAnalysis,
    createLearningAnalysisPlan: createPlan,
    startLearningAnalysisPath: startPath,
    changeLearningAnalysisPathStatus: changePathStatus,
}));

import { GET, PATCH, POST } from './route';

const ACADEMY_ID = '00000000-0000-4000-8000-000000000001';
const PLAN_ID = '00000000-0000-4000-8000-000000000002';
const CLASS_ID = '00000000-0000-4000-8000-000000000004';

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
        const data = { catalog: {}, paths: [], actionQueue: [], examPlans: [], examStudents: [] };
        loadAnalysis.mockResolvedValue(data);

        const response = await GET(new Request(
            `http://localhost/api/lms/learning-analysis?academyId=${ACADEMY_ID}&planId=${PLAN_ID}`,
        ));

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({ success: true, data });
        expect(loadAnalysis).toHaveBeenCalledWith(expect.objectContaining({ academyId: ACADEMY_ID }), PLAN_ID, null);
    });

    it('rejects malformed identifiers before authorization', async () => {
        const response = await GET(new Request(
            'http://localhost/api/lms/learning-analysis?academyId=not-a-uuid',
        ));

        expect(response.status).toBe(400);
        expect(assertRole).not.toHaveBeenCalled();
        expect(loadAnalysis).not.toHaveBeenCalled();
    });

    it('scopes the integrated learning page to the selected class', async () => {
        loadAnalysis.mockResolvedValue({ catalog: {}, paths: [], actionQueue: [], examPlans: [], examStudents: [] });
        const response = await GET(new Request(
            `http://localhost/api/lms/learning-analysis?academyId=${ACADEMY_ID}&classId=${CLASS_ID}`,
        ));
        expect(response.status).toBe(200);
        expect(loadAnalysis).toHaveBeenCalledWith(expect.objectContaining({ academyId: ACADEMY_ID }), null, CLASS_ID);
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

    it('starts a prepared primary path through the authenticated mutation contract', async () => {
        startPath.mockResolvedValue({ planId: PLAN_ID });
        const response = await PATCH(new Request(
            'http://localhost/api/lms/learning-analysis',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'learning-path-start-1' },
                body: JSON.stringify({ academyId: ACADEMY_ID, planId: PLAN_ID, action: 'start' }),
            },
        ));

        expect(assertOrigin).toHaveBeenCalledOnce();
        expect(startPath).toHaveBeenCalledWith(
            expect.objectContaining({ academyId: ACADEMY_ID }),
            PLAN_ID,
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            success: true,
            data: { planId: PLAN_ID },
            path: { planId: PLAN_ID },
            invalidation: { domains: ['learning'] },
        });
    });

    it('rejects a malformed path id before authorization', async () => {
        const response = await PATCH(new Request(
            'http://localhost/api/lms/learning-analysis',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ academyId: ACADEMY_ID, planId: 'not-a-uuid' }),
            },
        ));

        expect(response.status).toBe(400);
        expect(assertRole).not.toHaveBeenCalled();
        expect(startPath).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toMatchObject({
            success: false,
            error: { code: 'INVALID_LEARNING_PATH_REQUEST' },
        });
    });

    it('returns a stable validation error when a non-draft or supplemental path is requested', async () => {
        startPath.mockRejectedValue(new LearningAnalysisValidationError(
            '준비 중인 대표 학습 경로만 시작할 수 있습니다.',
        ));
        const response = await PATCH(new Request(
            'http://localhost/api/lms/learning-analysis',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'learning-path-start-2' },
                body: JSON.stringify({ academyId: ACADEMY_ID, planId: PLAN_ID }),
            },
        ));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            success: false,
            error: {
                code: 'INVALID_LEARNING_PATH',
                message: '준비 중인 대표 학습 경로만 시작할 수 있습니다.',
                requestId: 'learning-path-start-2',
                fieldErrors: {},
            },
        });
    });

    it('completes a path without treating time passage as a status change', async () => {
        changePathStatus.mockResolvedValue({ planId: PLAN_ID, status: 'completed' });
        const response = await PATCH(new Request(
            'http://localhost/api/lms/learning-analysis',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ academyId: ACADEMY_ID, planId: PLAN_ID, action: 'complete' }),
            },
        ));

        expect(changePathStatus).toHaveBeenCalledWith(
            expect.objectContaining({ academyId: ACADEMY_ID }),
            PLAN_ID,
            'complete',
        );
        expect(startPath).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
    });
});
