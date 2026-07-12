import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import { lessonHasEnded, normalizeLessonOccurrenceStatus } from '@/features/lms/lesson-status';
import type {
    AttendanceRow,
    BookSummary,
    ClassBookSummary,
    ClassCourseOption,
    ClassDirectoryPage,
    ClassMemberCandidate,
    ClassOperationsDetail,
    ClassOperationsOverview,
    ClassOperationsPermissions,
    ClassOperationsTruncation,
    ClassStudentSummary,
    ClassSummary,
    ClassroomSummary,
    ScheduleItem,
    ScheduleRuleSummary,
    StaffSummary,
} from '@/features/lms/types';
import {
    classMatchesDirectoryQuery,
    compareClassDirectoryRows,
    decodeClassDirectoryCursor,
    encodeClassDirectoryCursor,
    facetOptions,
    type ClassDirectoryQuery,
} from '@/features/lms/classrooms/class-directory-query';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertAssignedClassAccess, assertOccurrenceStatusAccess } from './class-access';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { buildPeopleSearchOrFilter, normalizeRosterQuery } from './roster-filters';
import { toSeoulDate } from './seoul-date';

type Row = Record<string, any>;
const SCHEDULE_DELETED_MARKER = '__nextum_schedule_deleted__';
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

const STAFF_ROLES = ['owner', 'admin', 'staff', 'teacher', 'instructor'];

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function dateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date {
    return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function mondayFirstDay(date: Date): number {
    return (date.getDay() + 6) % 7;
}

function weeksBetween(start: Date, target: Date): number {
    const ms = target.getTime() - start.getTime();
    return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

function normalizeTime(value: string | null | undefined): string {
    return (value || '').slice(0, 5);
}

function scheduleMinutes(startTime: string, endTime: string): number {
    const [startHour, startMinute] = startTime.slice(0, 5).split(':').map(Number);
    const [endHour, endMinute] = endTime.slice(0, 5).split(':').map(Number);
    if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
    return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
}

function rowsFromJson(value: unknown, key: string): Row[] {
    if (!value || typeof value !== 'object') return [];
    const rows = (value as Row)[key];
    return Array.isArray(rows) ? rows as Row[] : [];
}

function truncationFromJson(value: unknown): ClassOperationsTruncation {
    const raw = value && typeof value === 'object' && (value as Row).truncated;
    const row = raw && typeof raw === 'object' ? raw as Row : {};
    return {
        classes: row.classes === true,
        scheduleRules: row.scheduleRules === true,
        occurrences: row.occurrences === true,
        attendance: row.attendance === true,
        books: row.books === true,
        staff: row.staff === true,
        classrooms: row.classrooms === true,
    };
}

function scheduleFromReadModel(
    occurrenceRows: Row[],
    ruleRows: Row[],
    startDate: string,
    endDate: string,
): ScheduleItem[] {
    const items: ScheduleItem[] = [];
    const actualKeys = new Set<string>();

    for (const row of occurrenceRows) {
        const date = String(row.occurrence_date);
        const start = normalizeTime(row.start_time);
        const end = normalizeTime(row.end_time);
        if (row.rule_id) actualKeys.add(`${row.class_id}:${row.rule_id}:${row.occurrence_date}`);
        if (row.cancel_reason === SCHEDULE_DELETED_MARKER) continue;
        items.push({
            id: String(row.id),
            actualId: String(row.id),
            virtual: false,
            classId: String(row.class_id),
            className: String(row.class_name || 'Unknown class'),
            ruleId: row.rule_id ? String(row.rule_id) : null,
            date,
            startTime: start,
            endTime: end,
            status: normalizeLessonOccurrenceStatus(row.status),
            hasEnded: lessonHasEnded(date, end),
            classroomId: row.classroom_id ? String(row.classroom_id) : null,
            classroomOverrideId: row.classroom_override_id ? String(row.classroom_override_id) : null,
            classroomName: row.classroom_name ? String(row.classroom_name) : null,
            instructorId: row.instructor_id ? String(row.instructor_id) : null,
            instructorOverrideId: row.instructor_override_id ? String(row.instructor_override_id) : null,
            instructorName: row.instructor_name ? String(row.instructor_name) : null,
            substituteInstructorId: row.substitute_instructor_id ? String(row.substitute_instructor_id) : null,
            substituteInstructorName: row.substitute_instructor_name ? String(row.substitute_instructor_name) : null,
            cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
            notes: row.notes ? String(row.notes) : null,
            overrideScope: row.override_scope ? row.override_scope as ScheduleItem['overrideScope'] : null,
            updatedAt: row.updated_at ? String(row.updated_at) : null,
        });
    }

    const rangeStart = parseDate(startDate);
    const rangeEnd = parseDate(endDate);
    for (const row of ruleRows) {
        if (!row.active) continue;
        const ruleStart = parseDate(String(row.start_date));
        const ruleEnd = row.end_date ? parseDate(String(row.end_date)) : null;
        let current = rangeStart > ruleStart ? new Date(rangeStart) : new Date(ruleStart);
        while (current <= rangeEnd) {
            if (ruleEnd && current > ruleEnd) break;
            const day = mondayFirstDay(current);
            const weekOffset = weeksBetween(ruleStart, current);
            const date = dateString(current);
            const start = normalizeTime(row.start_time);
            const end = normalizeTime(row.end_time);
            const intervalWeeks = Math.max(1, toNumber(row.interval_weeks, 1));
            const key = `${row.class_id}:${row.id}:${date}`;
            if (day === toNumber(row.day_of_week) && weekOffset >= 0
                && weekOffset % intervalWeeks === 0 && !actualKeys.has(key)) {
                items.push({
                    id: `virtual:${String(row.id)}:${date}`,
                    actualId: null,
                    virtual: true,
                    classId: String(row.class_id),
                    className: String(row.class_name || 'Unknown class'),
                    ruleId: String(row.id),
                    date,
                    startTime: start,
                    endTime: end,
                    status: 'normal',
                    hasEnded: lessonHasEnded(date, end),
                    classroomId: row.classroom_id ? String(row.classroom_id) : null,
                    classroomOverrideId: row.classroom_override_id ? String(row.classroom_override_id) : null,
                    classroomName: row.classroom_name ? String(row.classroom_name) : null,
                    instructorId: row.instructor_id ? String(row.instructor_id) : null,
                    instructorOverrideId: row.instructor_override_id ? String(row.instructor_override_id) : null,
                    instructorName: row.instructor_name ? String(row.instructor_name) : null,
                    substituteInstructorId: null,
                    substituteInstructorName: null,
                    cancelReason: null,
                    notes: null,
                    overrideScope: null,
                    updatedAt: row.updated_at ? String(row.updated_at) : null,
                });
            }
            current = addDays(current, 1);
        }
    }

    return items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

export function classOverviewFromReadModel(value: unknown, startDate: string, endDate: string): ClassOperationsOverview {
    const ruleRows = rowsFromJson(value, 'scheduleRules');
    const occurrenceRows = rowsFromJson(value, 'occurrences');
    const classes = rowsFromJson(value, 'classes') as ClassSummary[];
    const classColors = new Map(classes.map((row) => [row.id, row.color]));
    return {
        classes,
        schedule: scheduleFromReadModel(occurrenceRows, ruleRows, startDate, endDate)
            .map((row) => ({ ...row, classColor: classColors.get(row.classId) ?? null })),
        scheduleRules: ruleRows.map((row) => ({
            id: String(row.id),
            classId: String(row.class_id),
            className: String(row.class_name || 'Unknown class'),
            dayOfWeek: toNumber(row.day_of_week),
            startTime: normalizeTime(row.start_time),
            endTime: normalizeTime(row.end_time),
            startDate: String(row.start_date),
            endDate: row.end_date ? String(row.end_date) : null,
            intervalWeeks: Math.max(1, toNumber(row.interval_weeks, 1)),
            active: Boolean(row.active),
            classroomId: row.classroom_id ? String(row.classroom_id) : null,
            classroomName: row.classroom_name ? String(row.classroom_name) : null,
            instructorId: row.instructor_id ? String(row.instructor_id) : null,
            instructorName: row.instructor_name ? String(row.instructor_name) : null,
            updatedAt: row.updated_at ? String(row.updated_at) : null,
        })),
        attendance: rowsFromJson(value, 'attendance').map((row) => ({
            id: String(row.id),
            occurrenceId: String(row.occurrence_id),
            studentId: String(row.student_id),
            studentName: String(row.student_name || 'Unknown student'),
            classId: String(row.class_id),
            className: String(row.class_name || 'Unknown class'),
            date: String(row.occurrence_date),
            startTime: normalizeTime(row.start_time),
            endTime: normalizeTime(row.end_time),
            status: row.status as AttendanceRow['status'],
            attendedMinutes: row.attended_minutes === null ? null : toNumber(row.attended_minutes),
            billableMinutes: row.billable_minutes === null ? null : toNumber(row.billable_minutes),
            notes: row.notes ? String(row.notes) : null,
            updatedAt: row.updated_at ? String(row.updated_at) : null,
        })),
        books: rowsFromJson(value, 'books') as BookSummary[],
        staff: rowsFromJson(value, 'staff').map((row) => ({
            ...row,
            phone: null,
            email: null,
        })) as StaffSummary[],
        classrooms: rowsFromJson(value, 'classrooms') as ClassroomSummary[],
        permissions: permissionsFromJson(value),
        truncated: truncationFromJson(value),
    };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

const CLASS_DIRECTORY_DATABASE_PAGE_SIZE = 500;
const CLASS_DIRECTORY_FILTER_CHUNK_SIZE = 150;

function chunks<T>(values: readonly T[], size = CLASS_DIRECTORY_FILTER_CHUNK_SIZE): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

async function loadChunkedRows(
    ids: string[],
    query: (chunk: string[]) => Promise<{ data: unknown; error: { message?: string } | null }>,
    context: string,
): Promise<Row[]> {
    const results = await Promise.all(chunks(ids).map(async (chunk) => {
        const { data, error } = await query(chunk);
        ensureNoError(error, context);
        return (data || []) as Row[];
    }));
    return results.flat();
}

function forbidden(): never {
    throw new LmsAuthError('LMS class access is not allowed.', 403);
}

async function fetchPeople(core: SchemaClient, personIds: string[]): Promise<Map<string, Row>> {
    const ids = uniqueStrings(personIds);
    if (ids.length === 0) return new Map();

    const data = await loadChunkedRows(
        ids,
        async (chunk) => await core
            .from('people')
            .select('id,full_name,display_name,email,phone,parent_name,parent_phone')
            .in('id', chunk),
        'Failed to load people',
    );

    return new Map(data.map((person) => [person.id, person]));
}

async function fetchClassNames(core: SchemaClient, classIds: string[]): Promise<Map<string, string>> {
    const ids = uniqueStrings(classIds);
    if (ids.length === 0) return new Map();

    const { data, error } = await core
        .from('classes')
        .select('id,name')
        .in('id', ids);
    ensureNoError(error, 'Failed to load class names');

    return new Map(((data || []) as Row[]).map((row) => [row.id, row.name]));
}

async function fetchStaffPeople(core: SchemaClient, staffRows: Row[]): Promise<Map<string, string>> {
    const people = await fetchPeople(core, staffRows.map((row) => row.person_id));
    const names = new Map<string, string>();
    for (const staff of staffRows) {
        const person = people.get(staff.person_id);
        names.set(staff.id, person?.display_name || person?.full_name || 'Unknown staff');
    }
    return names;
}

async function loadActiveStaffId(core: SchemaClient, context: LmsRoleContext): Promise<string> {
    const { data, error } = await core
        .from('staff_members')
        .select('id')
        .eq('academy_id', context.academyId)
        .eq('person_id', context.personId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
    ensureNoError(error, 'Failed to load actor staff member');

    const staffId = (data as Row | null)?.id;
    if (typeof staffId !== 'string' || staffId.length === 0) forbidden();
    return staffId;
}

async function loadAssignedClassIds(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    staffMemberId: string,
): Promise<Set<string>> {
    const currentDate = toSeoulDate(new Date());
    const [assignmentsResult, profilesResult] = await Promise.all([
        lms
            .from('class_instructors')
            .select('class_id')
            .eq('academy_id', academyId)
            .eq('instructor_staff_id', staffMemberId)
            .eq('active', true)
            .lte('started_on', currentDate)
            .or(`ended_on.is.null,ended_on.gte.${currentDate}`),
        lms
            .from('class_profiles')
            .select('class_id')
            .eq('academy_id', academyId)
            .eq('status', 'active')
            .eq('default_instructor_staff_id', staffMemberId),
    ]);

    ensureNoError(assignmentsResult.error, 'Failed to load class instructor assignments');
    ensureNoError(profilesResult.error, 'Failed to load assigned class profiles');
    const candidateIds = uniqueStrings([
        ...((assignmentsResult.data || []) as Row[]).map((row) => row.class_id),
        ...((profilesResult.data || []) as Row[]).map((row) => row.class_id),
    ]);
    if (candidateIds.length === 0) return new Set();

    const { data: classes, error: classesError } = await core
        .from('classes')
        .select('id')
        .eq('academy_id', academyId)
        .eq('active', true)
        .in('id', candidateIds);
    ensureNoError(classesError, 'Failed to validate active assigned classes');
    return new Set(((classes || []) as Row[]).map((row) => String(row.id)));
}

type OccurrenceStatusScope = {
    occurrenceIds: Set<string>;
    classIds: Set<string>;
};

async function loadOccurrenceStatusScope(
    lms: SchemaClient,
    academyId: string,
    staffMemberId: string,
    startDate: string,
    endDate: string,
): Promise<OccurrenceStatusScope> {
    const [legacyResult, participantResult] = await Promise.all([
        lms
            .from('lesson_occurrences')
            .select('id,class_id')
            .eq('academy_id', academyId)
            .gte('occurrence_date', startDate)
            .lte('occurrence_date', endDate)
            .or(`instructor_staff_id.eq.${staffMemberId},substitute_staff_id.eq.${staffMemberId}`),
        lms
            .from('lesson_occurrence_instructors')
            .select('occurrence_id')
            .eq('academy_id', academyId)
            .eq('instructor_staff_id', staffMemberId)
            .limit(5000),
    ]);
    ensureNoError(legacyResult.error, 'Failed to load legacy lesson participation');
    ensureNoError(participantResult.error, 'Failed to load lesson participation');

    const participantOccurrenceIds = uniqueStrings(
        ((participantResult.data || []) as Row[]).map((row) => row.occurrence_id),
    );
    const participantOccurrences = participantOccurrenceIds.length > 0
        ? await loadChunkedRows(
            participantOccurrenceIds,
            async (chunk) => await lms
                .from('lesson_occurrences')
                .select('id,class_id')
                .eq('academy_id', academyId)
                .gte('occurrence_date', startDate)
                .lte('occurrence_date', endDate)
                .in('id', chunk),
            'Failed to load participated lesson occurrences',
        )
        : [];
    const rows = [
        ...((legacyResult.data || []) as Row[]),
        ...participantOccurrences,
    ];
    return {
        occurrenceIds: new Set(rows.map((row) => String(row.id))),
        classIds: new Set(rows.map((row) => String(row.class_id))),
    };
}

export async function loadAssignedClassIdsForContext(context: LmsRoleContext): Promise<Set<string> | null> {
    if (!requiresAssignedClassScope(context.role)) return null;

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const staffMemberId = await loadActiveStaffId(core, context);
    return loadAssignedClassIds(core, lms, context.academyId, staffMemberId);
}

async function assertClassBelongsToAcademy(core: SchemaClient, academyId: string, classId: string): Promise<void> {
    const { data, error } = await core
        .from('classes')
        .select('id')
        .eq('academy_id', academyId)
        .eq('id', classId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify class');
    if (!(data as Row | null)?.id) forbidden();
}

async function loadStaff(core: SchemaClient, academyId: string): Promise<StaffSummary[]> {
    const { data, error } = await core
        .from('staff_members')
        .select('id,person_id,role,status,hourly_rate')
        .eq('academy_id', academyId)
        .in('role', STAFF_ROLES)
        .order('created_at', { ascending: false });
    ensureNoError(error, 'Failed to load staff');

    const staff = (data || []) as Row[];
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

async function loadClassSummaries(
    core: SchemaClient,
    lms: SchemaClient,
    reporting: SchemaClient,
    academyId: string,
    includeLearningMetrics = true,
): Promise<ClassSummary[]> {
    const classes: Row[] = [];
    for (let from = 0; ; from += CLASS_DIRECTORY_DATABASE_PAGE_SIZE) {
        const { data, error } = await core
            .from('classes')
            .select('id,name,grade,active')
            .eq('academy_id', academyId)
            .order('name')
            .order('id')
            .range(from, from + CLASS_DIRECTORY_DATABASE_PAGE_SIZE - 1);
        ensureNoError(error, 'Failed to load classes');
        const page = (data || []) as Row[];
        classes.push(...page);
        if (page.length < CLASS_DIRECTORY_DATABASE_PAGE_SIZE) break;
    }
    if (classes.length === 0) return [];

    const classIds = classes.map((row) => row.id);
    const [
        profilesData,
        classStudentsData,
        learningData,
        { data: coursesData, error: coursesError },
        { data: classroomsData, error: classroomsError },
        { data: staffData, error: staffError },
    ] = await Promise.all([
        loadChunkedRows(classIds, async (ids) => await lms.from('class_profiles').select('class_id,status,color,capacity,default_instructor_staff_id,default_classroom_id,course_id,notes').eq('academy_id', academyId).in('class_id', ids), 'Failed to load class profiles'),
        loadChunkedRows(classIds, async (ids) => await core.from('class_students').select('class_id,student_id,status').in('class_id', ids), 'Failed to load class enrollments'),
        includeLearningMetrics
            ? loadChunkedRows(classIds, async (ids) => await reporting.from('v_class_learning_summary').select('class_id,weak_type_count,avg_type_score,last_learning_at').eq('academy_id', academyId).in('class_id', ids), 'Failed to load class learning summary')
            : Promise.resolve([]),
        lms.from('courses').select('id,title').eq('academy_id', academyId),
        lms.from('classrooms').select('id,name').eq('academy_id', academyId),
        core.from('staff_members').select('id,person_id').eq('academy_id', academyId),
    ]);

    for (const [error, context] of [
        [coursesError, 'Failed to load courses'],
        [classroomsError, 'Failed to load classrooms'],
        [staffError, 'Failed to load staff people'],
    ] as const) {
        ensureNoError(error, context);
    }

    const profiles = new Map(profilesData.map((row) => [row.class_id, row]));
    const courses = new Map(((coursesData || []) as Row[]).map((row) => [row.id, row.title]));
    const classrooms = new Map(((classroomsData || []) as Row[]).map((row) => [row.id, row.name]));
    const staffNames = await fetchStaffPeople(core, (staffData || []) as Row[]);
    const learning = new Map(learningData.map((row) => [row.class_id, row]));
    const studentCounts = new Map<string, number>();

    for (const enrollment of classStudentsData) {
        if (enrollment.status !== 'active') continue;
        studentCounts.set(enrollment.class_id, (studentCounts.get(enrollment.class_id) || 0) + 1);
    }

    return classes.map((row) => {
        const profile = profiles.get(row.id);
        const summary = learning.get(row.id);
        return {
            id: row.id,
            name: row.name,
            grade: row.grade ?? null,
            active: row.active,
            status: profile?.status || (row.active ? 'active' : 'inactive'),
            color: profile?.color ?? null,
            capacity: profile?.capacity ?? null,
            defaultInstructorId: profile?.default_instructor_staff_id ?? null,
            defaultClassroomId: profile?.default_classroom_id ?? null,
            courseId: profile?.course_id ?? null,
            courseTitle: profile?.course_id ? courses.get(profile.course_id) ?? null : null,
            instructorName: profile?.default_instructor_staff_id ? staffNames.get(profile.default_instructor_staff_id) ?? null : null,
            classroomName: profile?.default_classroom_id ? classrooms.get(profile.default_classroom_id) ?? null : null,
            studentCount: studentCounts.get(row.id) || 0,
            weakTypeCount: toNumber(summary?.weak_type_count),
            avgTypeScore: summary?.avg_type_score === null || summary?.avg_type_score === undefined
                ? null
                : Number(summary.avg_type_score),
            lastLearningAt: summary?.last_learning_at ?? null,
            notes: profile?.notes ?? null,
        };
    });
}

export async function loadClassSummariesForContext(
    context: LmsRoleContext,
    options: { includeLearningMetrics?: boolean } = {},
): Promise<ClassSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');
    const classes = await loadClassSummaries(
        core,
        lms,
        reporting,
        context.academyId,
        options.includeLearningMetrics !== false,
    );

    if (!requiresAssignedClassScope(context.role)) return classes;

    const staffMemberId = await loadActiveStaffId(core, context);
    const assignedClassIds = await loadAssignedClassIds(core, lms, context.academyId, staffMemberId);
    return classes.filter((row) => assignedClassIds.has(row.id));
}

type OptionalClassTaxonomy = {
    subjects: Map<string, { id: string; name: string }>;
    subjectIdByClass: Map<string, string>;
    targetGradesByClass: Map<string, string[]>;
    primaryGradeByClass: Map<string, string>;
    instructorsByClass: Map<string, Array<{ id: string; name: string }>>;
};

function isMissingOptionalTaxonomy(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code || '')
        || /does not exist|could not find/i.test(error.message || '');
}

async function loadOptionalClassTaxonomy(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    classIds: string[],
): Promise<OptionalClassTaxonomy> {
    const empty: OptionalClassTaxonomy = {
        subjects: new Map(),
        subjectIdByClass: new Map(),
        targetGradesByClass: new Map(),
        primaryGradeByClass: new Map(),
        instructorsByClass: new Map(),
    };
    const profileRows: Row[] = [];
    for (const classIdChunk of chunks(classIds)) {
        const profileResult = await lms
            .from('class_profiles')
            .select('class_id,subject_id,course_id')
            .eq('academy_id', academyId)
            .in('class_id', classIdChunk);
        if (!profileResult.error) {
            profileRows.push(...(profileResult.data || []) as Row[]);
            continue;
        }
        if (!isMissingOptionalTaxonomy(profileResult.error)) {
            ensureNoError(profileResult.error, 'Failed to load class subjects');
        }
        const legacyProfiles = await lms
            .from('class_profiles')
            .select('class_id,course_id')
            .eq('academy_id', academyId)
            .in('class_id', classIdChunk);
        ensureNoError(legacyProfiles.error, 'Failed to load legacy class courses');
        profileRows.push(...(legacyProfiles.data || []) as Row[]);
    }

    const courseIds = uniqueStrings(profileRows.map((row) => row.course_id));
    const subjectIdByCourse = new Map<string, string>();
    for (const courseIdChunk of chunks(courseIds)) {
        const courseResult = await lms
            .from('courses')
            .select('id,subject_id')
            .eq('academy_id', academyId)
            .in('id', courseIdChunk);
        if (courseResult.error && !isMissingOptionalTaxonomy(courseResult.error)) {
            ensureNoError(courseResult.error, 'Failed to load course subjects');
        }
        for (const row of (courseResult.error ? [] : courseResult.data || []) as Row[]) {
            if (row.subject_id) subjectIdByCourse.set(String(row.id), String(row.subject_id));
        }
    }

    for (const row of profileRows) {
        const subjectId = row.subject_id || (row.course_id ? subjectIdByCourse.get(String(row.course_id)) : null);
        if (subjectId) empty.subjectIdByClass.set(String(row.class_id), String(subjectId));
    }

    const subjectResult = await lms
        .from('subjects')
        .select('id,name')
        .eq('academy_id', academyId)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
    if (subjectResult.error && !isMissingOptionalTaxonomy(subjectResult.error)) {
        ensureNoError(subjectResult.error, 'Failed to load subjects');
    }
    for (const row of (subjectResult.error ? [] : subjectResult.data || []) as Row[]) {
        empty.subjects.set(String(row.id), { id: String(row.id), name: String(row.name) });
    }

    const gradeRows: Row[] = [];
    for (const classIdChunk of chunks(classIds)) {
        const gradeResult = await lms
            .from('class_target_grades')
            .select('class_id,grade_code,is_primary,sort_order')
            .eq('academy_id', academyId)
            .in('class_id', classIdChunk)
            .order('sort_order', { ascending: true });
        if (gradeResult.error && !isMissingOptionalTaxonomy(gradeResult.error)) {
            ensureNoError(gradeResult.error, 'Failed to load class target grades');
        }
        gradeRows.push(...(gradeResult.error ? [] : gradeResult.data || []) as Row[]);
    }
    for (const row of gradeRows) {
        const classId = String(row.class_id);
        const gradeCode = String(row.grade_code || '');
        if (!gradeCode) continue;
        const grades = empty.targetGradesByClass.get(classId) || [];
        if (!grades.includes(gradeCode)) grades.push(gradeCode);
        empty.targetGradesByClass.set(classId, grades);
        if (row.is_primary === true) empty.primaryGradeByClass.set(classId, gradeCode);
    }

    const instructorRows: Row[] = [];
    for (const classIdChunk of chunks(classIds)) {
        const instructorResult = await lms
            .from('class_instructors')
            .select('class_id,instructor_staff_id')
            .eq('academy_id', academyId)
            .eq('active', true)
            .in('class_id', classIdChunk);
        if (instructorResult.error && !isMissingOptionalTaxonomy(instructorResult.error)) {
            ensureNoError(instructorResult.error, 'Failed to load class instructors');
        }
        instructorRows.push(...(instructorResult.error ? [] : instructorResult.data || []) as Row[]);
    }
    const instructorIds = uniqueStrings(instructorRows.map((row) => row.instructor_staff_id));
    let instructorNames = new Map<string, string>();
    if (instructorIds.length > 0) {
        const staffRows = await loadChunkedRows(
            instructorIds,
            async (ids) => await core.from('staff_members').select('id,person_id').eq('academy_id', academyId).in('id', ids),
            'Failed to load directory instructor names',
        );
        instructorNames = await fetchStaffPeople(core, staffRows);
    }
    for (const row of instructorRows) {
        const classId = String(row.class_id);
        const instructorId = String(row.instructor_staff_id);
        const instructors = empty.instructorsByClass.get(classId) || [];
        if (!instructors.some((item) => item.id === instructorId)) {
            instructors.push({ id: instructorId, name: instructorNames.get(instructorId) || '이름 미확인' });
        }
        empty.instructorsByClass.set(classId, instructors);
    }

    return empty;
}

async function loadClassDirectoryLegacy(
    context: LmsRoleContext,
    query: ClassDirectoryQuery,
    options: { limit?: number; classId?: string | null } = {},
): Promise<ClassDirectoryPage> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const baseClasses = await loadClassSummariesForContext(context, { includeLearningMetrics: false });
    const taxonomy = await loadOptionalClassTaxonomy(
        core,
        lms,
        context.academyId,
        baseClasses.map((row) => row.id),
    );
    const classes = baseClasses.map((row) => {
        const subjectId = taxonomy.subjectIdByClass.get(row.id) || null;
        const subject = subjectId ? taxonomy.subjects.get(subjectId) : null;
        const targetGrades = taxonomy.targetGradesByClass.get(row.id) || (row.grade ? [row.grade] : []);
        const normalizedInstructors = taxonomy.instructorsByClass.get(row.id) || [];
        const instructors = normalizedInstructors.length > 0
            ? normalizedInstructors
            : row.defaultInstructorId && row.instructorName
                ? [{ id: row.defaultInstructorId, name: row.instructorName }]
                : [];
        return {
            ...row,
            subjectId,
            subjectName: subject?.name || null,
            targetGrades,
            primaryTargetGrade: taxonomy.primaryGradeByClass.get(row.id) || targetGrades[0] || row.grade || null,
            instructors,
            instructorIds: instructors.map((item) => item.id),
        } satisfies ClassSummary;
    });

    const scoped = options.classId
        ? classes.filter((row) => row.id === options.classId)
        : classes.filter((row) => classMatchesDirectoryQuery(row, query));
    const sorted = [...scoped].sort(compareClassDirectoryRows);
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 60)));
    const cursor = options.classId ? null : decodeClassDirectoryCursor(query.cursor);
    const cursorIndex = cursor
        ? sorted.findIndex((row) => row.id === cursor.id && row.name === cursor.name)
        : -1;
    const offset = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageRows = sorted.slice(offset, offset + limit);
    const hasMore = offset + pageRows.length < sorted.length;

    const subjectFacets = facetOptions(classes.map((row) => ({
        value: row.subjectId || row.subjectName || null,
        label: row.subjectName || null,
    })));
    const subjectFacetValues = new Set(subjectFacets.map((item) => item.value));
    for (const subject of taxonomy.subjects.values()) {
        if (!subjectFacetValues.has(subject.id)) {
            subjectFacets.push({ value: subject.id, label: subject.name, count: 0 });
        }
    }
    subjectFacets.sort((left, right) => left.label.localeCompare(right.label, 'ko-KR'));

    return {
        classes: pageRows,
        facets: {
            grades: facetOptions(classes.flatMap((row) => (
                (row.targetGrades?.length ? row.targetGrades : row.grade ? [row.grade] : [])
                    .map((grade) => ({ value: grade }))
            ))),
            subjects: subjectFacets,
            instructors: facetOptions(classes.flatMap((row) => (
                (row.instructors?.length
                    ? row.instructors
                    : row.defaultInstructorId && row.instructorName
                        ? [{ id: row.defaultInstructorId, name: row.instructorName }]
                        : [])
                    .map((instructor) => ({ value: instructor.id, label: instructor.name }))
            ))),
            statuses: facetOptions(classes.map((row) => ({ value: row.status }))),
        },
        nextCursor: hasMore && pageRows.length > 0
            ? encodeClassDirectoryCursor({
                name: pageRows[pageRows.length - 1].name,
                id: pageRows[pageRows.length - 1].id,
            })
            : null,
        hasMore,
        totalCount: sorted.length,
    };
}

function permissionsFromJson(value: unknown): ClassOperationsPermissions {
    const raw = value && typeof value === 'object' && (value as Row).permissions;
    const row = raw && typeof raw === 'object' ? raw as Row : {};
    return {
        canCreateClass: row.canCreateClass === true,
        canManageGlobalResources: row.canManageGlobalResources === true,
        operatorClassIds: uniqueStrings(Array.isArray(row.operatorClassIds) ? row.operatorClassIds : []),
        occurrenceStatusIds: uniqueStrings(Array.isArray(row.occurrenceStatusIds) ? row.occurrenceStatusIds : []),
    };
}

function classDirectoryPageFromReadModel(data: unknown): ClassDirectoryPage {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Class directory returned an invalid response.');
    }
    const payload = data as Record<string, unknown>;
    const facets = payload.facets && typeof payload.facets === 'object' && !Array.isArray(payload.facets)
        ? payload.facets as Record<string, unknown>
        : {};
    const next = payload.nextCursor && typeof payload.nextCursor === 'object' && !Array.isArray(payload.nextCursor)
        ? payload.nextCursor as Record<string, unknown>
        : null;
    const nextCursor = typeof next?.name === 'string' && typeof next.id === 'string'
        ? encodeClassDirectoryCursor({ name: next.name, id: next.id })
        : null;

    return {
        classes: Array.isArray(payload.classes) ? payload.classes as ClassSummary[] : [],
        facets: {
            grades: Array.isArray(facets.grades) ? facets.grades as ClassDirectoryPage['facets']['grades'] : [],
            subjects: Array.isArray(facets.subjects) ? facets.subjects as ClassDirectoryPage['facets']['subjects'] : [],
            instructors: Array.isArray(facets.instructors) ? facets.instructors as ClassDirectoryPage['facets']['instructors'] : [],
            statuses: Array.isArray(facets.statuses) ? facets.statuses as ClassDirectoryPage['facets']['statuses'] : [],
        },
        nextCursor,
        hasMore: payload.hasMore === true,
        totalCount: Math.max(0, toNumber(payload.totalCount)),
    };
}

