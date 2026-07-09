import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import type {
    InstructorPaymentRow,
    ScheduleItem,
    StaffAccountState,
    StaffDetail,
    StaffDetailSection,
    StaffHardDeletePreview,
    StaffOperationsOverview,
    StaffOperationsPermissions,
    StaffPayrollSummary,
    StaffRole,
    StaffSummary,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { decodeCursor, encodeCursor, normalizeCursorLimit } from './api-contracts';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { loadAssignedClassIdsForContext, loadClassSummariesForContext } from './class-queries';
import {
    assertRosterCursorFilter,
    isStaffRosterCursor,
    parseStaffRosterFilters,
    staffRosterFilterKey,
    type StaffRosterCursor,
    type StaffRosterFilters,
} from './roster-filters';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

const STAFF_ROLES: StaffRole[] = ['admin', 'staff', 'teacher', 'instructor'];
const STAFF_AND_OWNER_ROLES = ['owner', ...STAFF_ROLES];
const PEER_VISIBLE_ROLES: StaffRole[] = ['teacher', 'instructor'];
const DAY_MS = 24 * 60 * 60 * 1000;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function forbidden(message = 'Staff access is not allowed for this role.'): never {
    throw new LmsAuthError(message, 403);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function dateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeTime(value: unknown): string {
    return String(value || '').slice(0, 5);
}

function normalizeStaffDetailSection(value: string | null | undefined): StaffDetailSection {
    if (value === 'profile' || value === 'classes' || value === 'payroll' || value === 'account' || value === 'management') return value;
    return 'full';
}

function permissionsForContext(context: LmsRoleContext): StaffOperationsPermissions {
    const isOwnerOrAdmin = context.role === 'owner' || context.role === 'admin';
    const isStaff = context.role === 'staff';
    const isPeerScoped = requiresAssignedClassScope(context.role);
    return {
        canCreate: isOwnerOrAdmin,
        canEdit: isOwnerOrAdmin,
        canArchive: isOwnerOrAdmin,
        canHardDelete: isOwnerOrAdmin,
        canViewPayroll: isOwnerOrAdmin || isStaff,
        canCreatePayroll: isOwnerOrAdmin || isStaff,
        canViewAccount: isOwnerOrAdmin || isStaff,
        canViewSensitiveProfile: isOwnerOrAdmin || isStaff,
        scopedToPeerClasses: isPeerScoped,
    };
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

async function loadStaffRows(
    core: SchemaClient,
    academyId: string,
    options: { staffIds?: string[]; includeOwner?: boolean } = {},
): Promise<Row[]> {
    let query = core
        .from('staff_members')
        .select('id,person_id,role,status,hourly_rate,hire_date,qualifications,notes,created_at')
        .eq('academy_id', academyId)
        .in('role', options.includeOwner ? STAFF_AND_OWNER_ROLES : STAFF_ROLES)
        .order('created_at', { ascending: false });

    if (options.staffIds) {
        if (options.staffIds.length === 0) return [];
        query = query.in('id', options.staffIds);
    }

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load staff');
    return (data || []) as Row[];
}

async function loadCurrentStaffId(core: SchemaClient, context: LmsRoleContext): Promise<string | null> {
    const { data, error } = await core
        .from('staff_members')
        .select('id')
        .eq('academy_id', context.academyId)
        .eq('person_id', context.personId)
        .eq('status', 'active')
        .in('role', STAFF_AND_OWNER_ROLES)
        .limit(1)
        .maybeSingle();
    ensureNoError(error, 'Failed to load current staff member');
    return (data as Row | null)?.id ?? null;
}

async function loadDefaultClassesByStaff(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    staffIds: string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const ids = uniqueStrings(staffIds);
    const result = new Map<string, Array<{ id: string; name: string }>>();
    if (ids.length === 0) return result;

    const { data: profiles, error: profilesError } = await lms
        .from('class_profiles')
        .select('class_id,default_instructor_staff_id')
        .eq('academy_id', academyId)
        .in('default_instructor_staff_id', ids);
    ensureNoError(profilesError, 'Failed to load staff classes');

    const profileRows = (profiles || []) as Row[];
    const classIds = uniqueStrings(profileRows.map((row) => row.class_id));
    const { data: classes, error: classesError } = classIds.length > 0
        ? await core.from('classes').select('id,name').eq('academy_id', academyId).in('id', classIds)
        : { data: [], error: null };
    ensureNoError(classesError, 'Failed to load staff class names');

    const names = new Map(((classes || []) as Row[]).map((row) => [row.id, row.name]));
    for (const row of profileRows) {
        const staffId = row.default_instructor_staff_id;
        if (!staffId) continue;
        const list = result.get(staffId) || [];
        list.push({ id: row.class_id, name: names.get(row.class_id) || 'Unknown class' });
        result.set(staffId, list);
    }
    return result;
}

async function loadRuleCountsByStaff(
    lms: SchemaClient,
    academyId: string,
    staffIds: string[],
): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const ids = uniqueStrings(staffIds);
    if (ids.length === 0) return result;

    const { data, error } = await lms
        .from('class_schedule_rules')
        .select('instructor_staff_id')
        .eq('academy_id', academyId)
        .eq('active', true)
        .in('instructor_staff_id', ids);
    ensureNoError(error, 'Failed to load staff schedule counts');

    for (const row of (data || []) as Row[]) {
        const staffId = row.instructor_staff_id;
        if (staffId) result.set(staffId, (result.get(staffId) || 0) + 1);
    }
    return result;
}

async function loadLastPaymentByStaff(
    lms: SchemaClient,
    academyId: string,
    staffIds: string[],
): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const ids = uniqueStrings(staffIds);
    if (ids.length === 0) return result;

    const { data, error } = await lms
        .from('instructor_payments')
        .select('instructor_id,payment_date')
        .eq('academy_id', academyId)
        .in('instructor_id', ids)
        .order('payment_date', { ascending: false });
    ensureNoError(error, 'Failed to load staff payment summary');

    for (const row of (data || []) as Row[]) {
        if (row.instructor_id && !result.has(row.instructor_id)) {
            result.set(row.instructor_id, row.payment_date ?? null);
        }
    }
    return result;
}

function sanitizeStaffSummary(summary: StaffSummary, permissions: StaffOperationsPermissions): StaffSummary {
    if (permissions.canViewSensitiveProfile) return summary;
    return {
        ...summary,
        phone: null,
        email: null,
        hourlyRate: null,
        hireDate: null,
        qualifications: null,
        notes: null,
        lastPaymentDate: null,
        visibleToPeerOnly: true,
    };
}

async function buildStaffSummaries(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    staffRows: Row[],
    permissions: StaffOperationsPermissions,
): Promise<StaffSummary[]> {
    const people = await fetchPeople(core, staffRows.map((row) => row.person_id));
    const staffIds = staffRows.map((row) => row.id);
    const [classesByStaff, ruleCounts, lastPaymentDates] = await Promise.all([
        loadDefaultClassesByStaff(core, lms, academyId, staffIds),
        loadRuleCountsByStaff(lms, academyId, staffIds),
        permissions.canViewPayroll ? loadLastPaymentByStaff(lms, academyId, staffIds) : Promise.resolve(new Map<string, string | null>()),
    ]);

    return staffRows.map((row) => {
        const person = people.get(row.person_id);
        const classes = classesByStaff.get(row.id) || [];
        const summary: StaffSummary = {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown staff',
            phone: person?.phone ?? null,
            email: person?.email ?? null,
            role: row.role,
            status: row.status,
            hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
            hireDate: row.hire_date ?? null,
            qualifications: row.qualifications ?? null,
            notes: row.notes ?? null,
            classIds: classes.map((item) => item.id),
            classNames: classes.map((item) => item.name),
            activeClassCount: classes.length,
            upcomingLessonCount: ruleCounts.get(row.id) || 0,
            lastPaymentDate: lastPaymentDates.get(row.id) ?? null,
        };
        return sanitizeStaffSummary(summary, permissions);
    });
}

interface PeerRosterScope {
    assignedClassIds: Set<string>;
    visibleStaffIds: Set<string>;
}

async function loadPeerRosterScope(
    core: SchemaClient,
    lms: SchemaClient,
    context: LmsRoleContext,
): Promise<PeerRosterScope> {
    const currentStaffId = await loadCurrentStaffId(core, context);
    const visible = new Set<string>();
    if (currentStaffId) visible.add(currentStaffId);

    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    const classIds = [...(assignedClassIds || new Set<string>())];
    if (classIds.length === 0) {
        return { assignedClassIds: new Set(), visibleStaffIds: visible };
    }

    const [profilesResult, rulesResult, occurrencesResult] = await Promise.all([
        lms
            .from('class_profiles')
            .select('default_instructor_staff_id')
            .eq('academy_id', context.academyId)
            .in('class_id', classIds),
        lms
            .from('class_schedule_rules')
            .select('instructor_staff_id')
            .eq('academy_id', context.academyId)
            .eq('active', true)
            .in('class_id', classIds),
        lms
            .from('lesson_occurrences')
            .select('instructor_staff_id,substitute_staff_id')
            .eq('academy_id', context.academyId)
            .in('class_id', classIds),
    ]);

    ensureNoError(profilesResult.error, 'Failed to load peer class profiles');
    ensureNoError(rulesResult.error, 'Failed to load peer schedule rules');
    ensureNoError(occurrencesResult.error, 'Failed to load peer lesson occurrences');

    for (const row of (profilesResult.data || []) as Row[]) {
        if (row.default_instructor_staff_id) visible.add(row.default_instructor_staff_id);
    }
    for (const row of (rulesResult.data || []) as Row[]) {
        if (row.instructor_staff_id) visible.add(row.instructor_staff_id);
    }
    for (const row of (occurrencesResult.data || []) as Row[]) {
        if (row.instructor_staff_id) visible.add(row.instructor_staff_id);
        if (row.substitute_staff_id) visible.add(row.substitute_staff_id);
    }

    return { assignedClassIds: new Set(classIds), visibleStaffIds: visible };
}

async function loadPeerVisibleStaffIds(
    core: SchemaClient,
    lms: SchemaClient,
    context: LmsRoleContext,
): Promise<Set<string>> {
    return (await loadPeerRosterScope(core, lms, context)).visibleStaffIds;
}

async function assertCanViewStaff(
    core: SchemaClient,
    lms: SchemaClient,
    context: LmsRoleContext,
    staffId: string,
): Promise<void> {
    if (!requiresAssignedClassScope(context.role)) return;
    const visible = await loadPeerVisibleStaffIds(core, lms, context);
    if (!visible.has(staffId)) forbidden();
}

function filterPeerRows(rows: Row[], permissions: StaffOperationsPermissions): Row[] {
    if (!permissions.scopedToPeerClasses) return rows;
    return rows.filter((row) => PEER_VISIBLE_ROLES.includes(row.role));
}

export async function loadStaffSummariesForAcademy(academyId: string): Promise<StaffSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const rows = await loadStaffRows(core, academyId, { includeOwner: true });
    return buildStaffSummaries(core, lms, academyId, rows, {
        canCreate: false,
        canEdit: false,
        canArchive: false,
        canHardDelete: false,
        canViewPayroll: true,
        canCreatePayroll: false,
        canViewAccount: false,
        canViewSensitiveProfile: true,
        scopedToPeerClasses: false,
    });
}

