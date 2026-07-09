import type { StaffRole, StaffStatus, StudentStatus } from '@/features/lms/types';
import { ApiContractError } from './api-contracts';

export type StudentRosterStatusFilter = 'operations' | 'all' | StudentStatus;
export type StaffRosterStatusFilter = 'operations' | 'all' | StaffStatus;
export type StaffRosterRoleFilter = 'all' | StaffRole;

export interface StudentRosterFilters {
    q: string;
    classId: string | null;
    status: StudentRosterStatusFilter;
}

export interface StaffRosterFilters {
    q: string;
    role: StaffRosterRoleFilter;
    status: StaffRosterStatusFilter;
}

export interface StudentRosterCursor {
    createdAt: string;
    id: string;
    filterKey: string;
}

export interface StaffRosterCursor {
    createdAt: string;
    id: string;
    filterKey: string;
}

const STUDENT_STATUSES = new Set<StudentRosterStatusFilter>([
    'operations', 'all', 'active', 'inactive', 'on_leave', 'graduated', 'dropped',
]);
const STAFF_STATUSES = new Set<StaffRosterStatusFilter>([
    'operations', 'all', 'active', 'inactive', 'on_leave',
]);
const STAFF_ROLES = new Set<StaffRosterRoleFilter>([
    'all', 'admin', 'staff', 'teacher', 'instructor',
]);
const SAFE_ID = /^[\p{L}\p{N}_.:@/-]+$/u;
const MAX_SEARCH_LENGTH = 80;

function invalidFilter(field: string, message: string): never {
    throw new ApiContractError({
        code: 'INVALID_FILTER',
        message,
        fieldErrors: { [field]: [message] },
    });
}

export function normalizeRosterQuery(value: string | null | undefined): string {
    const normalized = (value || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR');
    if (normalized.length > MAX_SEARCH_LENGTH) {
        return invalidFilter('q', `q must be ${MAX_SEARCH_LENGTH} characters or fewer.`);
    }
    if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
        return invalidFilter('q', 'q contains unsupported control characters.');
    }
    return normalized;
}

export function normalizeRosterId(value: string | null | undefined, field: string): string | null {
    const normalized = (value || '').trim();
    if (!normalized || normalized === 'all') return null;
    if (normalized.length > 128 || !SAFE_ID.test(normalized)) {
        return invalidFilter(field, `${field} is invalid.`);
    }
    return normalized;
}

export function parseStudentRosterFilters(input: {
    q?: string | null;
    classId?: string | null;
    status?: string | null;
}): StudentRosterFilters {
    const status = (input.status || 'operations') as StudentRosterStatusFilter;
    if (!STUDENT_STATUSES.has(status)) invalidFilter('status', 'Student status filter is invalid.');
    return {
        q: normalizeRosterQuery(input.q),
        classId: normalizeRosterId(input.classId, 'classId'),
        status,
    };
}

export function parseStaffRosterFilters(input: {
    q?: string | null;
    role?: string | null;
    status?: string | null;
}): StaffRosterFilters {
    const role = (input.role || 'all') as StaffRosterRoleFilter;
    const status = (input.status || 'operations') as StaffRosterStatusFilter;
    if (!STAFF_ROLES.has(role)) invalidFilter('role', 'Staff role filter is invalid.');
    if (!STAFF_STATUSES.has(status)) invalidFilter('status', 'Staff status filter is invalid.');
    return {
        q: normalizeRosterQuery(input.q),
        role,
        status,
    };
}

export function studentRosterFilterKey(filters: StudentRosterFilters): string {
    return JSON.stringify([filters.q, filters.classId || '', filters.status]);
}

export function staffRosterFilterKey(filters: StaffRosterFilters): string {
    return JSON.stringify([filters.q, filters.role, filters.status]);
}

export function isStudentRosterCursor(value: unknown): value is StudentRosterCursor {
    return isRosterCursor(value);
}

export function isStaffRosterCursor(value: unknown): value is StaffRosterCursor {
    return isRosterCursor(value);
}

function isRosterCursor(value: unknown): value is StudentRosterCursor {
    if (!value || typeof value !== 'object') return false;
    const cursor = value as Partial<StudentRosterCursor>;
    return typeof cursor.createdAt === 'string'
        && !Number.isNaN(Date.parse(cursor.createdAt))
        && typeof cursor.id === 'string'
        && /^[0-9a-f-]{36}$/iu.test(cursor.id)
        && typeof cursor.filterKey === 'string'
        && cursor.filterKey.length <= 512;
}

export function assertRosterCursorFilter(cursorFilterKey: string, expectedFilterKey: string): void {
    if (cursorFilterKey === expectedFilterKey) return;
    throw new ApiContractError({
        code: 'INVALID_CURSOR',
        message: 'The cursor does not match the active filters.',
    });
}

function quotePostgrestValue(value: string): string {
    return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

export function buildPeopleSearchOrFilter(query: string, fields: readonly string[]): string {
    const safeFields = fields.filter((field) => /^[a-z_]+$/u.test(field));
    if (safeFields.length !== fields.length || safeFields.length === 0) {
        throw new Error('People search fields must be trusted column names.');
    }
    const escapedLikeTerm = query.replace(/[%_*]/gu, (character) => `\\${character}`);
    const pattern = quotePostgrestValue(`%${escapedLikeTerm}%`);
    return safeFields.map((field) => `${field}.ilike.${pattern}`).join(',');
}