export async function loadClassDirectory(
    context: LmsRoleContext,
    query: ClassDirectoryQuery,
    options: { limit?: number; classId?: string | null } = {},
): Promise<ClassDirectoryPage> {
    // The detail lookup is deliberately direct and unpaginated. The directory
    // itself always uses the database keyset read model below.
    if (options.classId) {
        return loadClassDirectoryLegacy(context, query, options);
    }

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const cursor = decodeClassDirectoryCursor(query.cursor);
    let allowedClassIds: string[] | null = null;
    if (requiresAssignedClassScope(context.role)) {
        const staffMemberId = await loadActiveStaffId(core, context);
        allowedClassIds = [...await loadAssignedClassIds(core, lms, context.academyId, staffMemberId)];
    }

    const { data, error } = await lms.rpc('class_directory_v1', {
        p_academy_id: context.academyId,
        p_q: query.q || null,
        p_grade: query.grade || null,
        p_subject: query.subject || null,
        p_instructor: query.instructor || null,
        p_status: query.status || 'active',
        p_cursor_name: cursor?.name || null,
        p_cursor_id: cursor?.id || null,
        p_limit: Math.min(100, Math.max(1, Math.floor(options.limit || 60))),
        p_class_ids: allowedClassIds,
    });
    if (error) {
        if (isMissingReadModel(error)) {
            return loadClassDirectoryLegacy(context, query, options);
        }
        ensureNoError(error, 'Failed to load class directory');
    }
    return classDirectoryPageFromReadModel(data);
}

