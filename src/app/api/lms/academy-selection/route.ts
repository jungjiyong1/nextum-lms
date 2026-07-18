import { NextResponse } from 'next/server';

import { loadAcademyAccessContext } from '@/lib/lms/academy-access';
import { academyCookieOptions } from '@/lib/lms/academy-cookie';
import { findSelectedAcademy, LMS_ACADEMY_COOKIE } from '@/lib/lms/academy-selection';
import {
    assertSameOrigin,
    authErrorResponse,
    LmsAuthError,
} from '@/lib/lms/auth';

export async function POST(request: Request) {
    try {
        assertSameOrigin(request);

        const body = await request.json().catch(() => null) as { academyId?: unknown } | null;
        if (typeof body?.academyId !== 'string' || !body.academyId.trim()) {
            return NextResponse.json(
                { success: false, error: { message: '학원을 선택하세요.' } },
                { status: 400 },
            );
        }

        const access = await loadAcademyAccessContext();
        const academy = findSelectedAcademy(access.academies, body.academyId);
        if (!academy) {
            throw new LmsAuthError('선택한 학원에 접근할 수 없습니다.', 403);
        }

        const response = NextResponse.json({
            success: true,
            academy: {
                id: academy.id,
                name: academy.name,
            },
        });
        response.cookies.set({
            name: LMS_ACADEMY_COOKIE,
            value: academy.id,
            ...academyCookieOptions(request),
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        return authErrorResponse(error) ?? NextResponse.json(
            { success: false, error: { message: '학원을 선택하지 못했습니다.' } },
            { status: 500 },
        );
    }
}

export async function DELETE(request: Request) {
    try {
        assertSameOrigin(request);

        const response = NextResponse.json({ success: true });
        response.cookies.set({
            name: LMS_ACADEMY_COOKIE,
            value: '',
            ...academyCookieOptions(request),
            maxAge: 0,
        });
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        return authErrorResponse(error) ?? NextResponse.json(
            { success: false, error: { message: '학원 선택을 초기화하지 못했습니다.' } },
            { status: 500 },
        );
    }
}