function rolesMatchingStaffQuery(query: string): StaffRole[] {
    const labels: Record<StaffRole, string[]> = {
        admin: ['admin', '관리자'],
        staff: ['staff', '직원'],
        teacher: ['teacher', '교사'],
        instructor: ['instructor', '강사'],
    };
    return STAFF_ROLES.filter((role) => labels[role].some((label) => label.includes(query)));
}

export async function loadStaffRosterPageRows(input: {
    lms: SchemaClient;
    academyId: string;
    visibleStaffIds: string[] | null;
    searchClassIds: string[] | null;
    filters: StaffRosterFilters;
    cursor: StaffRosterCursor | null;
    permissions: StaffOperationsPermissions;
    limit: number;
    signal?: AbortSignal;
}): Promise<Row[]> {
    if (input.visibleStaffIds?.length === 0) return [];
    let query = input.lms.rpc('list_staff_roster_v2', {
        p_academy_id: input.academyId,
        p_query: input.filters.q,
        p_include_sensitive: input.permissions.canViewSensitiveProfile,
        p_matching_roles: rolesMatchingStaffQuery(input.filters.q),
        p_role: input.filters.role,
        p_status: input.filters.status,
        p_after_created_at: input.cursor?.createdAt || null,
        p_after_id: input.cursor?.id || null,
        p_visible_staff_ids: input.visibleStaffIds,
        p_search_class_ids: input.searchClassIds,
        p_peer_only: input.permissions.scopedToPeerClasses,
        p_limit: input.limit,
    });
    if (input.signal) query = query.abortSignal(input.signal);
    const { data, error } = await query;
    ensureNoError(error, 'Failed to load filtered staff roster page');
    return ((data || []) as Row[]).map((row) => ({
        id: String(row.staff_id),
        created_at: String(row.created_at),
    }));
}

