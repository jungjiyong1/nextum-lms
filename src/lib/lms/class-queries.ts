import 'server-only';

import { requiresAssignedClassScope } from '@/core/auth/roles';
import { applyAssignedClassScope } from '@/features/lms/classScope';
import type {
    AttendanceRow,
    BookSummary,
    ClassBookSummary,
    ClassOperationsDetail,
    ClassOperationsOverview,
    ClassStudentSummary,
    ClassSummary,
    ClassroomSummary,
    ScheduleItem,
    ScheduleRuleSummary,
    StaffSummary,
} from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertAssignedClassAccess } from './class-access';
import { LmsAuthError, type LmsRoleContext } from './auth';

type Row = Record<string, any>;
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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function forbidden(): never {
    throw new LmsAuthError('LMS class access is not allowed.', 403);
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
    lms: SchemaClient,
    academyId: string,
    staffMemberId: string,
): Promise<Set<string>> {
    const [profilesResult, rulesResult, occurrencesResult] = await Promise.all([
        lms
            .from('class_profiles')
            .select('class_id')
            .eq('academy_id', academyId)
            .eq('default_instructor_staff_id', staffMemberId),
        lms
            .from('class_schedule_rules')
            .select('class_id')
            .eq('academy_id', academyId)
            .eq('active', true)
            .eq('instructor_staff_id', staffMemberId),
        lms
            .from('lesson_occurrences')
            .select('class_id')
            .eq('academy_id', academyId)
            .or(`instructor_staff_id.eq.${staffMemberId},substitute_staff_id.eq.${staffMemberId}`),
    ]);

    ensureNoError(profilesResult.error, 'Failed to load assigned class profiles');
    ensureNoError(rulesResult.error, 'Failed to load assigned schedule rules');
    ensureNoError(occurrencesResult.error, 'Failed to load assigned lesson occurrences');

    return new Set([
        ...((profilesResult.data || []) as Row[]).map((row) => row.class_id),
        ...((rulesResult.data || []) as Row[]).map((row) => row.class_id),
        ...((occurrencesResult.data || []) as Row[]).map((row) => row.class_id),
    ].filter(Boolean));
}

export async function loadAssignedClassIdsForContext(context: LmsRoleContext): Promise<Set<string> | null> {
    if (!requiresAssignedClassScope(context.role)) return null;

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const staffMemberId = await loadActiveStaffId(core, context);
    return loadAssignedClassIds(lms, context.academyId, staffMemberId);
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
): Promise<ClassSummary[]> {
    const { data: classesData, error: classesError } = await core
        .from('classes')
        .select('id,name,grade,active')
        .eq('academy_id', academyId)
        .order('name');
    ensureNoError(classesError, 'Failed to load classes');

    const classes = (classesData || []) as Row[];
    if (classes.length === 0) return [];

    const classIds = classes.map((row) => row.id);
    const [
        { data: profilesData, error: profilesError },
        { data: classStudentsData, error: classStudentsError },
        { data: learningData, error: learningError },
        { data: coursesData, error: coursesError },
        { data: classroomsData, error: classroomsError },
        { data: staffData, error: staffError },
    ] = await Promise.all([
        lms.from('class_profiles').select('*').eq('academy_id', academyId).in('class_id', classIds),
        core.from('class_students').select('class_id,student_id,status').in('class_id', classIds),
        reporting.from('v_class_learning_summary').select('*').eq('academy_id', academyId).in('class_id', classIds),
        lms.from('courses').select('id,title').eq('academy_id', academyId),
        lms.from('classrooms').select('id,name').eq('academy_id', academyId),
        core.from('staff_members').select('id,person_id').eq('academy_id', academyId),
    ]);

    for (const [error, context] of [
        [profilesError, 'Failed to load class profiles'],
        [classStudentsError, 'Failed to load class enrollments'],
        [learningError, 'Failed to load class learning summary'],
        [coursesError, 'Failed to load courses'],
        [classroomsError, 'Failed to load classrooms'],
        [staffError, 'Failed to load staff people'],
    ] as const) {
        ensureNoError(error, context);
    }

    const profiles = new Map(((profilesData || []) as Row[]).map((row) => [row.class_id, row]));
    const courses = new Map(((coursesData || []) as Row[]).map((row) => [row.id, row.title]));
    const classrooms = new Map(((classroomsData || []) as Row[]).map((row) => [row.id, row.name]));
    const staffNames = await fetchStaffPeople(core, (staffData || []) as Row[]);
    const learning = new Map(((learningData || []) as Row[]).map((row) => [row.class_id, row]));
    const studentCounts = new Map<string, number>();

    for (const enrollment of (classStudentsData || []) as Row[]) {
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
            courseTitle: profile?.course_id ? courses.get(profile.course_id) ?? null : null,
            instructorName: profile?.default_instructor_staff_id ? staffNames.get(profile.default_instructor_staff_id) ?? null : null,
            classroomName: profile?.default_classroom_id ? classrooms.get(profile.default_classroom_id) ?? null : null,
            studentCount: studentCounts.get(row.id) || 0,
            weakTypeCount: toNumber(summary?.weak_type_count),
            avgTypeScore: summary?.avg_type_score === null || summary?.avg_type_score === undefined
                ? null
                : Number(summary.avg_type_score),
            lastLearningAt: summary?.last_learning_at ?? null,
        };
    });
}

