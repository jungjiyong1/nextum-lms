import { assertSameOrigin, authErrorResponse, assertLmsRoleForAcademy } from '@/lib/lms/auth';
import {
    createLearningAnalysisPlan,
    loadLearningAnalysisData,
} from '@/lib/lms/learning-analysis-service';
import { isUuid, LearningAnalysisValidationError } from '@/lib/lms/learning-analysis-mapper';
import {
    mutationError,
    mutationException,
    mutationSuccess,
} from '@/lib/lms/api-response';

const LEARNING_ANALYSIS_ROLES = ['owner', 'admin', 'staff', 'teacher', 'instructor'] as const;

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
        const params = new URL(request.url).searchParams;
        const academyId = params.get('academyId')?.trim() ?? '';
        const planId = params.get('planId')?.trim() || null;
        if (!isUuid(academyId) || (planId !== null && !isUuid(planId))) {
            return noStoreJson(
                { success: false, error: '학원 또는 시험 계획 정보가 올바르지 않습니다.' },
                { status: 400 },
            );
        }

        const actor = await assertLmsRoleForAcademy(academyId, [...LEARNING_ANALYSIS_ROLES]);
        const data = await loadLearningAnalysisData(actor, planId);
        return noStoreJson({ success: true, data });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;

        console.error('[LMS Learning Analysis] Failed:', error);
        return noStoreJson({
            success: false,
            error: '학습 분석을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);
        const body = await request.json() as { academyId?: unknown; input?: unknown };
        const academyId = typeof body.academyId === 'string' ? body.academyId.trim() : '';
        if (!isUuid(academyId)) {
            return mutationError(
                'INVALID_LEARNING_ANALYSIS_REQUEST',
                '학원 정보가 올바르지 않습니다.',
                { request },
            );
        }

        const actor = await assertLmsRoleForAcademy(academyId, [...LEARNING_ANALYSIS_ROLES]);
        const result = await createLearningAnalysisPlan(actor, body.input);
        return mutationSuccess(result, {
            request,
            aliases: { plan: result },
            invalidation: {
                eventId: crypto.randomUUID(),
                domains: ['learning'],
            },
        });
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof LearningAnalysisValidationError) {
            return mutationError(
                'INVALID_LEARNING_PLAN',
                error.message,
                { request, fieldErrors: error.fieldErrors },
            );
        }

        console.error('[LMS Learning Analysis] Plan creation failed:', error);
        return mutationException(
            error,
            'LEARNING_PLAN_CREATION_FAILED',
            '학습 계획을 저장하지 못했습니다.',
            { request },
        );
    }
}
