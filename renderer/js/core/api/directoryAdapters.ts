import { coreDb, reportingDb } from '../supabaseClient';
import type { Instructor, Student } from '../types';
import { shouldFallbackToLegacy } from './shared/dbFallback';

type RawRecord = Record<string, unknown>;

export interface DirectoryFilter {
    status?: string;
    search?: string;
}

let studentCoreProjectionUnavailable = false;
let instructorCoreProjectionUnavailable = false;

function asRows(data: unknown): RawRecord[] {
    if (!data) return [];
    const rows = Array.isArray(data) ? data : [data];
    return rows.filter((row): row is RawRecord => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

function asRecord(value: unknown): RawRecord | null {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) return asRecord(value[0]);
    return value as RawRecord;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length > 0) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return null;
}

function numericId(row: RawRecord, candidates: string[]): number | null {
    for (const key of candidates) {
        const value = numberOrNull(row[key]);
        if (value !== null) return value;
    }
    return null;
}

function studentStatus(value: unknown): Student['status'] {
    return value === 'on_leave' || value === 'dropped' ? value : 'active';
}

function instructorStatus(value: unknown): Instructor['status'] {
    return value === 'inactive' || value === 'on_leave' ? value : 'active';
}

function schoolType(value: unknown): Student['school_type'] {
    return value === 'elementary' || value === 'middle' || value === 'high' ? value : null;
}

function grade(value: unknown): number | null {
    return numberOrNull(value);
}