export async function loadStaffOperationsOverview(
    context: LmsRoleContext,
    options: {
        cursor?: string | null;
        limit?: string | number | null;
        q?: string | null;
        role?: string | null;
        status?: string | null;
        signal?: AbortSignal;
    } = {},
): Promise<StaffOperationsOverview> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const permissions = permissionsForContext(context);
    const filters = parseStaffRosterFilters(options);
    const filterKey = staffRosterFilterKey(filters);
    const limit = normalizeCursorLimit(options.limit);
    const cursor = decodeCursor(options.cursor, isStaffRosterCursor);
    if (cursor) assertRosterCursorFilter(cursor.filterKey, filterKey);

    const classesPromise = loadClassSummariesForContext(context);

    const peerScope = permissions.scopedToPeerClasses
        ? await loadPeerRosterScope(core, lms, context)
        : null;
    const visibleStaffIds = peerScope ? [...peerScope.visibleStaffIds] : null;
    if (visibleStaffIds?.length === 0) {
        return {
            staff: [],
            classes: await classesPromise,
            permissions,
            nextCursor: null,
            hasMore: false,
        };
    }

    const classes = await classesPromise;
    const fetchedRows = await loadStaffRosterPageRows({
        lms,
        academyId: context.academyId,
        visibleStaffIds,
        searchClassIds: peerScope ? [...peerScope.assignedClassIds] : null,
        filters,
        cursor,
        permissions,
        limit,
        signal: options.signal,
    });
    const hasMore = fetchedRows.length > limit;
    const pageRows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    const pageStaffIds = pageRows.map((row) => String(row.id));
    const rows = filterPeerRows(
        await loadStaffRows(core, context.academyId, { staffIds: pageStaffIds }),
        permissions,
    );
    const summaries = await buildStaffSummaries(core, lms, context.academyId, rows, permissions);
    const staffById = new Map(summaries.map((row) => [row.id, row]));
    const staff = pageStaffIds.flatMap((id) => {
        const row = staffById.get(id);
        return row ? [row] : [];
    });
    const lastRow = pageRows.at(-1);

    return {
        staff,
        classes,
        permissions,
        hasMore,
        nextCursor: hasMore && lastRow
            ? encodeCursor({ createdAt: String(lastRow.created_at), id: String(lastRow.id), filterKey })
            : null,
    };
}

