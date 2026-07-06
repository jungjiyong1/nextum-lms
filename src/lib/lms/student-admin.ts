import 'server-only';

import type { StudentMutationResult, StudentMutationTableSummary } from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import type { LmsRoleContext } from './auth';

type Row = Record<string, any>;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function parseTables(value: unknown): StudentMutationTableSummary[] {
    if (!Array.isArray(value)) return [];
    return value.map((row: Row) => ({
        schema: String(row.schema || ''),
        table: String(row.table || ''),
        operation: String(row.operation || ''),
        affectedRows: toNumber(row.affectedRows),
    }));
}

function parseStudentMutationResult(value: unknown): StudentMutationResult {
    const payload = value && typeof value === 'object' ? value as Row : {};
    const tables = parseTables(payload.tables);
    const authUserIds = Array.isArray(payload.authUserIds)
        ? payload.authUserIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : undefined;

    return {
        studentId: String(payload.studentId || ''),
        studentName: String(payload.studentName || ''),
        tables,
        totalAffectedRows: toNumber(
            payload.totalAffectedRows,
            tables.reduce((sum, row) => sum + row.affectedRows, 0),
        ),
        authUserIds,
    };
}

export async function archiveStudentForAcademy(
    academyId: string,
    studentId: string,
    actor: LmsRoleContext,
): Promise<StudentMutationResult> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('archive_student', {
        p_academy_id: academyId,
        p_student_id: studentId,
        p_actor_person_id: actor.personId,
    });
    ensureNoError(error, 'Failed to archive student');
    return parseStudentMutationResult(data);
}

export async function hardDeleteStudentForAcademy(
    academyId: string,
    studentId: string,
    actor: LmsRoleContext,
): Promise<StudentMutationResult & { authDeleteErrors: Array<{ userId: string; message: string }> }> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('hard_delete_student', {
        p_academy_id: academyId,
        p_student_id: studentId,
        p_actor_person_id: actor.personId,
    });
    ensureNoError(error, 'Failed to hard delete student');

    const result = parseStudentMutationResult(data);
    const authDeleteErrors: Array<{ userId: string; message: string }> = [];

    for (const userId of result.authUserIds || []) {
        const { error: authError } = await client.auth.admin.deleteUser(userId);
        if (authError) {
            authDeleteErrors.push({ userId, message: authError.message });
        }
    }

    return { ...result, authDeleteErrors };
}