export async function loadClassOptionsForContext(context: LmsRoleContext): Promise<ClassSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    let allowedClassIds: Set<string> | null = null;

    if (requiresAssignedClassScope(context.role)) {
        const staffMemberId = await loadActiveStaffId(core, context);
        allowedClassIds = await loadAssignedClassIds(core, lms, context.academyId, staffMemberId);
        if (allowedClassIds.size === 0) return [];
    }

    let query = core
        .from('classes')
        .select('id,name,grade,active')
        .eq('academy_id', context.academyId)
        .order('name');

    if (allowedClassIds) {
        query = query.in('id', [...allowedClassIds]);
    }

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load class options');

    return ((data || []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
        grade: row.grade ?? null,
        active: Boolean(row.active),
        status: row.active ? 'active' : 'inactive',
        color: null,
        capacity: null,
        defaultInstructorId: null,
        defaultClassroomId: null,
        courseTitle: null,
        instructorName: null,
        classroomName: null,
        studentCount: 0,
        weakTypeCount: 0,
        avgTypeScore: null,
        lastLearningAt: null,
    }));
}

export async function loadSchedule(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    startDate: string,
    endDate: string,
): Promise<ScheduleItem[]> {
    const [
        { data: classesData, error: classesError },
        { data: profilesData, error: profilesError },
        { data: rulesData, error: rulesError },
        { data: occurrencesData, error: occurrencesError },
        { data: classroomsData, error: classroomsError },
        { data: staffData, error: staffError },
        { data: ruleParticipantsData, error: ruleParticipantsError },
        { data: occurrenceParticipantsData, error: occurrenceParticipantsError },
    ] = await Promise.all([
        core.from('classes').select('id,name').eq('academy_id', academyId),
        lms.from('class_profiles').select('class_id,default_instructor_staff_id,default_classroom_id,color').eq('academy_id', academyId),
        lms.from('class_schedule_rules').select('id,class_id,day_of_week,start_time,end_time,start_date,end_date,active,classroom_id,instructor_staff_id,interval_weeks,updated_at').eq('academy_id', academyId).eq('active', true),
        lms.from('lesson_occurrences').select('id,class_id,rule_id,occurrence_date,start_time,end_time,status,classroom_id,substitute_staff_id,instructor_staff_id,cancel_reason,notes,override_scope,updated_at').eq('academy_id', academyId).gte('occurrence_date', startDate).lte('occurrence_date', endDate),
        lms.from('classrooms').select('id,name').eq('academy_id', academyId),
        core.from('staff_members').select('id,person_id').eq('academy_id', academyId),
        lms.from('class_schedule_rule_instructors').select('rule_id,instructor_staff_id,sort_order').eq('academy_id', academyId).eq('active', true),
        lms.from('lesson_occurrence_instructors').select('occurrence_id,instructor_staff_id,participation_kind,payable_minutes,replaces_staff_id').eq('academy_id', academyId),
    ]);

    for (const [error, context] of [
        [classesError, 'Failed to load schedule classes'],
        [profilesError, 'Failed to load schedule profiles'],
        [rulesError, 'Failed to load schedule rules'],
        [occurrencesError, 'Failed to load lesson occurrences'],
        [classroomsError, 'Failed to load schedule classrooms'],
        [staffError, 'Failed to load schedule staff'],
        [ruleParticipantsError, 'Failed to load schedule rule participants'],
        [occurrenceParticipantsError, 'Failed to load lesson participants'],
    ] as const) {
        ensureNoError(error, context);
    }

    const classes = new Map(((classesData || []) as Row[]).map((row) => [row.id, row.name]));
    const profiles = new Map(((profilesData || []) as Row[]).map((row) => [row.class_id, row]));
    const classrooms = new Map(((classroomsData || []) as Row[]).map((row) => [row.id, row.name]));
    const staffNames = await fetchStaffPeople(core, (staffData || []) as Row[]);
    const ruleParticipants = new Map<string, Row[]>();
    for (const participant of (ruleParticipantsData || []) as Row[]) {
        const rows = ruleParticipants.get(String(participant.rule_id)) || [];
        rows.push(participant);
        ruleParticipants.set(String(participant.rule_id), rows);
    }
    for (const rows of ruleParticipants.values()) {
        rows.sort((left, right) => toNumber(left.sort_order) - toNumber(right.sort_order));
    }
    const occurrenceParticipants = new Map<string, Row[]>();
    for (const participant of (occurrenceParticipantsData || []) as Row[]) {
        const rows = occurrenceParticipants.get(String(participant.occurrence_id)) || [];
        rows.push(participant);
        occurrenceParticipants.set(String(participant.occurrence_id), rows);
    }
    const items: ScheduleItem[] = [];
    const actualKeys = new Set<string>();

    for (const row of (occurrencesData || []) as Row[]) {
        const date = String(row.occurrence_date);
        const start = normalizeTime(row.start_time);
        const end = normalizeTime(row.end_time);
        if (row.rule_id) actualKeys.add(`${row.class_id}:${row.rule_id}:${row.occurrence_date}`);
        if (row.cancel_reason === SCHEDULE_DELETED_MARKER) continue;
        const profile = profiles.get(row.class_id);
        const legacyInstructorId = row.substitute_staff_id || row.instructor_staff_id || profile?.default_instructor_staff_id;
        const participantRows = occurrenceParticipants.get(String(row.id)) || [];
        const inheritedRuleParticipantRows = row.rule_id
            && !row.override_scope
            && !row.substitute_staff_id
            && !row.instructor_staff_id
            ? ruleParticipants.get(String(row.rule_id)) || []
            : [];
        const instructors = participantRows.length > 0
            ? participantRows.map((participant) => ({
                instructorId: String(participant.instructor_staff_id),
                instructorName: staffNames.get(String(participant.instructor_staff_id)) ?? null,
                participationKind: participant.participation_kind || 'regular',
                payableMinutes: toNumber(participant.payable_minutes),
                replacesInstructorId: participant.replaces_staff_id ?? null,
            }))
            : inheritedRuleParticipantRows.length > 0
                ? inheritedRuleParticipantRows.map((participant) => ({
                    instructorId: String(participant.instructor_staff_id),
                    instructorName: staffNames.get(String(participant.instructor_staff_id)) ?? null,
                    participationKind: row.status === 'makeup' ? 'makeup' as const : 'regular' as const,
                    payableMinutes: row.status === 'cancelled' ? 0 : scheduleMinutes(start, end),
                    replacesInstructorId: null,
                }))
                : legacyInstructorId
                    ? [{
                        instructorId: String(legacyInstructorId),
                        instructorName: staffNames.get(String(legacyInstructorId)) ?? null,
                        participationKind: row.substitute_staff_id ? 'substitute' as const : 'regular' as const,
                        payableMinutes: row.status === 'cancelled' ? 0 : scheduleMinutes(start, end),
                        replacesInstructorId: row.substitute_staff_id ? row.instructor_staff_id ?? null : null,
                    }]
                    : [];
        const instructorId = instructors[0]?.instructorId || null;
        const classroomId = row.classroom_id || profile?.default_classroom_id;
        items.push({
            id: row.id,
            actualId: row.id,
            virtual: false,
            classId: row.class_id,
            className: classes.get(row.class_id) || 'Unknown class',
            classColor: profile?.color ?? null,
            ruleId: row.rule_id ?? null,
            date,
            startTime: start,
            endTime: end,
            status: normalizeLessonOccurrenceStatus(row.status),
            hasEnded: lessonHasEnded(date, end),
            classroomId: classroomId ?? null,
            classroomOverrideId: row.classroom_id ?? null,
            classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
            instructorId: instructorId ?? null,
            instructorOverrideId: row.instructor_staff_id ?? null,
            instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
            instructors,
            substituteInstructorId: row.substitute_staff_id ?? null,
            substituteInstructorName: row.substitute_staff_id ? staffNames.get(row.substitute_staff_id) ?? null : null,
            cancelReason: row.cancel_reason ?? null,
            notes: row.notes ?? null,
            overrideScope: row.override_scope ?? null,
            updatedAt: row.updated_at ?? null,
        });
    }

    const rangeStart = parseDate(startDate);
    const rangeEnd = parseDate(endDate);
    for (const rule of (rulesData || []) as Row[]) {
        const ruleStart = parseDate(rule.start_date);
        const ruleEnd = rule.end_date ? parseDate(rule.end_date) : null;
        let current = rangeStart > ruleStart ? new Date(rangeStart) : new Date(ruleStart);

        while (current <= rangeEnd) {
            if (ruleEnd && current > ruleEnd) break;
            const day = mondayFirstDay(current);
            const weekOffset = weeksBetween(ruleStart, current);
            const date = dateString(current);
            const start = normalizeTime(rule.start_time);
            const end = normalizeTime(rule.end_time);
            const key = `${rule.class_id}:${rule.id}:${date}`;
            if (day === rule.day_of_week && weekOffset >= 0 && weekOffset % rule.interval_weeks === 0 && !actualKeys.has(key)) {
                const profile = profiles.get(rule.class_id);
                const classroomId = rule.classroom_id || profile?.default_classroom_id;
                const legacyInstructorId = rule.instructor_staff_id || profile?.default_instructor_staff_id;
                const participantRows = ruleParticipants.get(String(rule.id)) || [];
                const instructors = participantRows.length > 0
                    ? participantRows.map((participant) => ({
                        instructorId: String(participant.instructor_staff_id),
                        instructorName: staffNames.get(String(participant.instructor_staff_id)) ?? null,
                        participationKind: 'regular' as const,
                        payableMinutes: scheduleMinutes(start, end),
                        replacesInstructorId: null,
                    }))
                    : legacyInstructorId
                        ? [{
                            instructorId: String(legacyInstructorId),
                            instructorName: staffNames.get(String(legacyInstructorId)) ?? null,
                            participationKind: 'regular' as const,
                            payableMinutes: scheduleMinutes(start, end),
                            replacesInstructorId: null,
                        }]
                        : [];
                const instructorId = instructors[0]?.instructorId || null;
                items.push({
                    id: `virtual:${rule.id}:${date}`,
                    actualId: null,
                    virtual: true,
                    classId: rule.class_id,
                    className: classes.get(rule.class_id) || 'Unknown class',
                    classColor: profile?.color ?? null,
                    ruleId: rule.id,
                    date,
                    startTime: start,
                    endTime: end,
                    status: 'normal',
                    hasEnded: lessonHasEnded(date, end),
                    classroomId: classroomId ?? null,
                    classroomOverrideId: rule.classroom_id ?? null,
                    classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
                    instructorId: instructorId ?? null,
                    instructorOverrideId: rule.instructor_staff_id ?? null,
                    instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
                    instructors,
                    substituteInstructorId: null,
                    substituteInstructorName: null,
                    cancelReason: null,
                    notes: null,
                    overrideScope: null,
                    updatedAt: rule.updated_at ?? null,
                });
            }
            current = addDays(current, 1);
        }
    }

    return items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

async function loadScheduleRules(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    classId?: string,
): Promise<ScheduleRuleSummary[]> {
    let query = lms
        .from('class_schedule_rules')
        .select('id,class_id,day_of_week,start_time,end_time,start_date,end_date,active,classroom_id,instructor_staff_id,interval_weeks,updated_at')
        .eq('academy_id', academyId)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

    if (classId) {
        query = query.eq('class_id', classId);
    }

    const { data, error } = await query;
    ensureNoError(error, 'Failed to load schedule rules');

    const rows = (data || []) as Row[];
    if (rows.length === 0) return [];

    const ruleIds = rows.map((row) => String(row.id));
    const classIds = uniqueStrings(rows.map((row) => row.class_id));
    const classroomIds = uniqueStrings(rows.map((row) => row.classroom_id));
    const staffIds = uniqueStrings(rows.map((row) => row.instructor_staff_id));

    const [classNames, classroomsResult, ruleParticipantsResult] = await Promise.all([
        fetchClassNames(core, classIds),
        classroomIds.length > 0
            ? lms.from('classrooms').select('id,name').eq('academy_id', academyId).in('id', classroomIds)
            : Promise.resolve({ data: [], error: null }),
        lms.from('class_schedule_rule_instructors')
            .select('rule_id,instructor_staff_id,sort_order')
            .eq('academy_id', academyId)
            .eq('active', true)
            .in('rule_id', ruleIds),
    ]);

    ensureNoError(classroomsResult.error, 'Failed to load rule classrooms');
    ensureNoError(ruleParticipantsResult.error, 'Failed to load rule participants');

    const participantRows = (ruleParticipantsResult.data || []) as Row[];
    const participantStaffIds = uniqueStrings(participantRows.map((row) => row.instructor_staff_id));
    const allStaffIds = uniqueStrings([...staffIds, ...participantStaffIds]);
    const staffResult = allStaffIds.length > 0
        ? await core.from('staff_members').select('id,person_id').eq('academy_id', academyId).in('id', allStaffIds)
        : { data: [], error: null };
    ensureNoError(staffResult.error, 'Failed to load rule staff');

    const classroomMap = new Map(((classroomsResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const staffNames = await fetchStaffPeople(core, (staffResult.data || []) as Row[]);
    const participantsByRule = new Map<string, Row[]>();
    for (const participant of participantRows) {
        const participantList = participantsByRule.get(String(participant.rule_id)) || [];
        participantList.push(participant);
        participantsByRule.set(String(participant.rule_id), participantList);
    }
    for (const participantList of participantsByRule.values()) {
        participantList.sort((left, right) => toNumber(left.sort_order) - toNumber(right.sort_order));
    }

    return rows.map((row) => {
        const participantList = participantsByRule.get(String(row.id)) || [];
        const instructors = participantList.length > 0
            ? participantList.map((participant) => ({
                instructorId: String(participant.instructor_staff_id),
                instructorName: staffNames.get(String(participant.instructor_staff_id)) ?? null,
                participationKind: 'regular' as const,
                payableMinutes: scheduleMinutes(normalizeTime(row.start_time), normalizeTime(row.end_time)),
                replacesInstructorId: null,
            }))
            : row.instructor_staff_id
                ? [{
                    instructorId: String(row.instructor_staff_id),
                    instructorName: staffNames.get(String(row.instructor_staff_id)) ?? null,
                    participationKind: 'regular' as const,
                    payableMinutes: scheduleMinutes(normalizeTime(row.start_time), normalizeTime(row.end_time)),
                    replacesInstructorId: null,
                }]
                : [];
        return ({
        id: row.id,
        classId: row.class_id,
        className: classNames.get(row.class_id) || 'Unknown class',
        dayOfWeek: Number(row.day_of_week),
        startTime: normalizeTime(row.start_time),
        endTime: normalizeTime(row.end_time),
        startDate: row.start_date,
        endDate: row.end_date ?? null,
        intervalWeeks: Math.max(1, toNumber(row.interval_weeks, 1)),
        active: Boolean(row.active),
        classroomId: row.classroom_id ?? null,
        classroomName: row.classroom_id ? classroomMap.get(row.classroom_id) ?? null : null,
        instructorId: instructors[0]?.instructorId || null,
        instructorName: instructors[0]?.instructorName || null,
        instructors,
        updatedAt: row.updated_at ?? null,
        });
    });
}

async function loadBooks(content: SchemaClient, academyId: string): Promise<BookSummary[]> {
    const { data, error } = await content
        .from('books')
        .select('id,book_key,title,subject,grade,metadata')
        .or(`academy_id.is.null,academy_id.eq.${academyId}`)
        .order('title');
    ensureNoError(error, 'Failed to load books');

    return ((data || []) as Row[])
        .filter((row) => row.metadata?.visibility !== 'assignment_hidden')
        .map((row) => ({
        id: row.id,
        bookKey: row.book_key,
        title: row.title,
        subject: row.subject ?? null,
        grade: row.grade ?? null,
    }));
}

async function loadClassrooms(lms: SchemaClient, academyId: string): Promise<ClassroomSummary[]> {
    const { data, error } = await lms
        .from('classrooms')
        .select('id,name,capacity,color,active')
        .eq('academy_id', academyId)
        .order('name');
    ensureNoError(error, 'Failed to load classrooms');

    return ((data || []) as Row[]).map((row) => ({
        id: row.id,
        name: row.name,
        capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
        color: row.color ?? null,
        active: Boolean(row.active),
    }));
}

async function loadAttendance(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    startDate: string,
    endDate: string,
): Promise<AttendanceRow[]> {
    const { data: occurrences, error: occurrencesError } = await lms
        .from('lesson_occurrences')
        .select('id,class_id,occurrence_date,start_time,end_time')
        .eq('academy_id', academyId)
        .gte('occurrence_date', startDate)
        .lte('occurrence_date', endDate);
    ensureNoError(occurrencesError, 'Failed to load attendance occurrences');

    const occurrenceRows = (occurrences || []) as Row[];
    const occurrenceIds = occurrenceRows.map((row) => row.id);
    if (occurrenceIds.length === 0) return [];

    const { data: attendance, error: attendanceError } = await lms
        .from('attendance_records')
        .select('id,occurrence_id,student_id,status,attended_minutes,billable_minutes,notes,updated_at')
        .eq('academy_id', academyId)
        .in('occurrence_id', occurrenceIds)
        .order('created_at', { ascending: false });
    ensureNoError(attendanceError, 'Failed to load attendance records');

    const attendanceRows = (attendance || []) as Row[];
    if (attendanceRows.length === 0) return [];

    const occurrenceMap = new Map(occurrenceRows.map((row) => [row.id, row]));
    const studentIds = uniqueStrings(attendanceRows.map((row) => row.student_id));
    const classIds = uniqueStrings(occurrenceRows.map((row) => row.class_id));

    const [{ data: students, error: studentsError }, classNames] = await Promise.all([
        core.from('students').select('id,person_id').eq('academy_id', academyId).in('id', studentIds),
        fetchClassNames(core, classIds),
    ]);
    ensureNoError(studentsError, 'Failed to load attendance students');

    const studentMap = new Map(((students || []) as Row[]).map((row) => [row.id, row]));
    const people = await fetchPeople(core, ((students || []) as Row[]).map((row) => row.person_id));

    return attendanceRows.map((row) => {
        const occurrence = occurrenceMap.get(row.occurrence_id);
        const student = studentMap.get(row.student_id);
        const person = student ? people.get(student.person_id) : null;
        return {
            id: row.id,
            occurrenceId: row.occurrence_id,
            studentId: row.student_id,
            studentName: person?.display_name || person?.full_name || 'Unknown student',
            classId: occurrence?.class_id || '',
            className: occurrence?.class_id ? classNames.get(occurrence.class_id) || 'Unknown class' : 'Unknown class',
            date: occurrence?.occurrence_date || '',
            startTime: normalizeTime(occurrence?.start_time),
            endTime: normalizeTime(occurrence?.end_time),
            status: row.status,
            attendedMinutes: row.attended_minutes ?? null,
            billableMinutes: row.billable_minutes ?? null,
            notes: row.notes ?? null,
            updatedAt: row.updated_at ?? null,
        };
    });
}

async function loadClassStudents(core: SchemaClient, academyId: string, classId: string): Promise<ClassStudentSummary[]> {
    const { data: enrollments, error } = await core
        .from('class_students')
        .select('student_id,status,joined_at,primary_class')
        .eq('class_id', classId);
    ensureNoError(error, 'Failed to load class students');

    const enrollmentRows = (enrollments || []) as Row[];
    const studentIds = uniqueStrings(enrollmentRows.map((row) => row.student_id));
    if (studentIds.length === 0) return [];

    const { data: students, error: studentsError } = await core
        .from('students')
        .select('id,person_id,status')
        .eq('academy_id', academyId)
        .in('id', studentIds);
    ensureNoError(studentsError, 'Failed to load class student records');

    const people = await fetchPeople(core, ((students || []) as Row[]).map((row) => row.person_id));
    const enrollmentByStudent = new Map(enrollmentRows.map((row) => [row.student_id, row]));

    return ((students || []) as Row[]).map((row) => {
        const person = people.get(row.person_id);
        return {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown student',
            status: enrollmentByStudent.get(row.id)?.status || row.status,
            joinedAt: enrollmentByStudent.get(row.id)?.joined_at ?? null,
            primaryClass: Boolean(enrollmentByStudent.get(row.id)?.primary_class),
        };
    });
}

async function loadClassCourseOptions(lms: SchemaClient, academyId: string): Promise<ClassCourseOption[]> {
    const { data, error } = await lms
        .from('courses')
        .select('id,title,subject_id,status')
        .eq('academy_id', academyId)
        .order('title');
    ensureNoError(error, 'Failed to load class course options');

    return ((data || []) as Row[]).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        subjectId: row.subject_id ? String(row.subject_id) : null,
        status: String(row.status || 'active'),
    }));
}

export async function loadClassMemberCandidates(
    context: LmsRoleContext,
    classId: string,
    query: string | null | undefined,
    limit = 50,
): Promise<ClassMemberCandidate[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const normalizedQuery = normalizeRosterQuery(query);
    const boundedLimit = Math.max(1, Math.min(limit, 100));

    await assertClassBelongsToAcademy(core, context.academyId, classId);

    const { data: currentEnrollments, error: currentError } = await core
        .from('class_students')
        .select('student_id')
        .eq('class_id', classId)
        .eq('status', 'active');
    ensureNoError(currentError, 'Failed to load current class members');
    const currentIds = new Set(((currentEnrollments || []) as Row[]).map((row) => String(row.student_id)));

    let matchingPersonIds: string[] | null = null;
    if (normalizedQuery) {
        const { data: peopleRows, error: peopleError } = await core
            .from('people')
            .select('id')
            .eq('primary_academy_id', context.academyId)
            .or(buildPeopleSearchOrFilter(normalizedQuery, ['full_name', 'display_name']))
            .limit(200);
        ensureNoError(peopleError, 'Failed to search student people');
        matchingPersonIds = ((peopleRows || []) as Row[]).map((row) => String(row.id));
        if (matchingPersonIds.length === 0) return [];
    }

    let studentQuery = core
        .from('students')
        .select('id,person_id,status,grade')
        .eq('academy_id', context.academyId)
        .in('status', ['active', 'on_leave'])
        .order('created_at', { ascending: false })
        .limit(boundedLimit + currentIds.size);
    if (matchingPersonIds) studentQuery = studentQuery.in('person_id', matchingPersonIds);

    const { data: studentRowsData, error: studentsError } = await studentQuery;
    ensureNoError(studentsError, 'Failed to load class member candidates');
    const studentRows = ((studentRowsData || []) as Row[])
        .filter((row) => !currentIds.has(String(row.id)))
        .slice(0, boundedLimit);
    if (studentRows.length === 0) return [];

    const studentIds = studentRows.map((row) => String(row.id));
    const personIds = studentRows.map((row) => String(row.person_id));
    const [people, enrollmentsResult, contractsResult] = await Promise.all([
        fetchPeople(core, personIds),
        core.from('class_students')
            .select('student_id,class_id,status')
            .in('student_id', studentIds)
            .eq('status', 'active'),
        lms.from('student_billing_contracts')
            .select('id,student_id,billing_mode,hourly_rate,effective_from')
            .eq('academy_id', context.academyId)
            .eq('status', 'active')
            .in('student_id', studentIds)
            .order('effective_from', { ascending: false }),
    ]);
    ensureNoError(enrollmentsResult.error, 'Failed to load candidate class assignments');
    ensureNoError(contractsResult.error, 'Failed to load candidate billing contracts');

    const enrollmentRows = (enrollmentsResult.data || []) as Row[];
    const classIds = uniqueStrings(enrollmentRows.map((row) => row.class_id));
    const classNames = await fetchClassNames(core, classIds);
    const classesByStudent = new Map<string, string[]>();
    for (const row of enrollmentRows) {
        const names = classesByStudent.get(String(row.student_id)) || [];
        const name = classNames.get(String(row.class_id));
        if (name) names.push(name);
        classesByStudent.set(String(row.student_id), names);
    }
    const contracts = new Map<string, Row>();
    for (const row of (contractsResult.data || []) as Row[]) {
        if (!contracts.has(String(row.student_id))) contracts.set(String(row.student_id), row);
    }

    return studentRows.map((row) => {
        const person = people.get(String(row.person_id));
        const contract = contracts.get(String(row.id));
        return {
            studentId: String(row.id),
            personId: String(row.person_id),
            name: String(person?.display_name || person?.full_name || 'Unknown student'),
            grade: row.grade ? String(row.grade) : null,
            status: row.status as ClassMemberCandidate['status'],
            classNames: classesByStudent.get(String(row.id)) || [],
            billingMode: contract?.billing_mode || null,
            hourlyRate: contract?.hourly_rate === null || contract?.hourly_rate === undefined
                ? null
                : toNumber(contract.hourly_rate),
            currentRuleType: null,
            currentRuleAmount: null,
        };
    }).sort((left, right) => left.name.localeCompare(right.name, 'ko-KR'));
}

async function loadClassBooks(learning: SchemaClient, content: SchemaClient, classId: string): Promise<ClassBookSummary[]> {
    const { data: assignments, error } = await learning
        .from('book_assignments')
        .select('book_id,assigned_at,active')
        .eq('target_type', 'class')
        .eq('class_id', classId)
        .eq('active', true)
        .order('assigned_at', { ascending: false });
    ensureNoError(error, 'Failed to load class books');

    const assignmentRows = (assignments || []) as Row[];
    const bookIds = uniqueStrings(assignmentRows.map((row) => row.book_id));
    if (bookIds.length === 0) return [];

    const { data: books, error: booksError } = await content
        .from('books')
        .select('id,book_key,title,subject,grade')
        .in('id', bookIds);
    ensureNoError(booksError, 'Failed to load book records');

    const bookMap = new Map(((books || []) as Row[]).map((row) => [row.id, row]));
    return assignmentRows.map((row) => {
        const book = bookMap.get(row.book_id);
        return {
            id: row.book_id,
            bookKey: book?.book_key || '',
            title: book?.title || 'Unknown book',
            subject: book?.subject ?? null,
            grade: book?.grade ?? null,
            assignedAt: row.assigned_at,
            active: row.active,
        };
    });
}

function restrictReferenceDataForAssignedRole(
    overview: ClassOperationsOverview,
    operatorClassIds: Set<string>,
    occurrenceStatusIds: Set<string>,
): ClassOperationsOverview {
    const canUseClassReferences = operatorClassIds.size > 0;
    const visibleSchedule = overview.schedule.filter((row) => (
        operatorClassIds.has(row.classId)
        || Boolean(row.actualId && occurrenceStatusIds.has(row.actualId))
    ));

    return {
        classes: overview.classes.filter((row) => operatorClassIds.has(row.id)),
        schedule: visibleSchedule,
        scheduleRules: overview.scheduleRules.filter((row) => operatorClassIds.has(row.classId)),
        books: canUseClassReferences ? overview.books : [],
        attendance: overview.attendance.filter((row) => (
            operatorClassIds.has(row.classId) || occurrenceStatusIds.has(row.occurrenceId)
        )),
        staff: canUseClassReferences
            ? overview.staff.map((row) => ({ ...row, phone: null, email: null, hourlyRate: null }))
            : [],
        classrooms: canUseClassReferences ? overview.classrooms : [],
        courses: canUseClassReferences ? overview.courses : [],
        permissions: {
            canCreateClass: false,
            canManageGlobalResources: false,
            operatorClassIds: [...operatorClassIds],
            occurrenceStatusIds: [...occurrenceStatusIds],
        },
        truncated: overview.truncated,
    };
}

async function loadClassOperationsOverviewLegacy(
    context: LmsRoleContext,
    startDate: string,
    endDate: string,
    view: 'overview' | 'schedule' | 'attendance' | 'settings' = 'overview',
): Promise<ClassOperationsOverview> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const content = client.schema('content');
    const reporting = client.schema('reporting');
    const academyId = context.academyId;
    const needsSchedule = view === 'overview' || view === 'schedule' || view === 'attendance';
    const needsRules = view === 'schedule' || view === 'settings';
    const needsBooks = view === 'overview' || view === 'settings';
    const needsAttendance = view === 'attendance';
    const needsReferenceData = view === 'overview' || view === 'schedule' || view === 'settings';
    const needsCourseOptions = view === 'overview' || view === 'settings';
    const [classes, schedule, scheduleRules, books, attendance, staff, classrooms, courses] = await Promise.all([
        loadClassSummaries(core, lms, reporting, academyId),
        needsSchedule ? loadSchedule(core, lms, academyId, startDate, endDate) : Promise.resolve([]),
        needsRules ? loadScheduleRules(core, lms, academyId) : Promise.resolve([]),
        needsBooks ? loadBooks(content, academyId) : Promise.resolve([]),
        needsAttendance ? loadAttendance(core, lms, academyId, startDate, endDate) : Promise.resolve([]),
        needsReferenceData ? loadStaff(core, academyId) : Promise.resolve([]),
        needsReferenceData ? loadClassrooms(lms, academyId) : Promise.resolve([]),
        needsCourseOptions ? loadClassCourseOptions(lms, academyId) : Promise.resolve([]),
    ]);

    const overview: ClassOperationsOverview = {
        classes,
        schedule,
        scheduleRules,
        books,
        attendance,
        staff,
        classrooms,
        courses,
        truncated: truncationFromJson(null),
    };

    if (!requiresAssignedClassScope(context.role)) {
        return {
            ...overview,
            permissions: {
                canCreateClass: true,
                canManageGlobalResources: true,
                operatorClassIds: overview.classes.map((row) => row.id),
                occurrenceStatusIds: [],
            },
        };
    }

    const staffMemberId = await loadActiveStaffId(core, context);
    const [operatorClassIds, occurrenceScope] = await Promise.all([
        loadAssignedClassIds(core, lms, academyId, staffMemberId),
        loadOccurrenceStatusScope(lms, academyId, staffMemberId, startDate, endDate),
    ]);
    return restrictReferenceDataForAssignedRole(
        overview,
        operatorClassIds,
        occurrenceScope.occurrenceIds,
    );
}