async function loadStaffSchedule(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    staffId: string,
    allowedClassIds: Set<string> | null,
): Promise<ScheduleItem[]> {
    const today = dateString(new Date());
    const end = dateString(new Date(Date.now() + 14 * DAY_MS));
    const [rulesResult, occurrencesResult] = await Promise.all([
        lms
            .from('class_schedule_rules')
            .select('id,class_id,day_of_week,start_time,end_time,start_date,end_date,classroom_id,instructor_staff_id,active')
            .eq('academy_id', academyId)
            .eq('active', true)
            .eq('instructor_staff_id', staffId),
        lms
            .from('lesson_occurrences')
            .select('id,class_id,rule_id,occurrence_date,start_time,end_time,status,classroom_id,instructor_staff_id,substitute_staff_id,cancel_reason')
            .eq('academy_id', academyId)
            .gte('occurrence_date', today)
            .lte('occurrence_date', end)
            .or(`instructor_staff_id.eq.${staffId},substitute_staff_id.eq.${staffId}`),
    ]);
    ensureNoError(rulesResult.error, 'Failed to load staff schedule rules');
    ensureNoError(occurrencesResult.error, 'Failed to load staff lesson occurrences');

    const rows = [
        ...((rulesResult.data || []) as Row[]).filter((row) => !allowedClassIds || allowedClassIds.has(row.class_id)),
        ...((occurrencesResult.data || []) as Row[]).filter((row) => !allowedClassIds || allowedClassIds.has(row.class_id)),
    ];
    const classIds = uniqueStrings(rows.map((row) => row.class_id));
    const classroomIds = uniqueStrings(rows.map((row) => row.classroom_id));
    const [{ data: classes, error: classesError }, { data: classrooms, error: classroomsError }] = await Promise.all([
        classIds.length > 0
            ? core.from('classes').select('id,name').eq('academy_id', academyId).in('id', classIds)
            : Promise.resolve({ data: [], error: null }),
        classroomIds.length > 0
            ? lms.from('classrooms').select('id,name').eq('academy_id', academyId).in('id', classroomIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(classesError, 'Failed to load staff schedule classes');
    ensureNoError(classroomsError, 'Failed to load staff schedule classrooms');

    const classNames = new Map(((classes || []) as Row[]).map((row) => [row.id, row.name]));
    const classroomNames = new Map(((classrooms || []) as Row[]).map((row) => [row.id, row.name]));
    const schedule: ScheduleItem[] = [];

    for (const row of (occurrencesResult.data || []) as Row[]) {
        if (allowedClassIds && !allowedClassIds.has(row.class_id)) continue;
        schedule.push({
            id: row.id,
            actualId: row.id,
            virtual: false,
            classId: row.class_id,
            className: classNames.get(row.class_id) || 'Unknown class',
            ruleId: row.rule_id ?? null,
            date: row.occurrence_date,
            startTime: normalizeTime(row.start_time),
            endTime: normalizeTime(row.end_time),
            status: row.status,
            classroomName: row.classroom_id ? classroomNames.get(row.classroom_id) ?? null : null,
            instructorId: staffId,
            instructorName: null,
            cancelReason: row.cancel_reason ?? null,
        });
    }

    for (const row of (rulesResult.data || []) as Row[]) {
        if (allowedClassIds && !allowedClassIds.has(row.class_id)) continue;
        schedule.push({
            id: `rule:${row.id}`,
            actualId: null,
            virtual: true,
            classId: row.class_id,
            className: classNames.get(row.class_id) || 'Unknown class',
            ruleId: row.id,
            date: row.start_date,
            startTime: normalizeTime(row.start_time),
            endTime: normalizeTime(row.end_time),
            status: 'scheduled',
            classroomName: row.classroom_id ? classroomNames.get(row.classroom_id) ?? null : null,
            instructorId: staffId,
            instructorName: null,
            cancelReason: null,
        });
    }

    return schedule.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

async function loadStaffPayroll(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    staffId: string,
    serviceMonth: string,
): Promise<{ rows: InstructorPaymentRow[]; summary: StaffPayrollSummary | null }> {
    const { data, error } = await lms
        .from('instructor_payments')
        .select('id,instructor_id,recipient_name,service_month,payment_date,gross_amount,withholding_type,withholding_rate,withholding_tax,local_tax,net_amount,hours_worked,hourly_rate,payment_method,status,notes')
        .eq('academy_id', academyId)
        .eq('instructor_id', staffId)
        .eq('service_month', serviceMonth)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load staff payroll');

    const staffRows = await loadStaffRows(core, academyId, { staffIds: [staffId], includeOwner: true });
    const people = await fetchPeople(core, staffRows.map((row) => row.person_id));
    const staff = staffRows[0];
    const person = staff ? people.get(staff.person_id) : null;
    const instructorName = person?.display_name || person?.full_name || null;

    const rows = ((data || []) as Row[]).map((row) => ({
        id: row.id,
        instructorId: row.instructor_id ?? null,
        instructorName,
        recipientName: row.recipient_name ?? null,
        serviceMonth: row.service_month,
        paymentDate: row.payment_date,
        grossAmount: toNumber(row.gross_amount),
        withholdingType: row.withholding_type,
        withholdingRate: toNumber(row.withholding_rate),
        withholdingTax: toNumber(row.withholding_tax),
        localTax: toNumber(row.local_tax),
        netAmount: toNumber(row.net_amount),
        hoursWorked: row.hours_worked === null || row.hours_worked === undefined ? null : Number(row.hours_worked),
        hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
        paymentMethod: row.payment_method ?? null,
        status: row.status,
        notes: row.notes ?? null,
    }));

    if (rows.length === 0) return { rows, summary: null };
    return {
        rows,
        summary: {
            serviceMonth,
            grossAmount: rows.reduce((sum, row) => sum + row.grossAmount, 0),
            netAmount: rows.reduce((sum, row) => sum + row.netAmount, 0),
            paidCount: rows.filter((row) => row.status === 'paid').length,
            lastPaymentDate: rows[0]?.paymentDate ?? null,
        },
    };
}

async function loadStaffAccountState(
    core: SchemaClient,
    academyId: string,
    staff: StaffSummary,
): Promise<StaffAccountState> {
    const [accountResult, memberResult, inviteResult] = await Promise.all([
        core
            .from('user_accounts')
            .select('id,status')
            .eq('person_id', staff.personId)
            .limit(1)
            .maybeSingle(),
        core
            .from('academy_members')
            .select('role,active,user_account_id')
            .eq('academy_id', academyId)
            .eq('person_id', staff.personId)
            .in('role', STAFF_AND_OWNER_ROLES)
            .limit(1)
            .maybeSingle(),
        core
            .from('account_invitations')
            .select('id,expires_at,accepted_at')
            .eq('academy_id', academyId)
            .eq('staff_member_id', staff.id)
            .is('accepted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);
    ensureNoError(accountResult.error, 'Failed to load staff account');
    ensureNoError(memberResult.error, 'Failed to load staff membership');
    ensureNoError(inviteResult.error, 'Failed to load staff invitation');

    const account = accountResult.data as Row | null;
    const member = memberResult.data as Row | null;
    const invite = inviteResult.data as Row | null;
    return {
        hasAccount: Boolean(account?.id || member?.user_account_id),
        accountStatus: account?.status ?? null,
        membershipRole: member?.role ?? null,
        membershipActive: Boolean(member?.active),
        pendingInvitation: Boolean(invite?.id),
        invitationExpiresAt: invite?.expires_at ?? null,
    };
}

function parseStaffHardDeletePreview(value: unknown): StaffHardDeletePreview {
    const payload = value && typeof value === 'object' ? value as Row : {};
    const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
    return {
        staffId: String(payload.staffId || ''),
        staffName: String(payload.staffName || ''),
        canHardDelete: Boolean(payload.canHardDelete),
        historicalRecordCount: toNumber(payload.historicalRecordCount),
        sharedIdentityCount: toNumber(payload.sharedIdentityCount),
        blockers: blockers.map((row: Row) => ({
            key: String(row.key || ''),
            label: String(row.label || row.key || ''),
            count: toNumber(row.count),
        })),
    };
}

export async function loadStaffHardDeletePreview(academyId: string, staffId: string): Promise<StaffHardDeletePreview> {
    const client = createAdminClient();
    const { data, error } = await client.schema('lms').rpc('hard_delete_staff_member_preview', {
        p_academy_id: academyId,
        p_staff_id: staffId,
    });
    ensureNoError(error, 'Failed to load staff hard delete preview');
    return parseStaffHardDeletePreview(data);
}

export async function loadStaffDetail(
    context: LmsRoleContext,
    staffId: string,
    section?: string | null,
    serviceMonth = currentMonth(),
): Promise<StaffDetail> {
    if (!staffId) throw new Error('Staff id is required.');
    const requestedSection = normalizeStaffDetailSection(section);
    const permissions = permissionsForContext(context);
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');

    await assertCanViewStaff(core, lms, context, staffId);
    const rows = filterPeerRows(await loadStaffRows(core, context.academyId, { staffIds: [staffId], includeOwner: true }), permissions);
    if (rows.length === 0) forbidden();
    const [summary] = await buildStaffSummaries(core, lms, context.academyId, rows, permissions);
    if (!summary) forbidden();

    const assignedClassIds = permissions.scopedToPeerClasses ? await loadAssignedClassIdsForContext(context) : null;
    const loadedSections: StaffDetailSection[] = requestedSection === 'full'
        ? ['profile', 'classes', 'payroll', 'account', 'management', 'full']
        : [requestedSection];
    const [allClasses, schedule] = await Promise.all([
        loadClassSummariesForContext(context),
        requestedSection === 'classes' || requestedSection === 'full'
            ? loadStaffSchedule(core, lms, context.academyId, staffId, assignedClassIds)
            : Promise.resolve([]),
    ]);
    const scheduleClassIds = new Set(schedule.map((row) => row.classId));
    const assignedClasses = allClasses.filter((row) => row.defaultInstructorId === staffId || scheduleClassIds.has(row.id));

    const payrollData = permissions.canViewPayroll && (requestedSection === 'payroll' || requestedSection === 'full')
        ? await loadStaffPayroll(core, lms, context.academyId, staffId, serviceMonth)
        : { rows: [], summary: null };
    const account = permissions.canViewAccount && (requestedSection === 'account' || requestedSection === 'full')
        ? await loadStaffAccountState(core, context.academyId, summary)
        : null;
    return {
        summary,
        permissions,
        loadedSections,
        assignedClasses,
        schedule,
        payroll: payrollData.rows,
        payrollSummary: payrollData.summary,
        account,
        hardDeletePreview: null,
    };
}
