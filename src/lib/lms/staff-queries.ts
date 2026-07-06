import 'server-only';

import type { StaffSummary } from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

const STAFF_ROLES = ['owner', 'admin', 'staff', 'teacher', 'instructor'];

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function fetchPeople(core: SchemaClient, personIds: string[]): Promise<Map<string, Row>> {
    const ids = uniqueStrings(personIds);
    if (ids.length === 0) return new Map();

    const { data, error } = await core
        .from('people')
        .select('id,full_name,display_name,email,phone,parent_name,parent_phone')
        .in('id', ids);
    ensureNoError(error, 'Failed to load people');

    return new Map(((data || []) as Row[]).map((person) => [person.id, person]));
}

export async function loadStaffSummariesForAcademy(academyId: string): Promise<StaffSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');

    const { data: staffRows, error } = await core
        .from('staff_members')
        .select('id,person_id,role,status,hourly_rate')
        .eq('academy_id', academyId)
        .in('role', STAFF_ROLES)
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load staff');

    const staff = (staffRows || []) as Row[];
    const people = await fetchPeople(core, staff.map((row) => row.person_id));

    return staff.map((row) => {
        const person = people.get(row.person_id);
        return {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown staff',
            phone: person?.phone ?? null,
            email: person?.email ?? null,
            role: row.role,
            status: row.status,
            hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
        };
    });
}