function isMissingReadModel(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return error.code === '42883'
        || error.code === 'PGRST202';
}

export async function loadClassOperationsOverview(
    context: LmsRoleContext,
    startDate: string,
    endDate: string,
    view: 'overview' | 'schedule' | 'attendance' | 'settings' = 'overview',
): Promise<ClassOperationsOverview> {
    if (process.env.LMS_USE_V2_READ_MODELS === 'false') {
        return loadClassOperationsOverviewLegacy(context, startDate, endDate, view);
    }

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    let staffMemberId: string | null = null;
    let assignedClassIds: Set<string> | null = null;
    let occurrenceScope: OccurrenceStatusScope = { occurrenceIds: new Set(), classIds: new Set() };

    if (requiresAssignedClassScope(context.role)) {
        staffMemberId = await loadActiveStaffId(core, context);
        [assignedClassIds, occurrenceScope] = await Promise.all([
            loadAssignedClassIds(core, lms, context.academyId, staffMemberId),
            loadOccurrenceStatusScope(lms, context.academyId, staffMemberId, startDate, endDate),
        ]);
    }

    const readableClassIds = assignedClassIds
        ? uniqueStrings([...assignedClassIds, ...occurrenceScope.classIds])
        : null;

    const { data, error } = await lms.rpc('class_operations_read_v2', {
        p_academy_id: context.academyId,
        p_view: view,
        p_start_date: startDate,
        p_end_date: endDate,
        p_class_ids: readableClassIds,
        p_class_limit: 100,
    });
    if (error) {
        if (isMissingReadModel(error)) {
            return loadClassOperationsOverviewLegacy(context, startDate, endDate, view);
        }
        throw error;
    }

    let overview = classOverviewFromReadModel(data, startDate, endDate);
    const needsDirectSchedule = view === 'schedule' || view === 'attendance';
    const needsManagerReferences = view === 'overview' || view === 'schedule';
    const needsManagerClassProfiles = (view === 'overview' || view === 'settings')
        && overview.classes.length > 0;
    const needsManagerCourses = view === 'overview' || view === 'settings';
    const classIds = overview.classes.map((row) => row.id);
    const [schedule, scheduleRules, staff, classrooms, profilesResult, courses] = await Promise.all([
        needsDirectSchedule
            ? loadSchedule(core, lms, context.academyId, startDate, endDate)
            : Promise.resolve(overview.schedule),
        needsManagerReferences && view === 'schedule'
            ? loadScheduleRules(core, lms, context.academyId)
            : Promise.resolve(overview.scheduleRules),
        needsManagerReferences ? loadStaff(core, context.academyId) : Promise.resolve(overview.staff),
        needsManagerReferences ? loadClassrooms(lms, context.academyId) : Promise.resolve(overview.classrooms),
        needsManagerClassProfiles
            ? lms.from('class_profiles').select('class_id,notes,course_id').eq('academy_id', context.academyId).in('class_id', classIds)
            : Promise.resolve({ data: [], error: null }),
        needsManagerCourses ? loadClassCourseOptions(lms, context.academyId) : Promise.resolve([]),
    ]);
    ensureNoError(profilesResult.error, 'Failed to load class profile settings');
    const profilesByClass = new Map(((profilesResult.data || []) as Row[]).map((row) => [String(row.class_id), row]));
    overview = {
        ...overview,
        classes: needsManagerClassProfiles
            ? overview.classes.map((row) => ({
                ...row,
                notes: profilesByClass.get(row.id)?.notes ?? null,
                courseId: profilesByClass.get(row.id)?.course_id ?? null,
            }))
            : overview.classes,
        schedule,
        scheduleRules,
        staff,
        classrooms,
        courses,
        truncated: needsDirectSchedule
            ? { ...overview.truncated, occurrences: false }
            : overview.truncated,
    };
    if (!staffMemberId) {
        return {
            ...overview,
            permissions: {
                canCreateClass: true,
                canManageGlobalResources: true,
                operatorClassIds: overview.classes.map((row) => row.id),
                occurrenceStatusIds: [],
            },
        };
    }
    return restrictReferenceDataForAssignedRole(
        overview,
        assignedClassIds || new Set(),
        occurrenceScope.occurrenceIds,
    );
}

export async function loadClassOperationsDetail(
    context: LmsRoleContext,
    classId: string,
    occurrenceId: string | null = null,
): Promise<ClassOperationsDetail> {
    if (!classId) forbidden();

    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');

    await assertClassBelongsToAcademy(core, context.academyId, classId);
    const occurrenceAccess = occurrenceId
        ? await assertOccurrenceStatusAccess(context, { classId, occurrenceId })
        : null;
    if (!occurrenceId) await assertAssignedClassAccess(context, { classId });

    const students = await loadClassStudents(core, context.academyId, classId);
    const books = occurrenceAccess === 'occurrence_participant'
        ? []
        : await loadClassBooks(learning, content, classId);

    return { students, books };
}