export async function loadClassSummariesForContext(context: LmsRoleContext): Promise<ClassSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const reporting = client.schema('reporting');
    const classes = await loadClassSummaries(core, lms, reporting, context.academyId);

    if (!requiresAssignedClassScope(context.role)) return classes;

    const staffMemberId = await loadActiveStaffId(core, context);
    const assignedClassIds = await loadAssignedClassIds(lms, context.academyId, staffMemberId);
    return classes.filter((row) => assignedClassIds.has(row.id));
}

export async function loadClassOptionsForContext(context: LmsRoleContext): Promise<ClassSummary[]> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    let allowedClassIds: Set<string> | null = null;

    if (requiresAssignedClassScope(context.role)) {
        const staffMemberId = await loadActiveStaffId(core, context);
        allowedClassIds = await loadAssignedClassIds(lms, context.academyId, staffMemberId);
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

async function loadSchedule(
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
    ] = await Promise.all([
        core.from('classes').select('id,name').eq('academy_id', academyId),
        lms.from('class_profiles').select('class_id,default_instructor_staff_id,default_classroom_id').eq('academy_id', academyId),
        lms.from('class_schedule_rules').select('*').eq('academy_id', academyId).eq('active', true),
        lms.from('lesson_occurrences').select('*').eq('academy_id', academyId).gte('occurrence_date', startDate).lte('occurrence_date', endDate),
        lms.from('classrooms').select('id,name').eq('academy_id', academyId),
        core.from('staff_members').select('id,person_id').eq('academy_id', academyId),
    ]);

    for (const [error, context] of [
        [classesError, 'Failed to load schedule classes'],
        [profilesError, 'Failed to load schedule profiles'],
        [rulesError, 'Failed to load schedule rules'],
        [occurrencesError, 'Failed to load lesson occurrences'],
        [classroomsError, 'Failed to load schedule classrooms'],
        [staffError, 'Failed to load schedule staff'],
    ] as const) {
        ensureNoError(error, context);
    }

    const classes = new Map(((classesData || []) as Row[]).map((row) => [row.id, row.name]));
    const profiles = new Map(((profilesData || []) as Row[]).map((row) => [row.class_id, row]));
    const classrooms = new Map(((classroomsData || []) as Row[]).map((row) => [row.id, row.name]));
    const staffNames = await fetchStaffPeople(core, (staffData || []) as Row[]);
    const items: ScheduleItem[] = [];
    const actualKeys = new Set<string>();

    for (const row of (occurrencesData || []) as Row[]) {
        const start = normalizeTime(row.start_time);
        actualKeys.add(`${row.class_id}:${row.rule_id || 'none'}:${row.occurrence_date}:${start}`);
        const profile = profiles.get(row.class_id);
        const instructorId = row.substitute_staff_id || row.instructor_staff_id || profile?.default_instructor_staff_id;
        const classroomId = row.classroom_id || profile?.default_classroom_id;
        items.push({
            id: row.id,
            actualId: row.id,
            virtual: false,
            classId: row.class_id,
            className: classes.get(row.class_id) || 'Unknown class',
            ruleId: row.rule_id ?? null,
            date: row.occurrence_date,
            startTime: start,
            endTime: normalizeTime(row.end_time),
            status: row.status as ScheduleItem['status'],
            classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
            instructorId: instructorId ?? null,
            instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
            cancelReason: row.cancel_reason ?? null,
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
            const key = `${rule.class_id}:${rule.id}:${date}:${start}`;
            if (day === rule.day_of_week && weekOffset >= 0 && weekOffset % rule.interval_weeks === 0 && !actualKeys.has(key)) {
                const profile = profiles.get(rule.class_id);
                const classroomId = rule.classroom_id || profile?.default_classroom_id;
                const instructorId = rule.instructor_staff_id || profile?.default_instructor_staff_id;
                items.push({
                    id: `virtual:${rule.id}:${date}`,
                    actualId: null,
                    virtual: true,
                    classId: rule.class_id,
                    className: classes.get(rule.class_id) || 'Unknown class',
                    ruleId: rule.id,
                    date,
                    startTime: start,
                    endTime: normalizeTime(rule.end_time),
                    status: 'scheduled',
                    classroomName: classroomId ? classrooms.get(classroomId) ?? null : null,
                    instructorId: instructorId ?? null,
                    instructorName: instructorId ? staffNames.get(instructorId) ?? null : null,
                    cancelReason: null,
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
        .select('*')
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

    const classIds = uniqueStrings(rows.map((row) => row.class_id));
    const classroomIds = uniqueStrings(rows.map((row) => row.classroom_id));
    const staffIds = uniqueStrings(rows.map((row) => row.instructor_staff_id));

    const [classNames, classroomsResult, staffResult] = await Promise.all([
        fetchClassNames(core, classIds),
        classroomIds.length > 0
            ? lms.from('classrooms').select('id,name').eq('academy_id', academyId).in('id', classroomIds)
            : Promise.resolve({ data: [], error: null }),
        staffIds.length > 0
            ? core.from('staff_members').select('id,person_id').eq('academy_id', academyId).in('id', staffIds)
            : Promise.resolve({ data: [], error: null }),
    ]);

    ensureNoError(classroomsResult.error, 'Failed to load rule classrooms');
    ensureNoError(staffResult.error, 'Failed to load rule staff');

    const classroomMap = new Map(((classroomsResult.data || []) as Row[]).map((row) => [row.id, row.name]));
    const staffNames = await fetchStaffPeople(core, (staffResult.data || []) as Row[]);

    return rows.map((row) => ({
        id: row.id,
        classId: row.class_id,
        className: classNames.get(row.class_id) || 'Unknown class',
        dayOfWeek: Number(row.day_of_week),
        startTime: normalizeTime(row.start_time),
        endTime: normalizeTime(row.end_time),
        startDate: row.start_date,
        endDate: row.end_date ?? null,
        active: Boolean(row.active),
        classroomName: row.classroom_id ? classroomMap.get(row.classroom_id) ?? null : null,
        instructorId: row.instructor_staff_id ?? null,
        instructorName: row.instructor_staff_id ? staffNames.get(row.instructor_staff_id) ?? null : null,
    }));
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
        .select('id,occurrence_id,student_id,status,attended_minutes,billable_minutes,notes')
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
        };
    });
}

async function loadClassStudents(core: SchemaClient, academyId: string, classId: string): Promise<ClassStudentSummary[]> {
    const { data: enrollments, error } = await core
        .from('class_students')
        .select('student_id,status')
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
    const enrollmentStatus = new Map(enrollmentRows.map((row) => [row.student_id, row.status]));

    return ((students || []) as Row[]).map((row) => {
        const person = people.get(row.person_id);
        return {
            id: row.id,
            personId: row.person_id,
            name: person?.display_name || person?.full_name || 'Unknown student',
            status: enrollmentStatus.get(row.id) || row.status,
        };
    });
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
    staffMemberId: string,
): ClassOperationsOverview {
    const scoped = applyAssignedClassScope({
        staffMemberId,
        classes: overview.classes,
        schedule: overview.schedule,
        scheduleRules: overview.scheduleRules,
        attendance: overview.attendance,
    });
    const visibleStaffIds = new Set<string>([staffMemberId]);
    const visibleClassroomIds = new Set<string>();

    for (const row of scoped.classes) {
        if (row.defaultInstructorId) visibleStaffIds.add(row.defaultInstructorId);
        if (row.defaultClassroomId) visibleClassroomIds.add(row.defaultClassroomId);
    }
    for (const row of scoped.schedule) {
        if (row.instructorId) visibleStaffIds.add(row.instructorId);
    }
    for (const row of scoped.scheduleRules) {
        if (row.instructorId) visibleStaffIds.add(row.instructorId);
    }

    return {
        classes: scoped.classes,
        schedule: scoped.schedule,
        scheduleRules: scoped.scheduleRules,
        books: [],
        attendance: scoped.attendance,
        staff: overview.staff.filter((row) => visibleStaffIds.has(row.id)),
        classrooms: overview.classrooms.filter((row) => visibleClassroomIds.has(row.id)),
    };
}

export async function loadClassOperationsOverview(
    context: LmsRoleContext,
    startDate: string,
    endDate: string,
): Promise<ClassOperationsOverview> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const content = client.schema('content');
    const reporting = client.schema('reporting');
    const academyId = context.academyId;

    const [classes, schedule, scheduleRules, books, attendance, staff, classrooms] = await Promise.all([
        loadClassSummaries(core, lms, reporting, academyId),
        loadSchedule(core, lms, academyId, startDate, endDate),
        loadScheduleRules(core, lms, academyId),
        requiresAssignedClassScope(context.role) ? Promise.resolve([]) : loadBooks(content, academyId),
        loadAttendance(core, lms, academyId, startDate, endDate),
        loadStaff(core, academyId),
        loadClassrooms(lms, academyId),
    ]);

    const overview: ClassOperationsOverview = {
        classes,
        schedule,
        scheduleRules,
        books,
        attendance,
        staff,
        classrooms,
    };

    if (!requiresAssignedClassScope(context.role)) return overview;

    const staffMemberId = await loadActiveStaffId(core, context);
    return restrictReferenceDataForAssignedRole(overview, staffMemberId);
}

export async function loadClassOperationsDetail(
    context: LmsRoleContext,
    classId: string,
): Promise<ClassOperationsDetail> {
    if (!classId) forbidden();

    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');

    await assertClassBelongsToAcademy(core, context.academyId, classId);
    await assertAssignedClassAccess(context, { classId });

    const [students, books] = await Promise.all([
        loadClassStudents(core, context.academyId, classId),
        loadClassBooks(learning, content, classId),
    ]);

    return { students, books };
}