function matchesDirectoryFilter<T extends { name: string; status: string }>(row: T, filter?: DirectoryFilter): boolean {
    if (filter?.status && row.status !== filter.status) return false;
    if (filter?.search && !row.name.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
}

async function readReportingRows(table: string): Promise<RawRecord[] | null> {
    const { data, error } = await reportingDb
        .from(table)
        .select('*');

    if (error) {
        if (shouldFallbackToLegacy(error)) return null;
        throw error;
    }

    return asRows(data);
}

export function mapLegacyStudent(row: RawRecord): Student {
    return {
        id: numericId(row, ['id']) ?? 0,
        name: stringOrNull(row.name) ?? '',
        email: stringOrNull(row.email),
        phone: stringOrNull(row.phone),
        date_of_birth: stringOrNull(row.date_of_birth),
        enrollment_date: stringOrNull(row.enrollment_date),
        status: studentStatus(row.status),
        parent_name: stringOrNull(row.parent_name),
        parent_phone: stringOrNull(row.parent_phone),
        monthly_tuition: numberOrNull(row.monthly_tuition),
        payment_cycle_day: numberOrNull(row.payment_cycle_day) ?? 1,
        last_payment_date: stringOrNull(row.last_payment_date),
        notes: stringOrNull(row.notes),
        school_type: schoolType(row.school_type),
        grade: grade(row.grade),
    };
}

function mapCoreStudent(row: RawRecord): Student | null {
    const person = asRecord(row.people) ?? asRecord(row.person) ?? asRecord(row.core_people);
    const id = numericId(row, [
        'legacy_lms_id',
        'legacy_id',
        'lms_student_id',
        'numeric_id',
        'display_id',
        'id',
    ]);
    if (id === null) return null;

    return {
        id,
        name: stringOrNull(row.name)
            ?? stringOrNull(row.full_name)
            ?? stringOrNull(person?.full_name)
            ?? stringOrNull(person?.name)
            ?? '',
        email: stringOrNull(row.email) ?? stringOrNull(person?.email),
        phone: stringOrNull(row.phone) ?? stringOrNull(person?.phone),
        date_of_birth: stringOrNull(row.date_of_birth) ?? stringOrNull(person?.date_of_birth),
        enrollment_date: stringOrNull(row.enrollment_date),
        status: studentStatus(row.status),
        parent_name: stringOrNull(row.parent_name) ?? stringOrNull(row.guardian_name),
        parent_phone: stringOrNull(row.parent_phone) ?? stringOrNull(row.guardian_phone),
        monthly_tuition: numberOrNull(row.monthly_tuition),
        payment_cycle_day: numberOrNull(row.payment_cycle_day) ?? 1,
        last_payment_date: stringOrNull(row.last_payment_date),
        notes: stringOrNull(row.notes),
        school_type: schoolType(row.school_type),
        grade: grade(row.grade),
    };
}

export function mapLegacyInstructor(row: RawRecord): Instructor {
    return {
        id: numericId(row, ['id']) ?? 0,
        name: stringOrNull(row.name) ?? '',
        email: stringOrNull(row.email),
        phone: stringOrNull(row.phone),
        hourly_rate: numberOrNull(row.hourly_rate),
        qualifications: stringOrNull(row.qualifications),
        hire_date: stringOrNull(row.hire_date),
        status: instructorStatus(row.status),
        notes: stringOrNull(row.notes),
    };
}

function isInstructorLike(row: RawRecord): boolean {
    const role = stringOrNull(row.role)
        ?? stringOrNull(row.staff_role)
        ?? stringOrNull(row.position)
        ?? stringOrNull(row.job_title);

    if (!role) return Boolean(row.hourly_rate || row.qualifications);
    return ['instructor', 'teacher', '강사'].includes(role);
}

function mapCoreInstructor(row: RawRecord, assumeInstructor: boolean): Instructor | null {
    if (!assumeInstructor && !isInstructorLike(row)) return null;

    const person = asRecord(row.people) ?? asRecord(row.person) ?? asRecord(row.core_people);
    const id = numericId(row, [
        'legacy_lms_id',
        'legacy_id',
        'lms_instructor_id',
        'numeric_id',
        'display_id',
        'id',
    ]);
    if (id === null) return null;

    return {
        id,
        name: stringOrNull(row.name)
            ?? stringOrNull(row.full_name)
            ?? stringOrNull(person?.full_name)
            ?? stringOrNull(person?.name)
            ?? '',
        email: stringOrNull(row.email) ?? stringOrNull(person?.email),
        phone: stringOrNull(row.phone) ?? stringOrNull(person?.phone),
        hourly_rate: numberOrNull(row.hourly_rate),
        qualifications: stringOrNull(row.qualifications),
        hire_date: stringOrNull(row.hire_date),
        status: instructorStatus(row.status),
        notes: stringOrNull(row.notes),
    };
}

function mapCompatibleStudents(rows: RawRecord[]): Student[] | null {
    const mapped = rows.map(mapCoreStudent).filter((row): row is Student => Boolean(row));
    if (rows.length > 0 && mapped.length === 0) return null;
    return mapped;
}

function mapCompatibleInstructors(rows: RawRecord[], assumeInstructor: boolean): Instructor[] | null {
    const mapped = rows
        .map((row) => mapCoreInstructor(row, assumeInstructor))
        .filter((row): row is Instructor => Boolean(row));
    if (rows.length > 0 && mapped.length === 0) return null;
    return mapped;
}

export async function listStudentsFromCoreProjection(filter?: DirectoryFilter): Promise<Student[] | null> {
    if (studentCoreProjectionUnavailable) return null;

    const reportingTables = ['lms_student_roster', 'students_legacy', 'student_profile'];
    for (const table of reportingTables) {
        const rows = await readReportingRows(table);
        if (!rows) continue;
        const mapped = mapCompatibleStudents(rows);
        if (mapped) return mapped.filter((row) => matchesDirectoryFilter(row, filter));
    }

    const { data, error } = await coreDb
        .from('students')
        .select('*, people:person_id(*)');

    if (error) {
        if (shouldFallbackToLegacy(error)) {
            studentCoreProjectionUnavailable = true;
            return null;
        }
        throw error;
    }

    const mapped = mapCompatibleStudents(asRows(data));
    if (!mapped) return null;
    return mapped.filter((row) => matchesDirectoryFilter(row, filter));
}

export async function listInstructorsFromCoreProjection(filter?: DirectoryFilter): Promise<Instructor[] | null> {
    if (instructorCoreProjectionUnavailable) return null;

    const reportingTables = ['lms_instructor_roster', 'instructors_legacy', 'staff_directory'];
    for (const table of reportingTables) {
        const rows = await readReportingRows(table);
        if (!rows) continue;
        const mapped = mapCompatibleInstructors(rows, true);
        if (mapped) return mapped.filter((row) => matchesDirectoryFilter(row, filter));
    }

    const { data, error } = await coreDb
        .from('staff_members')
        .select('*, people:person_id(*)');

    if (error) {
        if (shouldFallbackToLegacy(error)) {
            instructorCoreProjectionUnavailable = true;
            return null;
        }
        throw error;
    }

    const mapped = mapCompatibleInstructors(asRows(data), false);
    if (!mapped) return null;
    return mapped.filter((row) => matchesDirectoryFilter(row, filter));
}
