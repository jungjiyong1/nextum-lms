import 'server-only';

import type { StaffMutationResult, StaffMutationTableSummary } from '@/features/lms/types';
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

function parseTables(value: unknown): StaffMutationTableSummary[] {
    if (!Array.isArray(value)) return [];
    return value.map((row: Row) => ({
        schema: String(row.schema || ''),
        table: String(row.table || ''),
        operation: String(row.operation || ''),
        affectedRows: toNumber(row.affectedRows),
    }));
}

function parseStaffMutationResult(value: unknown): StaffMutationResult {
    const payload = value && typeof value === 'object' ? value as Row : {};
    const tables = parseTables(payload.tables);
    return {
        staffId: String(payload.staffId || ''),
        staffName: String(payload.staffName || ''),
        tables,
        totalAffectedRows: toNumber(
            payload.totalAffectedRows,
            tables.reduce((sum, row) => sum + row.affectedRows, 0),
        ),
    };
}

export async function archiveStaffForAcademy(
    academyId: string,
    staffId: string,
    actor: LmsRoleContext,
): Promise<StaffMutationResult> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('archive_staff_member', {
        p_academy_id: academyId,
        p_staff_id: staffId,
        p_actor_person_id: actor.personId,
    });
    ensureNoError(error, 'Failed to archive staff member');
    return parseStaffMutationResult(data);
}

export async function hardDeleteStaffForAcademy(
    academyId: string,
    staffId: string,
    actor: LmsRoleContext,
): Promise<StaffMutationResult> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('hard_delete_staff_member', {
        p_academy_id: academyId,
        p_staff_id: staffId,
        p_actor_person_id: actor.personId,
    });
    ensureNoError(error, 'Failed to hard delete staff member');
    return parseStaffMutationResult(data);
}
