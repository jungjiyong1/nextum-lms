import 'server-only';

import type { StudentOperationsOverview, StudentSummary } from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadClassSummariesForContext } from './class-queries';
import type { LmsRoleContext } from './auth';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
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

export async function loadStudentSummariesForAcademy(academyId: string): Promise<StudentSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');

    const { data: studentsData, error: studentsError } = await core
        .from('students')
        .select('id,person_id,status,school_type,grade')
        .eq('academy_id', academyId)
        .order('created_at', { ascending: false });
    ensureNoError(studentsError, 'Failed to load students');

    const students = (studentsData || []) as Row[];
    if (students.length === 0) return [];

    const studentIds = students.map((row) => row.id);
    const [{ data: classRows, error: classError }, { data: contracts, error: contractsError }] = await Promise.all([
        core.from('class_students').select('class_id,student_id,status,classes(id,name)').in('student_id', studentIds),
        lms.from('student_billing_contracts').select('*').eq('academy_id', academyId).in('student_id', studentIds).eq('status', 'active'),
    ]);
    ensureNoError(classError, 'Failed to load student classes');
    ensureNoError(contractsError, 'Failed to load student contracts');

    const people = await fetchPeople(core, students.map((row) => row.person_id));
    const contractMap = new Map(((contracts || []) as Row[]).map((row) => [row.student_id, row]));
    const contractIds = ((contracts || []) as Row[]).map((row) => row.id);
    const rulesByContract = new Map<string, Row[]>();

    if (contractIds.length > 0) {
        const { data: rules, error: rulesError } = await lms
            .from('billing_class_rules')
            .select('contract_id,class_id,rule_type,amount')
            .eq('academy_id', academyId)
            .in('contract_id', contractIds);
        ensureNoError(rulesError, 'Failed to load student billing rules');
        for (const rule of (rules || []) as Row[]) {
            rulesByContract.set(rule.contract_id, [...(rulesByContract.get(rule.contract_id) || []), rule]);
        }
    }

    const classNames = new Map<string, string[]>();
    const classIdsByStudent = new Map<string, string[]>();

    for (const row of (classRows || []) as Row[]) {
        if (row.status !== 'active') continue;
        const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
        const names = classNames.get(row.student_id) || [];
        if (cls?.name) names.push(cls.name);
        classNames.set(row.student_id, names);
        classIdsByStudent.set(row.student_id, [...(classIdsByStudent.get(row.student_id) || []), row.class_id]);
    }

    return students.map((row) => {
        const person = people.get(row.person_id);
        const contract = contractMap.get(row.id);
        const extraClassFee = (rulesByContract.get(contract?.id) || []).find((rule) => rule.rule_type === 'extra_flat')?.amount;
        return {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown student',
            phone: person?.phone ?? null,
            parentName: person?.parent_name ?? null,
            parentPhone: person?.parent_phone ?? null,
            schoolType: row.school_type ?? null,
            grade: row.grade ?? null,
            status: row.status,
            classIds: classIdsByStudent.get(row.id) || [],
            classNames: classNames.get(row.id) || [],
            billingMode: contract?.billing_mode ?? null,
            baseMonthlyFee: toNumber(contract?.base_monthly_fee),
            hourlyRate: contract?.hourly_rate === null || contract?.hourly_rate === undefined ? null : Number(contract.hourly_rate),
            extraClassFee: toNumber(extraClassFee),
        };
    });
}

export async function loadStudentOperationsOverview(context: LmsRoleContext): Promise<StudentOperationsOverview> {
    const [students, classes] = await Promise.all([
        loadStudentSummariesForAcademy(context.academyId),
        loadClassSummariesForContext(context),
    ]);

    return { students, classes };
}
