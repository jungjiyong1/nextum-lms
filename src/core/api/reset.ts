// Admin reset functions are executed through Next.js Route Handlers so the
// service-role key and destructive operations stay on the server.
import { ok, err } from './shared/result';
import type { Result } from './shared/types';
import { requireCurrentAcademyId } from './currentAcademy';
import { jsonCsrfHeaders } from '@/lib/lms/csrf-client';

type ResetTarget =
    | 'classrooms'
    | 'lessons'
    | 'schedules'
    | 'students'
    | 'instructors'
    | 'courses'
    | 'enrollments'
    | 'accounting'
    | 'all';

async function prepareAdminReset(academyId: string, target: ResetTarget): Promise<string> {
    const response = await fetch('/api/lms/admin/reset/confirm', {
        method: 'POST',
        headers: jsonCsrfHeaders(),
        body: JSON.stringify({ academyId, target, confirmText: '초기화' }),
    });
    const payload = await response.json().catch(() => null) as {
        success?: boolean;
        error?: string;
        confirmToken?: unknown;
    } | null;

    if (!response.ok || !payload?.success || typeof payload.confirmToken !== 'string') {
        throw new Error(payload?.error || `Reset confirmation failed with HTTP ${response.status}`);
    }

    return payload.confirmToken;
}

async function runAdminReset(target: ResetTarget): Promise<Result<void>> {
    try {
        const academyId = await requireCurrentAcademyId();
        const confirmToken = await prepareAdminReset(academyId, target);
        const response = await fetch('/api/lms/admin/reset', {
            method: 'POST',
            headers: jsonCsrfHeaders(),
            body: JSON.stringify({ academyId, target, confirmToken }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => null) as { error?: string } | null;
            return err(new Error(payload?.error || `Reset failed with HTTP ${response.status}`));
        }

        return ok(undefined);
    } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
    }
}

export async function resetClassrooms(): Promise<Result<void>> {
    return runAdminReset('classrooms');
}

export async function resetLessons(): Promise<Result<void>> {
    return runAdminReset('lessons');
}

export async function resetSchedules(): Promise<Result<void>> {
    return runAdminReset('schedules');
}

export async function resetStudents(): Promise<Result<void>> {
    return runAdminReset('students');
}

export async function resetInstructors(): Promise<Result<void>> {
    return runAdminReset('instructors');
}

export async function resetCourses(): Promise<Result<void>> {
    return runAdminReset('courses');
}

export async function resetEnrollments(): Promise<Result<void>> {
    return runAdminReset('enrollments');
}

export async function resetAccounting(): Promise<Result<void>> {
    return runAdminReset('accounting');
}

export async function resetAll(): Promise<Result<void>> {
    return runAdminReset('all');
}
