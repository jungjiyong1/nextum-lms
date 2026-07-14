import 'server-only';

import { createHmac, randomBytes } from 'crypto';
import { requiresAssignedClassScope } from '@/core/auth/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateInvoiceDraft } from '@/features/lms/billing';
import { normalizeClassInstructorIds, removedClassInstructorIds } from '@/features/lms/class-instructors';
import { lessonStatusRpcValue, normalizeLessonOccurrenceStatus } from '@/features/lms/lesson-status';
import {
    COMPLETED_PAYMENT_STATUS,
    normalizePaymentStatus,
    normalizePayrollStatus,
} from '@/features/lms/status';
import type {
    BatchAttendanceInput,
    BillingClassRuleType,
    BillingMode,
    CreateExpenseInput,
    CreateInstructorPaymentInput,
    CreateLearningAssignmentInput,
    CreateBookInput,
    CreateClassInput,
    CreateClassroomInput,
    CreateScheduleRuleInput,
    DeleteScheduleInput,
    CreateStaffInput,
    CreateStudentInput,
    RecordAttendanceInput,
    RecordPaymentInput,
    StudentStatus,
    StudentClassBillingInput,
    StaffRole,
    StaffStatus,
    ClassStatus,
    ClassMembershipChangeInput,
    ScheduleConflict,
    ScheduleMutationInput,
    UpdateBookInput,
    UpdateClassroomInput,
    UpdateStaffInput,
    UpdateClassInput,
    UpdateLessonOccurrenceInput,
    UpdateScheduleRuleInput,
    UpdateStudentInput,
    UpsertInstructorPayRateInput,
    WithholdingType,
} from '@/features/lms/types';
import type { LmsRoleContext } from './auth';
import { LmsAuthError } from './auth';
import {
    hasAssignedAssignmentScope,
    unresolvedAssignmentRecipientStudentIds,
} from './assignment-scope';
import {
    normalizeAssignmentProblemScopes,
    problemMatchesAssignmentScopes,
} from './assignment-problem-scope';
import { loadAssignedClassIdsForContext } from './class-queries';
import { sortByProblemOrder } from './problem-order';
import { toSeoulDate } from './seoul-date';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function dateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundCurrency(value: number): number {
    return Math.round(value);
}

function monthRange(serviceMonth: string): { start: string; end: string } {
    const [year, month] = serviceMonth.split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) {
        throw new Error('청구 월은 YYYY-MM 형식이어야 합니다.');
    }
    return {
        start: `${serviceMonth}-01`,
        end: dateString(new Date(year, month, 0)),
    };
}

function isEffective(row: Row, startDate: string, endDate: string): boolean {
    const from = String(row.effective_from || startDate);
    const to = row.effective_to ? String(row.effective_to) : null;
    return from <= endDate && (!to || to >= startDate);
}

function uniqueClassIds(classIds: string[] | undefined) {
    return [...new Set((classIds || []).filter(Boolean))];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeLearningAnalysisActions(
    actions: CreateLearningAssignmentInput['learningAnalysisActions'],
): NonNullable<CreateLearningAssignmentInput['learningAnalysisActions']> {
    if (!actions) return [];
    if (!Array.isArray(actions) || actions.length > 200) {
        throw new Error('Learning analysis actions are invalid.');
    }
    const normalized = actions.map((action) => ({
        actionId: typeof action?.actionId === 'string' ? action.actionId.trim() : '',
        studentId: typeof action?.studentId === 'string' ? action.studentId.trim() : '',
        skillId: typeof action?.skillId === 'string' ? action.skillId.trim() : '',
    }));
    if (normalized.some((action) =>
        !UUID_PATTERN.test(action.studentId)
        || !UUID_PATTERN.test(action.skillId)
        || action.actionId !== `${action.studentId}::${action.skillId}`
    )) {
        throw new Error('Learning analysis action identity is invalid.');
    }
    if (new Set(normalized.map((action) => action.actionId)).size !== normalized.length) {
        throw new Error('Learning analysis actions contain duplicates.');
    }
    const skillsByStudent = new Map<string, Set<string>>();
    for (const action of normalized) {
        const skillIds = skillsByStudent.get(action.studentId) ?? new Set<string>();
        skillIds.add(action.skillId);
        skillsByStudent.set(action.studentId, skillIds);
    }
    const signatures = [...skillsByStudent.values()].map((skillIds) => [...skillIds].sort().join('|'));
    if (new Set(signatures).size > 1) {
        throw new Error('Learning analysis assignments require the same skill set for every student.');
    }
    return normalized;
}

function chunkValues<T>(values: readonly T[], size = 200): T[][] {
    const chunks: T[][] = [];
    for (let offset = 0; offset < values.length; offset += size) {
        chunks.push(values.slice(offset, offset + size));
    }
    return chunks;
}

function inviteSecret(): string {
    const secret = process.env.NEXTUM_INVITE_CODE_SECRET
        ?? process.env.INVITE_CODE_SECRET
        ?? process.env.SUPABASE_SECRET_KEY
        ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
        throw new Error('Invite code secret is not configured. Set NEXTUM_INVITE_CODE_SECRET or SUPABASE_SECRET_KEY.');
    }
    return secret;
}

function hashInviteCode(code: string): string {
    return createHmac('sha256', inviteSecret()).update(code.trim().toUpperCase()).digest('hex');
}

function newInviteCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
}

function normalizeTime(value: string | null | undefined): string {
    return (value || '').slice(0, 5);
}

function minutesBetween(startTime: string, endTime: string): number {
    const [startHour, startMinute] = normalizeTime(startTime).split(':').map(Number);
    const [endHour, endMinute] = normalizeTime(endTime).split(':').map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    return Math.max(0, end - start);
}

function slugifyBookKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function buildBookKey(academyId: string, input: CreateBookInput): string {
    const explicit = input.bookKey ? slugifyBookKey(input.bookKey) : '';
    if (explicit) return explicit;

    const titleSlug = slugifyBookKey(input.title).slice(0, 40) || 'book';
    return `lms-${academyId.slice(0, 8)}-${titleSlug}-${randomBytes(3).toString('hex')}`;
}

function defaultBillingRules(input: CreateStudentInput): StudentClassBillingInput[] {
    const classIds = uniqueClassIds(input.classIds);
    if (input.classBillingRules && input.classBillingRules.length > 0) {
        return input.classBillingRules.filter((rule) => classIds.includes(rule.classId));
    }

    if (input.billingMode === 'usage_based') {
        return classIds.map((classId) => ({
            classId,
            ruleType: 'usage_based',
            amount: input.hourlyRate || 0,
        }));
    }

    return classIds.map((classId, index) => ({
        classId,
        ruleType: index === 0 || input.billingMode === 'manual' ? 'included' : 'extra_flat',
        amount: 0,
    }));
}

async function assertClassesBelongToAcademy(core: SchemaClient, academyId: string, classIds: string[]) {
    if (classIds.length === 0) return;
    const { data, error } = await core
        .from('classes')
        .select('id')
        .eq('academy_id', academyId)
        .in('id', classIds);
    ensureNoError(error, 'Failed to verify class membership');

    if ((data || []).length !== classIds.length) {
        throw new Error('One or more selected classes do not belong to this academy.');
    }
}

async function assertStudentBelongsToAcademy(core: SchemaClient, academyId: string, studentId: string) {
    const { data, error } = await core
        .from('students')
        .select('id')
        .eq('academy_id', academyId)
        .eq('id', studentId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify student');
    if (!data?.id) throw new Error('Selected student does not belong to this academy.');
}

async function assertStudentsBelongToAcademy(core: SchemaClient, academyId: string, studentIds: string[]) {
    if (studentIds.length === 0) return;
    const { data, error } = await core
        .from('students')
        .select('id')
        .eq('academy_id', academyId)
        .in('id', studentIds);
    ensureNoError(error, 'Failed to verify students');

    if ((data || []).length !== studentIds.length) {
        throw new Error('One or more selected students do not belong to this academy.');
    }
}

async function assertStaffBelongsToAcademy(core: SchemaClient, academyId: string, staffId: string) {
    const { data, error } = await core
        .from('staff_members')
        .select('id')
        .eq('academy_id', academyId)
        .eq('id', staffId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify staff member');
    if (!data?.id) throw new Error('Selected staff member does not belong to this academy.');
}

async function assertStaffMembersBelongToAcademy(
    core: SchemaClient,
    academyId: string,
    staffIds: Array<string | null | undefined>,
) {
    const ids = uniqueStrings(staffIds);
    if (ids.length === 0) return;
    const { data, error } = await core
        .from('staff_members')
        .select('id')
        .eq('academy_id', academyId)
        .in('id', ids);
    ensureNoError(error, 'Failed to verify schedule staff members');
    if ((data || []).length !== ids.length) {
        throw new Error('One or more selected staff members do not belong to this academy.');
    }
}

async function assertClassroomBelongsToAcademy(lms: SchemaClient, academyId: string, classroomId: string | null | undefined) {
    if (!classroomId) return;
    const { data, error } = await lms
        .from('classrooms')
        .select('id')
        .eq('academy_id', academyId)
        .eq('id', classroomId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify classroom');
    if (!data?.id) throw new Error('Selected classroom does not belong to this academy.');
}

async function fetchClassNames(core: SchemaClient, classIds: string[]) {
    const ids = [...new Set(classIds.filter(Boolean))];
    if (ids.length === 0) return new Map<string, string>();

    const { data, error } = await core
        .from('classes')
        .select('id,name')
        .in('id', ids);
    ensureNoError(error, 'Failed to load class names');

    return new Map((data || []).map((row: Row) => [row.id, row.name]));
}

async function fetchPeopleNames(core: SchemaClient, personIds: string[]) {
    const ids = [...new Set(personIds.filter(Boolean))];
    if (ids.length === 0) return new Map<string, string>();

    const { data, error } = await core
        .from('people')
        .select('id,full_name,display_name')
        .in('id', ids);
    ensureNoError(error, 'Failed to load people names');

    return new Map((data || []).map((row: Row) => [row.id, row.display_name || row.full_name || 'Unknown student']));
}

async function loadStudentName(core: SchemaClient, academyId: string, studentId: string) {
    const { data, error } = await core
        .from('students')
        .select('id,person_id,people(id,full_name,display_name)')
        .eq('academy_id', academyId)
        .eq('id', studentId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify student');
    if (!data?.id) throw new Error('Selected student does not belong to this academy.');

    const person = Array.isArray((data as Row).people) ? (data as Row).people[0] : (data as Row).people;
    return person?.display_name || person?.full_name || 'Unknown student';
}

async function assertBookAssignableToAcademy(
    content: SchemaClient,
    academyId: string,
    bookId: string,
    options: { allowAssignmentHidden?: boolean } = {},
) {
    const { data, error } = await content
        .from('books')
        .select('id,academy_id,metadata')
        .eq('id', bookId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify book');

    const book = data as Row | null;
    if (
        !book
        || (book.academy_id && book.academy_id !== academyId)
        || (
            book.metadata?.visibility !== 'catalog'
            && !(options.allowAssignmentHidden && book.metadata?.visibility === 'assignment_hidden')
        )
    ) {
        throw new Error('Selected book does not belong to this academy.');
    }
}

async function loadClassProfile(lms: SchemaClient, academyId: string, classId: string) {
    const { data, error } = await lms
        .from('class_profiles')
        .select('default_classroom_id,default_instructor_staff_id')
        .eq('academy_id', academyId)
        .eq('class_id', classId)
        .single();
    ensureNoError(error, 'Failed to load class profile');
    return data as Row;
}

export async function createBookForAcademy(academyId: string, input: CreateBookInput) {
    const title = input.title.trim();
    if (!title) throw new Error('교재명을 입력하세요.');

    const client = createAdminClient();
    const content = client.schema('content');
    const { error } = await content.from('books').insert({
        academy_id: academyId,
        book_key: buildBookKey(academyId, input),
        title,
        subject: input.subject?.trim() || null,
        grade: input.grade?.trim() || null,
        metadata: { visibility: 'catalog' },
    });
    ensureNoError(error, 'Failed to create book');
}

export async function updateBookForAcademy(academyId: string, bookId: string, input: UpdateBookInput) {
    if (!bookId) throw new Error('교재를 선택하세요.');

    const title = input.title.trim();
    if (!title) throw new Error('교재명을 입력하세요.');

    const client = createAdminClient();
    const content = client.schema('content');
    const { error } = await content
        .from('books')
        .update({
            title,
            subject: input.subject?.trim() || null,
            grade: input.grade?.trim() || null,
        })
        .eq('academy_id', academyId)
        .eq('id', bookId)
        .select('id')
        .single();
    ensureNoError(error, 'Failed to update book');
}

export async function createClassroomForAcademy(academyId: string, input: CreateClassroomInput) {
    const name = input.name.trim();
    if (!name) throw new Error('강의실명을 입력하세요.');

    const client = createAdminClient();
    const lms = client.schema('lms');
    const { error } = await lms.from('classrooms').insert({
        academy_id: academyId,
        name,
        capacity: input.capacity ?? null,
        color: input.color || null,
        active: true,
    });
    ensureNoError(error, 'Failed to create classroom');
}

export async function updateClassroomForAcademy(academyId: string, classroomId: string, input: UpdateClassroomInput) {
    if (!classroomId) throw new Error('강의실을 선택하세요.');
    const name = input.name.trim();
    if (!name) throw new Error('강의실명을 입력하세요.');

    const client = createAdminClient();
    const lms = client.schema('lms');
    const { error } = await lms
        .from('classrooms')
        .update({
            name,
            capacity: input.capacity ?? null,
            color: input.color || null,
            active: input.active,
        })
        .eq('academy_id', academyId)
        .eq('id', classroomId)
        .select('id')
        .single();
    ensureNoError(error, 'Failed to update classroom');
}

function normalizeBillingMode(value: BillingMode): BillingMode {
    if (value === 'monthly_plus_classes' || value === 'usage_based' || value === 'manual') return value;
    return 'monthly_plus_classes';
}

function normalizeStudentStatus(value: StudentStatus): StudentStatus {
    if (value === 'active' || value === 'inactive' || value === 'on_leave' || value === 'graduated' || value === 'dropped') {
        return value;
    }
    return 'active';
}

function normalizeStaffRole(value: StaffRole): StaffRole {
    if (value === 'admin' || value === 'teacher' || value === 'instructor' || value === 'staff') return value;
    return 'instructor';
}

function normalizeStaffStatus(value: StaffStatus): StaffStatus {
    if (value === 'active' || value === 'inactive' || value === 'on_leave') return value;
    return 'active';
}

function normalizeClassStatus(value: ClassStatus): ClassStatus {
    if (value === 'active' || value === 'inactive' || value === 'archived') return value;
    return 'active';
}

function normalizeClassTargetGrades(input: CreateClassInput): string[] {
    return uniqueStrings([...(input.targetGrades || []), input.grade])
        .map((grade) => grade.trim())
        .filter(Boolean);
}

async function assertSubjectBelongsToAcademy(lms: SchemaClient, academyId: string, subjectId: string) {
    const { data, error } = await lms
        .from('subjects')
        .select('id')
        .eq('academy_id', academyId)
        .eq('id', subjectId)
        .eq('active', true)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify class subject');
    if (!data?.id) throw new Error('유효한 과목을 선택하세요.');
}

async function assertCourseBelongsToSubject(
    lms: SchemaClient,
    academyId: string,
    courseId: string,
    subjectId: string,
    allowedLegacyCourseId: string | null = null,
) {
    const { data, error } = await lms
        .from('courses')
        .select('id,subject_id')
        .eq('academy_id', academyId)
        .eq('id', courseId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify class course');
    if (!data?.id || (data.subject_id !== subjectId && data.id !== allowedLegacyCourseId)) {
        throw new Error('선택한 세부 과정이 해당 과목에 속하지 않습니다.');
    }
}

async function syncClassTargetGrades(
    lms: SchemaClient,
    academyId: string,
    classId: string,
    targetGrades: string[],
) {
    const { error: deleteError } = await lms
        .from('class_target_grades')
        .delete()
        .eq('academy_id', academyId)
        .eq('class_id', classId);
    ensureNoError(deleteError, 'Failed to replace class target grades');
    if (targetGrades.length === 0) return;
    const { error: insertError } = await lms.from('class_target_grades').insert(
        targetGrades.map((gradeCode, index) => ({
            academy_id: academyId,
            class_id: classId,
            grade_code: gradeCode,
            is_primary: index === 0,
            sort_order: index,
        })),
    );
    ensureNoError(insertError, 'Failed to save class target grades');
}

async function syncClassInstructorAssignments(
    lms: SchemaClient,
    academyId: string,
    classId: string,
    instructorIds: string[],
) {
    const { data: currentRows, error: currentError } = await lms
        .from('class_instructors')
        .select('instructor_staff_id')
        .eq('academy_id', academyId)
        .eq('class_id', classId)
        .eq('active', true);
    ensureNoError(currentError, 'Failed to load current class instructors');

    const removedIds = removedClassInstructorIds(
        ((currentRows || []) as Row[]).map((row) => String(row.instructor_staff_id)),
        instructorIds,
    );
    if (removedIds.length > 0) {
        const { error: deactivateError } = await lms
            .from('class_instructors')
            .update({ active: false, ended_on: toSeoulDate(new Date()) })
            .eq('academy_id', academyId)
            .eq('class_id', classId)
            .in('instructor_staff_id', removedIds);
        ensureNoError(deactivateError, 'Failed to deactivate removed class instructors');
    }

    if (instructorIds.length === 0) return;
    const { error: upsertError } = await lms.from('class_instructors').upsert(
        instructorIds.map((instructorId) => ({
            academy_id: academyId,
            class_id: classId,
            instructor_staff_id: instructorId,
            active: true,
            ended_on: null,
            source: 'manual',
        })),
        { onConflict: 'class_id,instructor_staff_id' },
    );
    ensureNoError(upsertError, 'Failed to sync class instructors');
}

function isBillableStudentStatus(status: StudentStatus) {
    return status === 'active';
}

function normalizeWithholdingType(value: WithholdingType | undefined): WithholdingType {
    if (value === 'none' || value === 'freelance_3.3' || value === 'custom') return value;
    return 'none';
}

export async function createClassForAcademy(academyId: string, input: CreateClassInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!input.subjectId) throw new Error('과목을 선택하세요.');
    const targetGrades = normalizeClassTargetGrades(input);
    const instructorIds = normalizeClassInstructorIds(input.instructorIds, input.defaultInstructorId);
    const defaultInstructorId = instructorIds[0] || null;
    if (targetGrades.length === 0) throw new Error('대상 학년을 입력하세요.');
    await assertSubjectBelongsToAcademy(lms, academyId, input.subjectId);
    if (input.courseId) await assertCourseBelongsToSubject(lms, academyId, input.courseId, input.subjectId);
    if (!name) throw new Error('반 이름을 입력하세요.');
    await assertStaffMembersBelongToAcademy(core, academyId, instructorIds);
    await assertClassroomBelongsToAcademy(lms, academyId, input.defaultClassroomId);

    const { data: createdClass, error: classError } = await core
        .from('classes')
        .insert({
            academy_id: academyId,
            name,
            grade: targetGrades[0],
            active: true,
        })
        .select('id')
        .single();
    ensureNoError(classError, 'Failed to create class');

    const classRow = createdClass as Row;
    try {
        const { error: profileError } = await lms.from('class_profiles').insert({
            academy_id: academyId,
            class_id: classRow.id,
            subject_id: input.subjectId,
            course_id: input.courseId || null,
            capacity: input.capacity ?? null,
            color: input.color || null,
            default_instructor_staff_id: defaultInstructorId,
            default_classroom_id: input.defaultClassroomId || null,
            status: 'active',
            notes: input.notes || null,
        });
        ensureNoError(profileError, 'Failed to create class profile');
        await syncClassTargetGrades(lms, academyId, String(classRow.id), targetGrades);
        await syncClassInstructorAssignments(lms, academyId, String(classRow.id), instructorIds);
    } catch (error) {
        await core.from('classes').delete().eq('id', classRow.id).eq('academy_id', academyId);
        throw error;
    }
}

export async function createStudentForAcademy(academyId: string, input: CreateStudentInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!name) throw new Error('학생 이름을 입력하세요.');

    const classIds = uniqueClassIds(input.classIds);
    await assertClassesBelongToAcademy(core, academyId, classIds);

    const { data: person, error: personError } = await core
        .from('people')
        .insert({
            primary_academy_id: academyId,
            full_name: name,
            display_name: name,
            phone: input.phone || null,
            parent_name: input.parentName || null,
            parent_phone: input.parentPhone || null,
        })
        .select('id')
        .single();
    ensureNoError(personError, 'Failed to create person');

    const personRow = person as Row;
    try {
        const { data: student, error: studentError } = await core
            .from('students')
            .insert({
                academy_id: academyId,
                person_id: personRow.id,
                status: 'active',
                school_type: input.schoolType || null,
                grade: input.grade || null,
                enrollment_date: toSeoulDate(new Date()),
            })
            .select('id')
            .single();
        ensureNoError(studentError, 'Failed to create student');

        const studentRow = student as Row;
        const classRows = classIds.map((classId, index) => ({
            class_id: classId,
            student_id: studentRow.id,
            status: 'active',
            primary_class: index === 0,
        }));
        if (classRows.length > 0) {
            const { error } = await core.from('class_students').insert(classRows);
            ensureNoError(error, 'Failed to assign student classes');
        }

        const { data: contract, error: contractError } = await lms
            .from('student_billing_contracts')
            .insert({
                academy_id: academyId,
                student_id: studentRow.id,
                billing_mode: normalizeBillingMode(input.billingMode),
                base_monthly_fee: input.baseMonthlyFee || 0,
                hourly_rate: input.hourlyRate ?? null,
                status: 'active',
            })
            .select('id')
            .single();
        ensureNoError(contractError, 'Failed to create billing contract');

        const contractRow = contract as Row;
        const billingRules = defaultBillingRules(input).map((rule) => ({
            academy_id: academyId,
            contract_id: contractRow.id,
            class_id: rule.classId,
            rule_type: rule.ruleType,
            amount: rule.amount || 0,
        }));

        if (billingRules.length > 0) {
            const { error } = await lms.from('billing_class_rules').insert(billingRules);
            ensureNoError(error, 'Failed to create billing class rules');
        }

        const invitation = await issueStudentInvitationForAcademy(academyId, studentRow.id);
        return {
            studentId: studentRow.id as string,
            studentName: name,
            invitation,
        };
    } catch (error) {
        await core.from('people').delete().eq('id', personRow.id).eq('primary_academy_id', academyId);
        throw error;
    }
}

async function resolveAssignmentProblemIds(
    content: SchemaClient,
    input: Pick<
        CreateLearningAssignmentInput,
        'bookId' | 'unitIds' | 'problemTypeIds' | 'problemScopes' | 'problemIds' | 'excludedProblemIds'
    >,
): Promise<string[]> {
    const excludedProblemIds = new Set(uniqueStrings(input.excludedProblemIds || []));
    if (!input.bookId) {
        return uniqueStrings(input.problemIds || []).filter((id) => !excludedProblemIds.has(id));
    }

    const unitIds = uniqueStrings(input.unitIds || []);
    const problemTypeIds = uniqueStrings(input.problemTypeIds || []);
    const problemScopes = normalizeAssignmentProblemScopes(input.problemScopes);
    const explicitProblemIds = uniqueStrings(input.problemIds || []);
    if (explicitProblemIds.length > 0) {
        return explicitProblemIds.filter((id) => !excludedProblemIds.has(id));
    }
    const unitIdSet = new Set(unitIds);
    const problemTypeIdSet = new Set(problemTypeIds);
    const queryUnitIds = uniqueStrings([...unitIds, ...problemScopes.map((scope) => scope.unitId)]);

    const problemRows: Row[] = [];
    const pageSize = 1_000;
    let lastProblemId: string | null = null;
    for (;;) {
        let query = content
            .from('problems')
            .select('id,book_id,unit_id,problem_type_id,type_id,middle_unit:metadata->>middle_unit,page_printed,number,is_example')
            .eq('book_id', input.bookId)
            .eq('verified', true)
            .eq('is_example', false)
            .order('id', { ascending: true })
            .limit(pageSize);
        if (queryUnitIds.length > 0) query = query.in('unit_id', queryUnitIds);
        if (lastProblemId) query = query.gt('id', lastProblemId);
        const { data, error } = await query;
        ensureNoError(error, 'Failed to load assignment problem scope');
        const page = (data || []) as Row[];
        problemRows.push(...page);
        if (page.length < pageSize) break;
        lastProblemId = String(page.at(-1)?.id || '');
        if (!lastProblemId) break;
    }

    const selected = new Set<string>();
    const wholeBook = unitIds.length === 0
        && problemTypeIds.length === 0
        && problemScopes.length === 0
        && explicitProblemIds.length === 0;
    for (const row of sortByProblemOrder(problemRows)) {
        const typeId = row.problem_type_id || row.type_id || null;
        if (excludedProblemIds.has(row.id)) continue;
        if (
            (problemScopes.length > 0 && problemMatchesAssignmentScopes(row, problemScopes))
            || (problemScopes.length === 0 && wholeBook)
            || (
                problemScopes.length === 0
                && unitIdSet.size > 0
                && unitIdSet.has(row.unit_id)
                && (problemTypeIdSet.size === 0 || (typeId && problemTypeIdSet.has(typeId)))
            )
            || (
                problemScopes.length === 0
                && unitIdSet.size === 0
                && typeId
                && problemTypeIdSet.has(typeId)
            )
        ) {
            selected.add(row.id);
        }
    }

    return [...selected];
}

function canManageAcrossClasses(context: LmsRoleContext | null | undefined): boolean {
    return !context || context.role === 'owner' || context.role === 'admin' || context.role === 'staff';
}

function forbiddenAssignmentScope(): never {
    throw new LmsAuthError('Only assigned classes and students can be used for this assignment.', 403);
}

async function assertAssignmentInputScope(
    core: SchemaClient,
    context: LmsRoleContext | null | undefined,
    classIds: string[],
    studentIds: string[],
) {
    if (!context || !requiresAssignedClassScope(context.role)) return;

    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    if (!assignedClassIds || assignedClassIds.size === 0) forbiddenAssignmentScope();
    if (classIds.some((classId) => !assignedClassIds.has(classId))) forbiddenAssignmentScope();
    if (studentIds.length === 0) return;

    const { data, error } = await core
        .from('class_students')
        .select('student_id,class_id')
        .in('student_id', studentIds)
        .in('class_id', [...assignedClassIds])
        .eq('status', 'active');
    ensureNoError(error, 'Failed to verify assigned student targets');

    const allowedStudentIds = new Set(((data || []) as Row[]).map((row) => row.student_id));
    if (studentIds.some((studentId) => !allowedStudentIds.has(studentId))) forbiddenAssignmentScope();
}

async function insertAssignmentRecipients(
    core: SchemaClient,
    learning: SchemaClient,
    academyId: string,
    assignmentId: string,
    classIds: string[],
    studentIds: string[],
    addedBy: string | null,
    sourceType: 'class_snapshot' | 'student_direct' | 'manual_add' = 'student_direct',
    excludedStudentIds: string[] = [],
    directClassId: string | null = null,
    personal = false,
) {
    const rowsByStudent = new Map<string, Row>();
    const excluded = new Set(excludedStudentIds);
    if (classIds.length > 0) {
        const { data, error } = await core
            .from('class_students')
            .select('student_id,class_id')
            .in('class_id', classIds)
            .eq('status', 'active');
        ensureNoError(error, 'Failed to load class assignment recipients');
        for (const row of (data || []) as Row[]) {
            if (excluded.has(row.student_id)) continue;
            rowsByStudent.set(row.student_id, {
                assignment_id: assignmentId,
                academy_id: academyId,
                student_id: row.student_id,
                class_id: row.class_id,
                source_type: 'class_snapshot',
                active: true,
                removed_at: null,
                added_by: addedBy,
            });
        }
    }

    if (studentIds.length > 0) {
        if (!directClassId && !personal) {
            throw new Error('개별 과제는 수강 반을 선택하거나 개인 과제로 지정하세요.');
        }
        if (directClassId) {
            const { data: enrollments, error: enrollmentError } = await core
                .from('class_students')
                .select('student_id')
                .eq('class_id', directClassId)
                .eq('status', 'active')
                .in('student_id', studentIds);
            ensureNoError(enrollmentError, 'Failed to verify direct assignment class');
            const enrolled = new Set(((enrollments || []) as Row[]).map((row) => String(row.student_id)));
            if (studentIds.some((studentId) => !enrolled.has(studentId))) {
                throw new Error('선택한 모든 학생이 해당 반에 재원 중이어야 합니다.');
            }
        }
        for (const studentId of studentIds) {
            if (excluded.has(studentId)) continue;
            rowsByStudent.set(studentId, {
                assignment_id: assignmentId,
                academy_id: academyId,
                student_id: studentId,
                class_id: personal ? null : directClassId,
                source_type: sourceType,
                active: true,
                removed_at: null,
                added_by: addedBy,
            });
        }
    }

    const rows = [...rowsByStudent.values()];
    if (rows.length === 0) return 0;
    const { error } = await learning
        .from('assignment_recipients')
        .upsert(rows, { onConflict: 'assignment_id,student_id' });
    ensureNoError(error, 'Failed to create assignment recipients');
    return rows.length;
}

async function assertCanManageAssignmentRecipients(
    core: SchemaClient,
    learning: SchemaClient,
    context: LmsRoleContext,
    assignmentId: string,
    options: { activeOnly?: boolean } = {},
) {
    if (canManageAcrossClasses(context)) return;
    const assignedClassIds = await loadAssignedClassIdsForContext(context);
    if (!assignedClassIds || assignedClassIds.size === 0) forbiddenAssignmentScope();

    let targetQuery = learning
        .from('assignment_targets')
        .select('class_id')
        .eq('assignment_id', assignmentId)
        .eq('target_type', 'class');
    let recipientQuery = learning
        .from('assignment_recipients')
        .select('student_id,class_id')
        .eq('assignment_id', assignmentId);
    if (options.activeOnly !== false) {
        targetQuery = targetQuery.eq('active', true);
        recipientQuery = recipientQuery.eq('active', true);
    }

    const [targetResult, recipientResult] = await Promise.all([targetQuery, recipientQuery]);
    ensureNoError(targetResult.error, 'Failed to verify assignment target scope');
    ensureNoError(recipientResult.error, 'Failed to verify assignment recipient scope');
    const targetRows = (targetResult.data || []) as Row[];
    const recipientRows = (recipientResult.data || []) as Row[];
    if (hasAssignedAssignmentScope(assignedClassIds, targetRows, recipientRows)) return;

    const recipientStudentIds = unresolvedAssignmentRecipientStudentIds(assignedClassIds, recipientRows);
    if (recipientStudentIds.length === 0) forbiddenAssignmentScope();

    const enrollmentResults = await Promise.all(chunkValues(recipientStudentIds).map((studentIds) => core
        .from('class_students')
        .select('student_id,class_id,status')
        .in('student_id', studentIds)
        .in('class_id', [...assignedClassIds])
        .eq('status', 'active')));
    const enrollmentRows: Row[] = [];
    for (const result of enrollmentResults) {
        ensureNoError(result.error, 'Failed to verify direct recipient class scope');
        enrollmentRows.push(...((result.data || []) as Row[]));
    }
    if (!hasAssignedAssignmentScope(
        assignedClassIds,
        targetRows,
        recipientRows,
        enrollmentRows,
    )) forbiddenAssignmentScope();
}

export async function updateClassForAcademy(academyId: string, classId: string, input: UpdateClassInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!input.subjectId) throw new Error('과목을 선택하세요.');
    const targetGrades = normalizeClassTargetGrades(input);
    const instructorIds = normalizeClassInstructorIds(input.instructorIds, input.defaultInstructorId);
    const defaultInstructorId = instructorIds[0] || null;
    if (targetGrades.length === 0) throw new Error('대상 학년을 입력하세요.');
    if (!classId) throw new Error('반을 선택하세요.');
    if (!name) throw new Error('반 이름을 입력하세요.');

    await assertClassesBelongToAcademy(core, academyId, [classId]);
    await assertSubjectBelongsToAcademy(lms, academyId, input.subjectId);
    const { data: existingProfile, error: existingProfileError } = await lms
        .from('class_profiles')
        .select('course_id,subject_id')
        .eq('academy_id', academyId)
        .eq('class_id', classId)
        .maybeSingle();
    ensureNoError(existingProfileError, 'Failed to load current class course context');
    const allowedLegacyCourseId = existingProfile?.subject_id === input.subjectId
        ? existingProfile.course_id || null
        : null;
    if (input.courseId) {
        await assertCourseBelongsToSubject(
            lms,
            academyId,
            input.courseId,
            input.subjectId,
            allowedLegacyCourseId,
        );
    }
    await assertStaffMembersBelongToAcademy(core, academyId, instructorIds);
    await assertClassroomBelongsToAcademy(lms, academyId, input.defaultClassroomId);

    const status = normalizeClassStatus(input.status);
    const active = input.active && status === 'active';

    const { error: classError } = await core
        .from('classes')
        .update({
            name,
            grade: targetGrades[0],
            active,
        })
        .eq('academy_id', academyId)
        .eq('id', classId)
        .select('id')
        .single();
    ensureNoError(classError, 'Failed to update class');

    const { error: profileError } = await lms
        .from('class_profiles')
        .upsert({
            academy_id: academyId,
            class_id: classId,
            subject_id: input.subjectId,
            ...(Object.prototype.hasOwnProperty.call(input, 'courseId')
                ? { course_id: input.courseId || null }
                : {}),
            capacity: input.capacity ?? null,
            color: input.color || null,
            default_instructor_staff_id: defaultInstructorId,
            default_classroom_id: input.defaultClassroomId || null,
            status,
            notes: input.notes || null,
        }, { onConflict: 'class_id' })
        .select('class_id')
        .single();
    ensureNoError(profileError, 'Failed to update class profile');
    await syncClassTargetGrades(lms, academyId, classId, targetGrades);
    await syncClassInstructorAssignments(lms, academyId, classId, instructorIds);

    if (status !== 'active') {
        const { error: rulesError } = await lms
            .from('class_schedule_rules')
            .update({ active: false })
            .eq('academy_id', academyId)
            .eq('class_id', classId)
            .eq('active', true);
        ensureNoError(rulesError, 'Failed to deactivate class schedule rules');
    }
}

async function syncStudentClassAssignments(
    core: SchemaClient,
    academyId: string,
    studentId: string,
    desiredClassIds: string[],
    assignmentStatus: 'active' | 'on_leave' | null,
) {
    const classIds = assignmentStatus ? uniqueClassIds(desiredClassIds) : [];
    await assertClassesBelongToAcademy(core, academyId, classIds);

    const { data: academyClasses, error: classesError } = await core
        .from('classes')
        .select('id')
        .eq('academy_id', academyId);
    ensureNoError(classesError, 'Failed to load academy classes');

    const academyClassIds = (academyClasses || []).map((row: Row) => row.id);
    if (academyClassIds.length > 0) {
        const toDrop = academyClassIds.filter((classId: string) => !classIds.includes(classId));
        if (toDrop.length > 0) {
            const { error } = await core
                .from('class_students')
                .update({ status: 'dropped', primary_class: false, ended_at: new Date().toISOString() })
                .eq('student_id', studentId)
                .in('class_id', toDrop)
                .in('status', ['active', 'on_leave', 'pending']);
            ensureNoError(error, 'Failed to archive removed class assignments');
        }
    }

    const rows = classIds.map((classId, index) => ({
        class_id: classId,
        student_id: studentId,
        status: assignmentStatus,
        primary_class: index === 0,
        ended_at: null,
    }));

    if (rows.length > 0) {
        const { error } = await core
            .from('class_students')
            .upsert(rows, { onConflict: 'class_id,student_id' });
        ensureNoError(error, 'Failed to update student class assignments');
    }
}

async function updateStudentBillingContract(
    lms: SchemaClient,
    academyId: string,
    studentId: string,
    status: StudentStatus,
    input: UpdateStudentInput,
) {
    const { data: currentContract, error: currentError } = await lms
        .from('student_billing_contracts')
        .select('id')
        .eq('academy_id', academyId)
        .eq('student_id', studentId)
        .eq('status', 'active')
        .is('effective_to', null)
        .maybeSingle();
    ensureNoError(currentError, 'Failed to load billing contract');

    if (!isBillableStudentStatus(status)) {
        if (currentContract?.id) {
            const { error } = await lms
                .from('student_billing_contracts')
                .update({ status: 'inactive', effective_to: toSeoulDate(new Date()) })
                .eq('academy_id', academyId)
                .eq('id', currentContract.id);
            ensureNoError(error, 'Failed to close billing contract');
        }
        return;
    }

    let contractId = currentContract?.id as string | undefined;
    if (contractId) {
        const { error } = await lms
            .from('student_billing_contracts')
            .update({
                billing_mode: normalizeBillingMode(input.billingMode),
                base_monthly_fee: input.baseMonthlyFee || 0,
                hourly_rate: input.hourlyRate ?? null,
                status: 'active',
                effective_to: null,
            })
            .eq('academy_id', academyId)
            .eq('id', contractId);
        ensureNoError(error, 'Failed to update billing contract');
    } else {
        const { data: contract, error } = await lms
            .from('student_billing_contracts')
            .insert({
                academy_id: academyId,
                student_id: studentId,
                billing_mode: normalizeBillingMode(input.billingMode),
                base_monthly_fee: input.baseMonthlyFee || 0,
                hourly_rate: input.hourlyRate ?? null,
                status: 'active',
            })
            .select('id')
            .single();
        ensureNoError(error, 'Failed to create billing contract');
        contractId = (contract as Row).id;
    }

    const { error: deleteError } = await lms
        .from('billing_class_rules')
        .delete()
        .eq('academy_id', academyId)
        .eq('contract_id', contractId);
    ensureNoError(deleteError, 'Failed to reset billing class rules');

    const billingRules = defaultBillingRules(input).map((rule) => ({
        academy_id: academyId,
        contract_id: contractId,
        class_id: rule.classId,
        rule_type: rule.ruleType,
        amount: rule.amount || 0,
    }));

    if (billingRules.length > 0) {
        const { error } = await lms.from('billing_class_rules').insert(billingRules);
        ensureNoError(error, 'Failed to update billing class rules');
    }
}

export async function updateStudentForAcademy(academyId: string, studentId: string, input: UpdateStudentInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!studentId) throw new Error('학생을 선택하세요.');
    if (!name) throw new Error('학생 이름을 입력하세요.');

    const { data: student, error: studentError } = await core
        .from('students')
        .select('id,person_id')
        .eq('academy_id', academyId)
        .eq('id', studentId)
        .maybeSingle();
    ensureNoError(studentError, 'Failed to load student');
    if (!student?.id) throw new Error('Selected student does not belong to this academy.');

    const studentStatus = normalizeStudentStatus(input.status);
    const classIds = uniqueClassIds(input.classIds);
    await assertClassesBelongToAcademy(core, academyId, classIds);

    const { error: personError } = await core
        .from('people')
        .update({
            full_name: name,
            display_name: name,
            phone: input.phone || null,
            parent_name: input.parentName || null,
            parent_phone: input.parentPhone || null,
        })
        .eq('id', (student as Row).person_id)
        .eq('primary_academy_id', academyId)
        .select('id')
        .single();
    ensureNoError(personError, 'Failed to update student person');

    const { error: updateError } = await core
        .from('students')
        .update({
            status: studentStatus,
            school_type: input.schoolType || null,
            grade: input.grade || null,
        })
        .eq('academy_id', academyId)
        .eq('id', studentId)
        .select('id')
        .single();
    ensureNoError(updateError, 'Failed to update student');

    const assignmentStatus = studentStatus === 'active'
        ? 'active'
        : studentStatus === 'on_leave'
            ? 'on_leave'
            : null;
    await syncStudentClassAssignments(core, academyId, studentId, classIds, assignmentStatus);
    await updateStudentBillingContract(lms, academyId, studentId, studentStatus, input);
}

function normalizeInstructorHourlyRate(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const hourlyRate = Number(value);
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
        throw new Error('시급은 0 이상의 숫자로 입력하세요.');
    }
    return hourlyRate;
}

async function upsertInstructorPayRate(
    lms: SchemaClient,
    academyId: string,
    instructorId: string,
    effectiveFrom: string,
    hourlyRate: number,
    createdBy?: string | null,
) {
    const { error } = await lms.from('instructor_pay_rates').upsert({
        academy_id: academyId,
        instructor_id: instructorId,
        effective_from: effectiveFrom,
        hourly_rate: hourlyRate,
        active: true,
        ...(createdBy ? { created_by: createdBy } : {}),
    }, { onConflict: 'instructor_id,effective_from' });
    ensureNoError(error, 'Failed to preserve instructor pay-rate history');
}

function isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function upsertInstructorPayRateForAcademy(
    academyId: string,
    input: UpsertInstructorPayRateInput,
    actorPersonId?: string | null,
) {
    if (!input.instructorId) throw new Error('강사를 선택하세요.');
    if (!isCalendarDate(input.effectiveFrom)) throw new Error('시급 적용 시작일을 확인하세요.');
    const hourlyRate = normalizeInstructorHourlyRate(input.hourlyRate);
    if (hourlyRate === null) throw new Error('시급을 입력하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertStaffBelongsToAcademy(core, academyId, input.instructorId);
    await upsertInstructorPayRate(
        lms,
        academyId,
        input.instructorId,
        input.effectiveFrom,
        hourlyRate,
        actorPersonId,
    );

    const today = toSeoulDate(new Date());
    const { data: currentRate, error: currentRateError } = await lms
        .from('instructor_pay_rates')
        .select('hourly_rate')
        .eq('academy_id', academyId)
        .eq('instructor_id', input.instructorId)
        .eq('active', true)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
    ensureNoError(currentRateError, 'Failed to load the current instructor pay rate');
    if (currentRate?.hourly_rate !== null && currentRate?.hourly_rate !== undefined) {
        const { error: staffError } = await core
            .from('staff_members')
            .update({ hourly_rate: Number(currentRate.hourly_rate) })
            .eq('academy_id', academyId)
            .eq('id', input.instructorId)
            .select('id')
            .single();
        ensureNoError(staffError, 'Failed to sync the current instructor pay rate');
    }
}

export async function createStaffForAcademy(academyId: string, input: CreateStaffInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!name) throw new Error('이름을 입력하세요.');
    const hourlyRate = normalizeInstructorHourlyRate(input.hourlyRate);

    const { data: person, error: personError } = await core
        .from('people')
        .insert({
            primary_academy_id: academyId,
            full_name: name,
            display_name: name,
            phone: input.phone || null,
            email: input.email || null,
        })
        .select('id')
        .single();
    ensureNoError(personError, 'Failed to create person');

    const personRow = person as Row;
    try {
        const { data: staff, error: staffError } = await core.from('staff_members')
            .insert({
                academy_id: academyId,
                person_id: personRow.id,
                role: input.role,
                status: 'active',
                hourly_rate: hourlyRate,
                hire_date: input.hireDate || null,
                qualifications: input.qualifications || null,
                notes: input.notes || null,
            })
            .select('id')
            .single();
        ensureNoError(staffError, 'Failed to create staff member');
        if (hourlyRate !== null) {
            await upsertInstructorPayRate(
                lms,
                academyId,
                String((staff as Row).id),
                input.hireDate || toSeoulDate(new Date()),
                hourlyRate,
            );
        }
    } catch (error) {
        await core.from('people').delete().eq('id', personRow.id).eq('primary_academy_id', academyId);
        throw error;
    }
}

export async function updateStaffForAcademy(academyId: string, staffId: string, input: UpdateStaffInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!staffId) throw new Error('강사/직원을 선택하세요.');
    if (!name) throw new Error('이름을 입력하세요.');

    const { data: staff, error: staffError } = await core
        .from('staff_members')
        .select('id,person_id,role,hourly_rate')
        .eq('academy_id', academyId)
        .eq('id', staffId)
        .maybeSingle();
    ensureNoError(staffError, 'Failed to load staff member');
    if (!staff?.id) throw new Error('Selected staff member does not belong to this academy.');
    if ((staff as Row).role === 'owner') throw new Error('Owner role cannot be edited here.');
    const hourlyRate = normalizeInstructorHourlyRate(input.hourlyRate);
    const previousHourlyRate = (staff as Row).hourly_rate === null || (staff as Row).hourly_rate === undefined
        ? null
        : Number((staff as Row).hourly_rate);

    const { error: personError } = await core
        .from('people')
        .update({
            full_name: name,
            display_name: name,
            phone: input.phone || null,
            email: input.email || null,
        })
        .eq('id', (staff as Row).person_id)
        .eq('primary_academy_id', academyId)
        .select('id')
        .single();
    ensureNoError(personError, 'Failed to update staff person');

    const { error: updateError } = await core
        .from('staff_members')
        .update({
            role: normalizeStaffRole(input.role),
            status: normalizeStaffStatus(input.status),
            hourly_rate: hourlyRate,
            hire_date: input.hireDate || null,
            qualifications: input.qualifications || null,
            notes: input.notes || null,
        })
        .eq('academy_id', academyId)
        .eq('id', staffId)
        .select('id')
        .single();
    ensureNoError(updateError, 'Failed to update staff member');

    if (hourlyRate !== previousHourlyRate) {
        await upsertInstructorPayRate(
            lms,
            academyId,
            staffId,
            toSeoulDate(new Date()),
            hourlyRate ?? 0,
        );
    }

    const memberActive = normalizeStaffStatus(input.status) === 'active';
    const { error: memberError } = await core
        .from('academy_members')
        .update({
            role: normalizeStaffRole(input.role),
            active: memberActive,
        })
        .eq('academy_id', academyId)
        .eq('person_id', (staff as Row).person_id)
        .eq('role', (staff as Row).role);
    ensureNoError(memberError, 'Failed to sync staff membership');
}

function isMissingRpc(error: { code?: string } | null): boolean {
    if (!error) return false;
    return error.code === '42883'
        || error.code === 'PGRST202';
}

export async function createScheduleRuleForAcademy(academyId: string, input: CreateScheduleRuleInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertClassesBelongToAcademy(core, academyId, [input.classId]);
    if (input.instructorId) {
        await assertStaffBelongsToAcademy(core, academyId, input.instructorId);
    }
    await assertClassroomBelongsToAcademy(lms, academyId, input.classroomId);

    const profile = await loadClassProfile(lms, academyId, input.classId);
    const { error } = await lms.from('class_schedule_rules').insert({
        academy_id: academyId,
        class_id: input.classId,
        day_of_week: input.dayOfWeek,
        start_time: input.startTime,
        end_time: input.endTime,
        start_date: input.startDate,
        end_date: input.endDate || null,
        interval_weeks: Math.max(1, input.intervalWeeks || 1),
        classroom_id: input.classroomId || profile?.default_classroom_id || null,
        instructor_staff_id: input.instructorId || profile?.default_instructor_staff_id || null,
    });
    ensureNoError(error, 'Failed to create schedule rule');
}

export async function updateScheduleRuleForAcademy(academyId: string, ruleId: string, input: UpdateScheduleRuleInput) {
    if (!ruleId) throw new Error('시간표 규칙을 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');

    const { data: existing, error: existingError } = await lms
        .from('class_schedule_rules')
        .select('id,class_id')
        .eq('academy_id', academyId)
        .eq('id', ruleId)
        .single();
    ensureNoError(existingError, 'Failed to load schedule rule');

    await assertClassesBelongToAcademy(core, academyId, [input.classId]);
    if (input.instructorId) {
        await assertStaffBelongsToAcademy(core, academyId, input.instructorId);
    }
    await assertClassroomBelongsToAcademy(lms, academyId, input.classroomId);

    const profile = await loadClassProfile(lms, academyId, input.classId);
    const { error } = await lms
        .from('class_schedule_rules')
        .update({
            class_id: input.classId,
            day_of_week: input.dayOfWeek,
            start_time: input.startTime,
            end_time: input.endTime,
            start_date: input.startDate,
            end_date: input.endDate || null,
            interval_weeks: Math.max(1, input.intervalWeeks || 1),
            classroom_id: input.classroomId || profile?.default_classroom_id || null,
            instructor_staff_id: input.instructorId || profile?.default_instructor_staff_id || null,
            active: input.active,
        })
        .eq('academy_id', academyId)
        .eq('id', (existing as Row).id)
        .select('id')
        .single();
    ensureNoError(error, 'Failed to update schedule rule');
}

function scheduleRpcParams(academyId: string, input: ScheduleMutationInput) {
    const instructorIds = uniqueStrings([
        ...(input.instructorIds || []),
        ...(input.participants || []).map((participant) => participant.instructorId),
        input.instructorId,
    ]);
    return {
        p_academy_id: academyId,
        p_kind: input.kind,
        p_class_id: input.classId,
        p_rule_id: input.ruleId || null,
        p_occurrence_id: input.occurrenceId || null,
        p_date: input.date || null,
        p_day_of_week: input.dayOfWeek ?? null,
        p_start_date: input.startDate || null,
        p_end_date: input.endDate || null,
        p_interval_weeks: Math.max(1, input.intervalWeeks || 1),
        p_start_time: input.startTime,
        p_end_time: input.endTime,
        p_instructor_id: instructorIds[0] || null,
        p_classroom_id: input.classroomId || null,
    };
}

export async function findScheduleConflictsForAcademy(
    academyId: string,
    input: ScheduleMutationInput,
): Promise<ScheduleConflict[]> {
    if (input.kind === 'single' && input.status === 'cancelled') return [];
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertStaffMembersBelongToAcademy(core, academyId, scheduleParticipantStaffIds(input));
    const instructorIds = uniqueStrings([
        ...(input.instructorIds || []),
        ...(input.participants || []).map((participant) => participant.instructorId),
        input.instructorId,
    ]);
    const checks = instructorIds.length > 0 ? instructorIds : [null];
    const conflicts = new Map<string, ScheduleConflict>();
    for (const instructorId of checks) {
        const params = { ...scheduleRpcParams(academyId, input), p_instructor_id: instructorId };
        const { data, error } = await lms.rpc('schedule_conflicts_v1', params);
        ensureNoError(error, 'Failed to check schedule conflicts');
        for (const conflict of (Array.isArray(data) ? data : []) as ScheduleConflict[]) {
            const key = `${conflict.kind}:${conflict.source}:${conflict.id}:${conflict.date || ''}`;
            conflicts.set(key, conflict);
        }
    }
    return [...conflicts.values()];
}

async function syncScheduleParticipants(
    lms: SchemaClient,
    academyId: string,
    input: ScheduleMutationInput,
    result: Row,
) {
    const resultId = String(result.id || '');
    if (!resultId) return;
    const instructorIds = uniqueStrings([
        ...(input.instructorIds || []),
        ...(input.participants || []).map((participant) => participant.instructorId),
        input.instructorId,
    ]);

    if (input.kind === 'recurring') {
        const { error: deleteError } = await lms
            .from('class_schedule_rule_instructors')
            .delete()
            .eq('academy_id', academyId)
            .eq('rule_id', resultId);
        ensureNoError(deleteError, 'Failed to replace recurring lesson participants');
        if (instructorIds.length > 0) {
            const { error: insertError } = await lms.from('class_schedule_rule_instructors').insert(
                instructorIds.map((instructorId, index) => ({
                    rule_id: resultId,
                    academy_id: academyId,
                    class_id: input.classId,
                    instructor_staff_id: instructorId,
                    active: true,
                    sort_order: index,
                })),
            );
            ensureNoError(insertError, 'Failed to save recurring lesson participants');
        }
        return;
    }

    const duration = minutesBetween(input.startTime, input.endTime);
    const explicitParticipants = input.participants?.length
        ? input.participants
        : instructorIds.map((instructorId) => ({
            instructorId,
            participationKind: input.substituteInstructorId === instructorId ? 'substitute' as const : 'regular' as const,
            payableMinutes: duration,
            replacesInstructorId: input.substituteInstructorId === instructorId ? input.instructorId || null : null,
        }));
    const { error: deleteError } = await lms
        .from('lesson_occurrence_instructors')
        .delete()
        .eq('academy_id', academyId)
        .eq('occurrence_id', resultId);
    ensureNoError(deleteError, 'Failed to replace lesson participants');
    if (explicitParticipants.length > 0) {
        const { error: insertError } = await lms.from('lesson_occurrence_instructors').insert(
            explicitParticipants.map((participant) => ({
                occurrence_id: resultId,
                academy_id: academyId,
                class_id: input.classId,
                instructor_staff_id: participant.instructorId,
                participation_kind: participant.participationKind || 'regular',
                payable_minutes: input.status === 'cancelled'
                    ? 0
                    : Math.min(duration, Math.max(0, participant.payableMinutes ?? duration)),
                replaces_staff_id: participant.replacesInstructorId || null,
            })),
        );
        ensureNoError(insertError, 'Failed to save lesson participants');
    }
}

export async function mutateScheduleForAcademy(
    academyId: string,
    input: ScheduleMutationInput,
    actor: LmsRoleContext,
): Promise<{ kind: string; id: string; conflicts: ScheduleConflict[] }> {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertStaffMembersBelongToAcademy(core, academyId, scheduleParticipantStaffIds(input));
    const params = scheduleRpcParams(academyId, input);
    const overrideAllowed = actor.role === 'owner' || actor.role === 'admin';
    const convertingSingleToRecurring = input.kind === 'recurring'
        && Boolean(input.occurrenceId)
        && !input.ruleId;
    const { data, error } = convertingSingleToRecurring
        ? await lms.rpc('convert_single_schedule_to_recurring_v1', {
            p_academy_id: academyId,
            p_class_id: input.classId,
            p_occurrence_id: input.occurrenceId,
            p_day_of_week: input.dayOfWeek ?? null,
            p_start_date: input.startDate || null,
            p_end_date: input.endDate || null,
            p_interval_weeks: Math.max(1, input.intervalWeeks || 1),
            p_start_time: input.startTime,
            p_end_time: input.endTime,
            p_instructor_id: input.instructorId || null,
            p_classroom_id: input.classroomId || null,
            p_conflict_override_reason: input.conflictOverrideReason || null,
            p_conflict_override_allowed: overrideAllowed,
            p_actor_person_id: actor.personId,
        })
        : await lms.rpc('mutate_schedule_v1', {
            ...params,
            p_scope: input.scope,
            p_substitute_instructor_id: input.substituteInstructorId || null,
            p_status: lessonStatusRpcValue(input.status || 'normal'),
            p_cancel_reason: input.cancelReason || null,
            p_notes: input.notes || null,
            p_conflict_override_reason: input.conflictOverrideReason || null,
            p_conflict_override_allowed: overrideAllowed,
            p_actor_person_id: actor.personId,
        });
    ensureNoError(error, 'Failed to mutate schedule');
    const result = data && typeof data === 'object' ? data as Row : {};
    await syncScheduleParticipants(lms, academyId, input, result);
    return {
        kind: String(result.kind || input.kind),
        id: String(result.id || ''),
        conflicts: Array.isArray(result.conflicts) ? result.conflicts as ScheduleConflict[] : [],
    };
}

function scheduleParticipantStaffIds(input: ScheduleMutationInput): string[] {
    return uniqueStrings([
        ...(input.instructorIds || []),
        ...(input.participants || []).flatMap((participant) => [
            participant.instructorId,
            participant.replacesInstructorId,
        ]),
        input.instructorId,
        input.substituteInstructorId,
    ]);
}

export async function deleteScheduleForAcademy(
    academyId: string,
    input: DeleteScheduleInput,
    actor: LmsRoleContext,
): Promise<{ kind: string; id: string; scope: string; removedOccurrences: number; preservedOccurrences: number }> {
    const client = createAdminClient();
    const lms = client.schema('lms');
    const { data, error } = await lms.rpc('delete_schedule_v1', {
        p_academy_id: academyId,
        p_class_id: input.classId,
        p_rule_id: input.ruleId || null,
        p_occurrence_id: input.occurrenceId || null,
        p_date: input.date,
        p_scope: input.ruleId ? input.scope : 'single',
        p_actor_person_id: actor.personId,
    });
    ensureNoError(error, 'Failed to delete schedule');
    const result = data && typeof data === 'object' ? data as Row : {};
    return {
        kind: String(result.kind || (input.ruleId ? 'recurring' : 'single')),
        id: String(result.id || input.ruleId || input.occurrenceId || ''),
        scope: String(result.scope || input.scope),
        removedOccurrences: toNumber(result.removedOccurrences),
        preservedOccurrences: toNumber(result.preservedOccurrences),
    };
}

export async function changeClassMembersForAcademy(
    academyId: string,
    input: ClassMembershipChangeInput,
): Promise<{ added: number; removed: number }> {
    const client = createAdminClient();
    const lms = client.schema('lms');
    const { data, error } = await lms.rpc('change_class_members_v1', {
        p_academy_id: academyId,
        p_class_id: input.classId,
        p_effective_date: input.effectiveDate,
        p_changes: input.changes,
    });
    ensureNoError(error, 'Failed to change class members');
    const result = data && typeof data === 'object' ? data as Row : {};
    return { added: toNumber(result.added), removed: toNumber(result.removed) };
}

export async function recordAttendanceBatchForAcademy(
    academyId: string,
    input: BatchAttendanceInput,
    actor: LmsRoleContext,
): Promise<{ occurrenceId: string; recorded: number }> {
    const client = createAdminClient();
    const lms = client.schema('lms');
    const records = input.records.map((record) => ({
        student_id: record.studentId,
        status: record.status,
        attended_minutes: record.attendedMinutes ?? null,
        billable_minutes: record.billableMinutes ?? null,
        notes: record.notes || null,
    }));
    const { data, error } = await lms.rpc('record_attendance_batch_v1', {
        p_academy_id: academyId,
        p_occurrence_id: input.occurrenceId || null,
        p_class_id: input.classId,
        p_rule_id: input.ruleId || null,
        p_date: input.date,
        p_start_time: input.startTime,
        p_end_time: input.endTime,
        p_records: records,
        p_recorded_by: actor.personId,
    });
    ensureNoError(error, 'Failed to record attendance batch');
    const result = data && typeof data === 'object' ? data as Row : {};
    const occurrenceId = String(result.occurrenceId || '');
    if (!occurrenceId) throw new Error('출결 수업 회차를 확인하지 못했습니다.');
    await ensureMaterializedLessonParticipants(lms, academyId, occurrenceId);
    return { occurrenceId, recorded: toNumber(result.recorded) };
}

export async function setClassBookForAcademy(academyId: string, classId: string, bookId: string, active: boolean) {
    if (!classId || !bookId) throw new Error('반과 교재를 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    await assertClassesBelongToAcademy(core, academyId, [classId]);
    await assertBookAssignableToAcademy(content, academyId, bookId);

    const { data: existing, error: existingError } = await learning
        .from('book_assignments')
        .select('id')
        .eq('academy_id', academyId)
        .eq('target_type', 'class')
        .eq('class_id', classId)
        .eq('book_id', bookId)
        .maybeSingle();
    ensureNoError(existingError, 'Failed to load class book assignment');

    if (existing?.id) {
        const updatePayload: Row = { active };
        if (active) updatePayload.assigned_at = new Date().toISOString();
        const { error } = await learning
            .from('book_assignments')
            .update(updatePayload)
            .eq('id', existing.id);
        ensureNoError(error, 'Failed to update class book assignment');
        return;
    }

    if (!active) return;

    const { error } = await learning
        .from('book_assignments')
        .insert({
            academy_id: academyId,
            book_id: bookId,
            target_type: 'class',
            class_id: classId,
            active: true,
            assigned_at: new Date().toISOString(),
        });
    ensureNoError(error, 'Failed to assign class book');
}

export async function issueStudentInvitationForAcademy(
    academyId: string,
    studentId: string,
    loginHint?: string | null,
) {
    if (!studentId) throw new Error('Student is required.');

    const client = createAdminClient();
    const core = client.schema('core');
    await assertStudentBelongsToAcademy(core, academyId, studentId);

    const { data: student, error: studentError } = await core
        .from('students')
        .select('id,person_id')
        .eq('academy_id', academyId)
        .eq('id', studentId)
        .maybeSingle();
    ensureNoError(studentError, 'Failed to load student');
    if (!student?.person_id) throw new Error('Student is not linked to a person record.');

    const { data: existingMembers, error: existingMembersError } = await core
        .from('academy_members')
        .select('id,user_account_id')
        .eq('academy_id', academyId)
        .eq('person_id', student.person_id)
        .eq('role', 'student')
        .eq('active', true)
        .not('user_account_id', 'is', null)
        .limit(1);
    ensureNoError(existingMembersError, 'Failed to verify student account');
    if ((existingMembers || []).length > 0) {
        throw new Error('This student already has a grade-app account.');
    }

    const { data: acceptedInvites, error: acceptedInviteError } = await core
        .from('account_invitations')
        .select('id')
        .eq('academy_id', academyId)
        .eq('student_id', studentId)
        .eq('role', 'student')
        .not('accepted_at', 'is', null)
        .limit(1);
    ensureNoError(acceptedInviteError, 'Failed to verify student invitation');
    if ((acceptedInvites || []).length > 0) {
        throw new Error('This student already used a grade-app signup code.');
    }

    const { error: pendingDeleteError } = await core
        .from('account_invitations')
        .delete()
        .eq('academy_id', academyId)
        .eq('student_id', studentId)
        .eq('role', 'student')
        .is('accepted_at', null);
    ensureNoError(pendingDeleteError, 'Failed to clear pending student invitations');

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const inviteCode = newInviteCode();
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const { error } = await core
            .from('account_invitations')
            .insert({
                academy_id: academyId,
                person_id: student.person_id,
                student_id: studentId,
                role: 'student',
                invite_code_hash: hashInviteCode(inviteCode),
                invite_code_display: inviteCode,
                login_hint: loginHint?.trim() || null,
                expires_at: expiresAt,
            });

        if (!error) {
            return {
                inviteCode,
                expiresAt,
                loginHint: loginHint?.trim() || null,
            };
        }
        if (!String(error.message ?? '').toLowerCase().includes('duplicate')) {
            ensureNoError(error, 'Failed to issue invitation');
        }
    }

    throw new Error('Failed to generate a unique invite code.');
}

async function loadAssignmentClassContextSnapshots(
    core: SchemaClient,
    lms: SchemaClient,
    academyId: string,
    classIds: string[],
): Promise<Row[]> {
    if (classIds.length === 0) return [];
    const [classesResult, profilesResult, gradesResult] = await Promise.all([
        core.from('classes').select('id,name,grade').eq('academy_id', academyId).in('id', classIds),
        lms.from('class_profiles').select('class_id,subject_id,course_id').eq('academy_id', academyId).in('class_id', classIds),
        lms.from('class_target_grades').select('class_id,grade_code,is_primary,sort_order').eq('academy_id', academyId).in('class_id', classIds),
    ]);
    ensureNoError(classesResult.error, 'Failed to snapshot assignment classes');
    ensureNoError(profilesResult.error, 'Failed to snapshot assignment class profiles');
    ensureNoError(gradesResult.error, 'Failed to snapshot assignment target grades');

    const profiles = (profilesResult.data || []) as Row[];
    const subjectIds = uniqueStrings(profiles.map((row) => row.subject_id));
    const courseIds = uniqueStrings(profiles.map((row) => row.course_id));
    const [subjectsResult, coursesResult] = await Promise.all([
        subjectIds.length
            ? lms.from('subjects').select('id,name').eq('academy_id', academyId).in('id', subjectIds)
            : Promise.resolve({ data: [], error: null }),
        courseIds.length
            ? lms.from('courses').select('id,title').eq('academy_id', academyId).in('id', courseIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    ensureNoError(subjectsResult.error, 'Failed to snapshot assignment subjects');
    ensureNoError(coursesResult.error, 'Failed to snapshot assignment courses');

    const profileByClass = new Map(profiles.map((row) => [String(row.class_id), row]));
    const subjectById = new Map(((subjectsResult.data || []) as Row[]).map((row) => [String(row.id), String(row.name)]));
    const courseById = new Map(((coursesResult.data || []) as Row[]).map((row) => [String(row.id), String(row.title)]));
    const gradesByClass = new Map<string, Row[]>();
    for (const grade of (gradesResult.data || []) as Row[]) {
        const values = gradesByClass.get(String(grade.class_id)) || [];
        values.push(grade);
        gradesByClass.set(String(grade.class_id), values);
    }
    const capturedAt = new Date().toISOString();
    return ((classesResult.data || []) as Row[]).map((classRow) => {
        const profile = profileByClass.get(String(classRow.id));
        const grades = (gradesByClass.get(String(classRow.id)) || [])
            .sort((left, right) => Number(right.is_primary) - Number(left.is_primary)
                || Number(left.sort_order || 0) - Number(right.sort_order || 0))
            .map((row) => String(row.grade_code));
        const subjectId = profile?.subject_id ? String(profile.subject_id) : null;
        const courseId = profile?.course_id ? String(profile.course_id) : null;
        return {
            classId: String(classRow.id),
            className: String(classRow.name),
            targetGrades: grades.length > 0 ? grades : classRow.grade ? [String(classRow.grade)] : [],
            subjectId,
            subjectName: subjectId ? subjectById.get(subjectId) || null : null,
            courseId,
            courseTitle: courseId ? courseById.get(courseId) || null : null,
            capturedAt,
        };
    });
}

export async function createLearningAssignmentForAcademy(
    academyId: string,
    input: CreateLearningAssignmentInput,
    context?: LmsRoleContext,
) {
    const title = input.title?.trim();
    if (!title) throw new Error('Assignment title is required.');

    const classIds = uniqueClassIds(input.classIds);
    const studentIds = uniqueStrings(input.studentIds || []);
    const excludedStudentIds = uniqueStrings(input.excludedStudentIds || []);
    const learningAnalysisActions = normalizeLearningAnalysisActions(input.learningAnalysisActions);
    const excludedStudentIdSet = new Set(excludedStudentIds);
    if (classIds.length === 0 && studentIds.length === 0) {
        throw new Error('Assignment target is required.');
    }
    if (input.personal && input.directClassId) {
        throw new Error('개인 과제와 수강 반 과제 맥락을 동시에 선택할 수 없습니다.');
    }
    if (studentIds.length > 0 && !input.personal && !input.directClassId) {
        throw new Error('개별 과제는 수강 반을 선택하거나 개인 과제로 지정하세요.');
    }
    if (learningAnalysisActions.length > 0) {
        const actionStudentIds = new Set(learningAnalysisActions.map((action) => action.studentId));
        if (
            classIds.length > 0
            || excludedStudentIds.length > 0
            || actionStudentIds.size !== studentIds.length
            || studentIds.some((studentId) => !actionStudentIds.has(studentId))
        ) {
            throw new Error('Learning analysis assignments must keep their reviewed student targets.');
        }
    }

    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    const learning = client.schema('learning');
    const lms = client.schema('lms');

    await Promise.all([
        assertClassesBelongToAcademy(core, academyId, uniqueStrings([...classIds, input.directClassId])),
        assertStudentsBelongToAcademy(core, academyId, uniqueStrings([...studentIds, ...excludedStudentIds])),
    ]);
    await assertAssignmentInputScope(core, context, classIds, uniqueStrings([...studentIds, ...excludedStudentIds]));
    if (input.directClassId && studentIds.length > 0) {
        const { data: directEnrollments, error: directEnrollmentError } = await core
            .from('class_students')
            .select('student_id')
            .eq('class_id', input.directClassId)
            .eq('status', 'active')
            .in('student_id', studentIds);
        ensureNoError(directEnrollmentError, 'Failed to verify direct assignment class');
        const enrolled = new Set(((directEnrollments || []) as Row[]).map((row) => String(row.student_id)));
        if (studentIds.some((studentId) => !enrolled.has(studentId))) {
            throw new Error('선택한 모든 학생이 해당 반에 재원 중이어야 합니다.');
        }
    }
    if (input.bookId) {
        await assertBookAssignableToAcademy(content, academyId, input.bookId, {
            allowAssignmentHidden: input.sourceType === 'worksheet',
        });
    }
    if (learningAnalysisActions.length > 0) {
        const skillIds = uniqueStrings(learningAnalysisActions.map((action) => action.skillId));
        const { data: skills, error: skillError } = await content
            .from('analysis_skills')
            .select('id')
            .eq('active', true)
            .in('id', skillIds);
        ensureNoError(skillError, 'Failed to verify learning analysis actions');
        if ((skills || []).length !== skillIds.length) {
            throw new Error('Learning analysis actions contain unavailable skills.');
        }
    }

    const problemIds = await resolveAssignmentProblemIds(content, input);
    if (input.bookId && input.sourceType !== 'worksheet' && problemIds.length === 0) {
        throw new Error('The selected assignment scope contains no problems.');
    }

    const classContextSnapshots = await loadAssignmentClassContextSnapshots(
        core,
        lms,
        academyId,
        uniqueStrings([...classIds, input.directClassId]),
    );
    const assignmentMetadata = {
        unitIds: input.unitIds || [],
        problemTypeIds: input.problemTypeIds || [],
        problemScopes: normalizeAssignmentProblemScopes(input.problemScopes),
        directContext: studentIds.length > 0
            ? { kind: input.personal ? 'personal' : 'class', classId: input.directClassId || null }
            : null,
        classContexts: classContextSnapshots,
        ...(learningAnalysisActions.length > 0 ? {
            learningAnalysis: {
                source: 'action_queue',
                actions: learningAnalysisActions,
            },
        } : {}),
    };

    if (input.bookId && input.sourceType !== 'worksheet' && process.env.LMS_USE_V2_MUTATIONS !== 'false') {
        const { data: rpcData, error: rpcError } = await learning.rpc('create_assignment_v2', {
            p_academy_id: academyId,
            p_book_id: input.bookId,
            p_title: title,
            p_problem_ids: problemIds,
            p_class_ids: classIds,
            p_student_ids: studentIds,
            p_description: input.description?.trim() || null,
            p_context: input.context || 'homework',
            p_due_at: input.dueAt || null,
            p_available_from: null,
            p_metadata: assignmentMetadata,
            p_excluded_student_ids: excludedStudentIds,
            p_created_by: context?.personId || null,
            p_source_type: input.sourceType || 'content_scope',
        });
        if (!rpcError) {
            const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as Row | null;
            if (!row?.assignment_id) throw new Error('Assignment transaction returned no assignment id.');
            if (studentIds.length > 0) {
                await insertAssignmentRecipients(
                    core,
                    learning,
                    academyId,
                    String(row.assignment_id),
                    [],
                    studentIds,
                    context?.personId || null,
                    'student_direct',
                    excludedStudentIds,
                    input.directClassId || null,
                    input.personal === true,
                );
            }
            return {
                id: String(row.assignment_id),
                mutationId: row.mutation_id ? String(row.mutation_id) : null,
                itemCount: toNumber(row.item_count),
                recipientCount: toNumber(row.recipient_count),
            };
        }
        if (!isMissingRpc(rpcError)) {
            ensureNoError(rpcError, 'Failed to create assignment transaction');
        }
    }
    const problemRows: Row[] = [];
    if (problemIds.length > 0) {
        const verificationBatchSize = 500;
        for (let offset = 0; offset < problemIds.length; offset += verificationBatchSize) {
            const { data, error } = await content
                .from('problems')
                .select('id,book_id,unit_id')
                .in('id', problemIds.slice(offset, offset + verificationBatchSize))
                .eq('verified', true);
            ensureNoError(error, 'Failed to verify assignment problems');
            problemRows.push(...((data || []) as Row[]));
        }
        if (problemRows.length !== problemIds.length) {
            throw new Error('One or more selected problems do not exist.');
        }
        if (input.bookId && problemRows.some((row) => row.book_id !== input.bookId)) {
            throw new Error('Selected problems do not belong to the selected book.');
        }
    }
    const problemById = new Map(problemRows.map((row) => [row.id, row]));

    const { data: assignment, error: assignmentError } = await learning
        .from('assignments')
        .insert({
            academy_id: academyId,
            book_id: input.bookId || null,
            unit_id: input.unitIds?.length === 1 ? input.unitIds[0] : null,
            problem_id: problemIds.length === 1 ? problemIds[0] : null,
            title,
            description: input.description?.trim() || null,
            context: input.context || 'homework',
            due_at: input.dueAt || null,
            active: true,
            source_type: input.sourceType || 'content_scope',
            status: 'published',
            published_at: new Date().toISOString(),
            metadata: assignmentMetadata,
        })
        .select('id')
        .single();
    ensureNoError(assignmentError, 'Failed to create assignment');
    if (!assignment?.id) throw new Error('Assignment was not created.');
    const assignmentId = assignment.id as string;

    const targetRows = [
        ...classIds.map((classId) => ({
            assignment_id: assignmentId,
            target_type: 'class',
            class_id: classId,
            student_id: null,
            lms_lesson_id: null,
            active: true,
        })),
        ...studentIds.filter((studentId) => !excludedStudentIdSet.has(studentId)).map((studentId) => ({
            assignment_id: assignmentId,
            target_type: 'student',
            class_id: null,
            student_id: studentId,
            lms_lesson_id: null,
            active: true,
        })),
    ];
    const { error: targetError } = await learning.from('assignment_targets').insert(targetRows);
    ensureNoError(targetError, 'Failed to create assignment targets');
    const recipientCount = await insertAssignmentRecipients(
        core,
        learning,
        academyId,
        assignmentId,
        classIds,
        studentIds,
        context?.personId || null,
        'student_direct',
        excludedStudentIds,
        input.directClassId || null,
        input.personal === true,
    );
    if (recipientCount === 0) {
        const { error: cleanupError } = await learning
            .from('assignments')
            .delete()
            .eq('id', assignmentId);
        ensureNoError(cleanupError, 'Failed to roll back an assignment with no active recipients');
        throw new Error('Assignment targets produced no active recipients.');
    }

    if (problemIds.length > 0) {
        const itemRows = problemIds.map((problemId, index) => ({
            assignment_id: assignmentId,
            book_id: input.bookId || null,
            unit_id: problemById.get(problemId)?.unit_id || null,
            problem_id: problemId,
            sort_order: index,
            required: true,
        }));
        const insertBatchSize = 500;
        for (let offset = 0; offset < itemRows.length; offset += insertBatchSize) {
            const { error: itemError } = await learning
                .from('assignment_items')
                .insert(itemRows.slice(offset, offset + insertBatchSize));
            ensureNoError(itemError, 'Failed to create assignment items');
        }
    }

    return { id: assignmentId };
}

export async function addAssignmentRecipientsForAcademy(
    context: LmsRoleContext,
    assignmentId: string,
    studentIds: string[],
) {
    const ids = uniqueStrings(studentIds);
    if (!assignmentId || ids.length === 0) return;

    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const { data: assignment, error } = await learning
        .from('assignments')
        .select('id,academy_id')
        .eq('id', assignmentId)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(error, 'Failed to load assignment');
    if (!assignment?.id) throw new Error('Assignment was not found.');

    await assertCanManageAssignmentRecipients(core, learning, context, assignmentId);
    await assertStudentsBelongToAcademy(core, context.academyId, ids);
    await assertAssignmentInputScope(core, context, [], ids);
    const { data: classTargets, error: targetError } = await learning
        .from('assignment_targets')
        .select('class_id')
        .eq('assignment_id', assignmentId)
        .eq('target_type', 'class')
        .eq('active', true)
        .not('class_id', 'is', null);
    ensureNoError(targetError, 'Failed to load assignment class context');
    const targetClassIds = uniqueStrings(((classTargets || []) as Row[]).map((row) => row.class_id));
    let directClassId = targetClassIds.length === 1 ? targetClassIds[0] : null;
    if (directClassId) {
        const { data: enrollments, error: enrollmentError } = await core
            .from('class_students')
            .select('student_id')
            .eq('class_id', directClassId)
            .eq('status', 'active')
            .in('student_id', ids);
        ensureNoError(enrollmentError, 'Failed to verify added recipient class context');
        if ((enrollments || []).length !== ids.length) directClassId = null;
    }
    await insertAssignmentRecipients(
        core,
        learning,
        context.academyId,
        assignmentId,
        [],
        ids,
        context.personId,
        'manual_add',
        [],
        directClassId,
        !directClassId,
    );
}

export async function removeAssignmentRecipientForAcademy(
    context: LmsRoleContext,
    assignmentId: string,
    studentId: string,
) {
    if (!assignmentId || !studentId) return;

    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const { data: assignment, error } = await learning
        .from('assignments')
        .select('id,academy_id')
        .eq('id', assignmentId)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(error, 'Failed to load assignment');
    if (!assignment?.id) throw new Error('Assignment was not found.');

    await assertCanManageAssignmentRecipients(core, learning, context, assignmentId);
    await assertStudentsBelongToAcademy(core, context.academyId, [studentId]);
    await assertAssignmentInputScope(core, context, [], [studentId]);

    const { error: updateError } = await learning
        .from('assignment_recipients')
        .update({ active: false, removed_at: new Date().toISOString() })
        .eq('assignment_id', assignmentId)
        .eq('student_id', studentId);
    ensureNoError(updateError, 'Failed to remove assignment recipient');
}

export async function recallLearningAssignmentForAcademy(
    context: LmsRoleContext,
    assignmentId: string,
) {
    if (!assignmentId) throw new Error('Assignment id is required.');

    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const { data: assignment, error } = await learning
        .from('assignments')
        .select('id,academy_id,active,status,metadata')
        .eq('id', assignmentId)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(error, 'Failed to load assignment');
    if (!assignment?.id) throw new Error('Assignment was not found.');

    await assertCanManageAssignmentRecipients(core, learning, context, assignmentId);

    const recalledAt = new Date().toISOString();
    const metadata = {
        ...(((assignment as Row).metadata || {}) as Row),
        recalled_at: recalledAt,
        recalled_by: context.personId,
    };

    const { error: assignmentError } = await learning
        .from('assignments')
        .update({
            active: false,
            status: 'archived',
            metadata,
            updated_at: recalledAt,
        })
        .eq('id', assignmentId)
        .eq('academy_id', context.academyId);
    ensureNoError(assignmentError, 'Failed to recall assignment');

    const { error: targetError } = await learning
        .from('assignment_targets')
        .update({ active: false })
        .eq('assignment_id', assignmentId);
    ensureNoError(targetError, 'Failed to recall assignment targets');

    const { error: recipientError } = await learning
        .from('assignment_recipients')
        .update({ active: false, removed_at: recalledAt })
        .eq('assignment_id', assignmentId);
    ensureNoError(recipientError, 'Failed to recall assignment recipients');
}

export async function deleteLearningAssignmentForAcademy(
    context: LmsRoleContext,
    assignmentId: string,
) {
    if (!assignmentId) throw new Error('Assignment id is required.');

    const client = createAdminClient();
    const core = client.schema('core');
    const learning = client.schema('learning');
    const { data: assignment, error } = await learning
        .from('assignments')
        .select('id,academy_id')
        .eq('id', assignmentId)
        .eq('academy_id', context.academyId)
        .maybeSingle();
    ensureNoError(error, 'Failed to load assignment');
    if (!assignment?.id) throw new Error('Assignment was not found.');

    await assertCanManageAssignmentRecipients(core, learning, context, assignmentId, { activeOnly: false });

    const { error: deleteError } = await learning
        .from('assignments')
        .delete()
        .eq('id', assignmentId)
        .eq('academy_id', context.academyId);
    ensureNoError(deleteError, 'Failed to delete assignment');
}

async function ensureLessonOccurrence(
    lms: SchemaClient,
    academyId: string,
    input: {
        occurrenceId?: string | null;
        classId: string;
        ruleId?: string | null;
        date: string;
        startTime: string;
        endTime: string;
    },
): Promise<string> {
    if (input.occurrenceId) {
        const { data, error } = await lms
            .from('lesson_occurrences')
            .select('id')
            .eq('academy_id', academyId)
            .eq('class_id', input.classId)
            .eq('id', input.occurrenceId)
            .maybeSingle();
        ensureNoError(error, 'Failed to verify occurrence');
        if (!data?.id) throw new Error('Selected occurrence does not belong to this academy.');
        await ensureMaterializedLessonParticipants(lms, academyId, input.occurrenceId);
        return input.occurrenceId;
    }

    const row = {
        academy_id: academyId,
        class_id: input.classId,
        rule_id: input.ruleId || null,
        occurrence_date: input.date,
        start_time: input.startTime,
        end_time: input.endTime,
        status: lessonStatusRpcValue('normal'),
    };

    const { data, error } = await lms.from('lesson_occurrences').insert(row).select('id').single();
    if (!error) {
        const createdId = String((data as Row).id);
        await ensureMaterializedLessonParticipants(lms, academyId, createdId);
        return createdId;
    }

    const maybeDuplicate = (error as Row).code === '23505';
    if (!maybeDuplicate) throw new Error(error.message);

    let query = lms
        .from('lesson_occurrences')
        .select('id')
        .eq('academy_id', academyId)
        .eq('class_id', input.classId)
        .eq('occurrence_date', input.date)
        .eq('start_time', input.startTime);

    query = input.ruleId ? query.eq('rule_id', input.ruleId) : query.is('rule_id', null);
    const { data: existing, error: existingError } = await query.limit(1).maybeSingle();
    ensureNoError(existingError, 'Failed to load existing occurrence');
    if (!existing?.id) throw new Error('수업 회차를 생성하지 못했습니다.');
    await ensureMaterializedLessonParticipants(lms, academyId, String(existing.id));
    return existing.id;
}

async function ensureMaterializedLessonParticipants(
    lms: SchemaClient,
    academyId: string,
    occurrenceId: string,
): Promise<void> {
    const { count, error: countError } = await lms
        .from('lesson_occurrence_instructors')
        .select('occurrence_id', { count: 'exact', head: true })
        .eq('academy_id', academyId)
        .eq('occurrence_id', occurrenceId);
    ensureNoError(countError, 'Failed to verify materialized lesson participants');
    if ((count || 0) > 0) return;

    const { data: occurrence, error: occurrenceError } = await lms
        .from('lesson_occurrences')
        .select('id,class_id,rule_id,status,duration_minutes,instructor_staff_id,substitute_staff_id')
        .eq('academy_id', academyId)
        .eq('id', occurrenceId)
        .single();
    ensureNoError(occurrenceError, 'Failed to load materialized lesson');
    const row = occurrence as Row;
    const duration = row.status === 'cancelled' ? 0 : Math.max(0, toNumber(row.duration_minutes));

    if (row.substitute_staff_id) {
        const { error } = await lms.from('lesson_occurrence_instructors').insert({
            occurrence_id: occurrenceId,
            academy_id: academyId,
            class_id: row.class_id,
            instructor_staff_id: row.substitute_staff_id,
            participation_kind: 'substitute',
            payable_minutes: duration,
            replaces_staff_id: row.instructor_staff_id || null,
        });
        ensureNoError(error, 'Failed to materialize substitute instructor');
        return;
    }

    let participants: Row[] = [];
    if (row.rule_id) {
        const { data, error } = await lms
            .from('class_schedule_rule_instructors')
            .select('instructor_staff_id,sort_order')
            .eq('academy_id', academyId)
            .eq('rule_id', row.rule_id)
            .eq('active', true)
            .order('sort_order');
        ensureNoError(error, 'Failed to load recurring lesson participants');
        participants = (data || []) as Row[];
    }
    if (participants.length === 0 && row.instructor_staff_id) {
        participants = [{ instructor_staff_id: row.instructor_staff_id }];
    }
    if (participants.length === 0) {
        const { data: profile, error: profileError } = await lms
            .from('class_profiles')
            .select('default_instructor_staff_id')
            .eq('academy_id', academyId)
            .eq('class_id', row.class_id)
            .maybeSingle();
        ensureNoError(profileError, 'Failed to load fallback class instructor');
        if ((profile as Row | null)?.default_instructor_staff_id) {
            participants = [{ instructor_staff_id: (profile as Row).default_instructor_staff_id }];
        }
    }
    if (participants.length === 0) return;
    const { error: insertError } = await lms.from('lesson_occurrence_instructors').insert(
        participants.map((participant) => ({
            occurrence_id: occurrenceId,
            academy_id: academyId,
            class_id: row.class_id,
            instructor_staff_id: participant.instructor_staff_id,
            participation_kind: row.status === 'makeup' ? 'makeup' : 'regular',
            payable_minutes: duration,
        })),
    );
    ensureNoError(insertError, 'Failed to materialize lesson participants');
}

export async function updateLessonOccurrenceForAcademy(academyId: string, input: UpdateLessonOccurrenceInput) {
    if (!input.classId) throw new Error('반을 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertClassesBelongToAcademy(core, academyId, [input.classId]);
    await assertStaffMembersBelongToAcademy(core, academyId, uniqueStrings([
        ...(input.instructorIds || []),
        ...(input.participants || []).flatMap((participant) => [
            participant.instructorId,
            participant.replacesInstructorId,
        ]),
        input.instructorId,
        input.substituteInstructorId,
    ]));

    if (input.ruleId) {
        const { data: rule, error: ruleError } = await lms
            .from('class_schedule_rules')
            .select('id,class_id')
            .eq('academy_id', academyId)
            .eq('id', input.ruleId)
            .maybeSingle();
        ensureNoError(ruleError, 'Failed to verify schedule rule');
        if (!rule?.id || (rule as Row).class_id !== input.classId) {
            throw new Error('Selected schedule rule does not belong to this class.');
        }
    }

    const occurrenceId = await ensureLessonOccurrence(lms, academyId, input);
    const status = normalizeLessonOccurrenceStatus(input.status);
    if (status === 'cancelled' && !input.cancelReason?.trim()) {
        throw new Error('취소 사유를 입력하세요.');
    }
    const updates: Row = {
        status: lessonStatusRpcValue(status),
        cancel_reason: status === 'cancelled' ? input.cancelReason?.trim() : null,
    };
    if (input.notes !== undefined) updates.notes = input.notes || null;
    const { error } = await lms
        .from('lesson_occurrences')
        .update(updates)
        .eq('academy_id', academyId)
        .eq('id', occurrenceId)
        .select('id')
        .single();
    ensureNoError(error, 'Failed to update lesson occurrence');
    if (input.participants?.length || input.instructorIds?.length) {
        await syncScheduleParticipants(lms, academyId, {
            kind: 'single',
            scope: 'single',
            classId: input.classId,
            occurrenceId,
            date: input.date,
            startTime: input.startTime,
            endTime: input.endTime,
            instructorId: input.instructorId,
            instructorIds: input.instructorIds,
            participants: input.participants,
            substituteInstructorId: input.substituteInstructorId,
            status,
        }, { id: occurrenceId });
    } else if (status === 'cancelled') {
        const { error: participantError } = await lms
            .from('lesson_occurrence_instructors')
            .update({ payable_minutes: 0 })
            .eq('academy_id', academyId)
            .eq('occurrence_id', occurrenceId);
        ensureNoError(participantError, 'Failed to cancel lesson participant pay');
    }
}

async function ensureOccurrenceForAttendance(
    lms: SchemaClient,
    academyId: string,
    input: RecordAttendanceInput,
): Promise<string> {
    return ensureLessonOccurrence(lms, academyId, input);
}

export async function recordAttendanceForAcademy(academyId: string, input: RecordAttendanceInput) {
    if (!input.studentId) throw new Error('학생을 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertClassesBelongToAcademy(core, academyId, [input.classId]);

    const { data: enrollment, error: enrollmentError } = await core
        .from('class_students')
        .select('student_id,status')
        .eq('class_id', input.classId)
        .eq('student_id', input.studentId)
        .eq('status', 'active')
        .maybeSingle();
    ensureNoError(enrollmentError, 'Failed to verify enrollment');
    if (!enrollment) throw new Error('학생이 해당 반에 배정되어 있지 않습니다.');

    const occurrenceId = await ensureOccurrenceForAttendance(lms, academyId, input);
    const { data: occurrence, error: occurrenceError } = await lms
        .from('lesson_occurrences')
        .select('status')
        .eq('academy_id', academyId)
        .eq('id', occurrenceId)
        .single();
    ensureNoError(occurrenceError, 'Failed to verify attendance occurrence');
    if ((occurrence as Row).status === 'cancelled') throw new Error('취소된 수업에는 출결을 기록할 수 없습니다.');
    const defaultMinutes = ['absent', 'excused'].includes(input.status)
        ? 0
        : minutesBetween(input.startTime, input.endTime);

    const { error } = await lms.from('attendance_records').upsert({
        academy_id: academyId,
        occurrence_id: occurrenceId,
        student_id: input.studentId,
        status: input.status,
        attended_minutes: input.attendedMinutes ?? defaultMinutes,
        billable_minutes: input.billableMinutes ?? defaultMinutes,
        notes: input.notes || null,
    }, { onConflict: 'occurrence_id,student_id' });
    ensureNoError(error, 'Failed to record attendance');
}

async function recomputeInvoicePaymentStatus(lms: SchemaClient, academyId: string, invoiceId: string) {
    const { data: invoice, error: invoiceError } = await lms
        .from('invoices')
        .select('id,total_amount')
        .eq('academy_id', academyId)
        .eq('id', invoiceId)
        .single();
    ensureNoError(invoiceError, 'Failed to load invoice');

    const { data: payments, error: paymentsError } = await lms
        .from('payments')
        .select('amount')
        .eq('academy_id', academyId)
        .eq('invoice_id', invoiceId)
        .eq('status', COMPLETED_PAYMENT_STATUS);
    ensureNoError(paymentsError, 'Failed to load invoice payments');

    const paidAmount = (payments || []).reduce((sum: number, row: Row) => sum + toNumber(row.amount), 0);
    const totalAmount = toNumber((invoice as Row).total_amount);
    const status = totalAmount <= 0
        ? 'draft'
        : paidAmount >= totalAmount
            ? 'paid'
            : paidAmount > 0
                ? 'partial'
                : 'issued';

    const { error: updateError } = await lms
        .from('invoices')
        .update({ paid_amount: paidAmount, status })
        .eq('academy_id', academyId)
        .eq('id', invoiceId);
    ensureNoError(updateError, 'Failed to update invoice payment status');
}

export async function recordPaymentForAcademy(academyId: string, input: RecordPaymentInput) {
    const amount = toNumber(input.amount);
    if (!input.studentId) throw new Error('학생을 선택하세요.');
    if (!input.paymentDate) throw new Error('납부일을 입력하세요.');
    if (amount <= 0) throw new Error('납부 금액은 0보다 커야 합니다.');

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const studentName = await loadStudentName(core, academyId, input.studentId);

    if (input.invoiceId) {
        const { data: invoice, error: invoiceError } = await lms
            .from('invoices')
            .select('id,student_id')
            .eq('academy_id', academyId)
            .eq('id', input.invoiceId)
            .maybeSingle();
        ensureNoError(invoiceError, 'Failed to verify invoice');
        if (!invoice?.id || (invoice as Row).student_id !== input.studentId) {
            throw new Error('Selected invoice does not match the student.');
        }
    }

    const { data: payment, error } = await lms
        .from('payments')
        .insert({
            academy_id: academyId,
            invoice_id: input.invoiceId || null,
            student_id: input.studentId,
            student_name_snapshot: studentName,
            payer_name_snapshot: input.payerName?.trim() || studentName,
            payment_date: input.paymentDate,
            amount,
            payment_method: input.paymentMethod || null,
            status: normalizePaymentStatus(input.status),
            notes: input.notes || null,
        })
        .select('id')
        .single();
    ensureNoError(error, 'Failed to record payment');

    if (input.invoiceId) {
        try {
            await recomputeInvoicePaymentStatus(lms, academyId, input.invoiceId);
        } catch (updateError) {
            await lms.from('payments').delete().eq('academy_id', academyId).eq('id', (payment as Row).id);
            throw updateError;
        }
    }
}

export async function createExpenseForAcademy(academyId: string, input: CreateExpenseInput) {
    const amount = toNumber(input.amount);
    const category = input.category.trim();
    if (!input.expenseDate) throw new Error('지출일을 입력하세요.');
    if (!category) throw new Error('지출 분류를 입력하세요.');
    if (amount <= 0) throw new Error('지출 금액은 0보다 커야 합니다.');

    const client = createAdminClient();
    const { error } = await client.schema('lms').from('expenses').insert({
        academy_id: academyId,
        expense_date: input.expenseDate,
        category,
        amount,
        payment_method: input.paymentMethod || null,
        recipient: input.recipient || null,
        description: input.description || null,
        tax_deductible: input.taxDeductible ?? true,
        has_receipt: input.hasReceipt ?? false,
        notes: input.notes || null,
    });
    ensureNoError(error, 'Failed to create expense');
}

function calculatePayrollAmounts(
    input: CreateInstructorPaymentInput,
    taxRates: { incomeTaxRate: number; localTaxRate: number } = { incomeTaxRate: 3, localTaxRate: 0.3 },
) {
    const grossAmount = Math.max(0, toNumber(input.grossAmount));
    const withholdingType = normalizeWithholdingType(input.withholdingType);
    if (withholdingType === 'none') {
        return {
            withholdingType,
            withholdingRate: 0,
            withholdingTax: 0,
            localTax: 0,
            netAmount: grossAmount,
        };
    }

    if (withholdingType === 'freelance_3.3') {
        const withholdingTax = roundCurrency(grossAmount * Math.max(0, taxRates.incomeTaxRate) / 100);
        const localTax = roundCurrency(grossAmount * Math.max(0, taxRates.localTaxRate) / 100);
        return {
            withholdingType,
            withholdingRate: Math.max(0, taxRates.incomeTaxRate) + Math.max(0, taxRates.localTaxRate),
            withholdingTax,
            localTax,
            netAmount: Math.max(0, grossAmount - withholdingTax - localTax),
        };
    }

    const withholdingRate = Math.max(0, toNumber(input.withholdingRate));
    const withholdingTax = input.withholdingTax === undefined
        ? roundCurrency(grossAmount * withholdingRate / 100)
        : Math.max(0, toNumber(input.withholdingTax));
    const localTax = Math.max(0, toNumber(input.localTax));
    const netAmount = input.netAmount === undefined
        ? Math.max(0, grossAmount - withholdingTax - localTax)
        : Math.max(0, toNumber(input.netAmount));

    return {
        withholdingType,
        withholdingRate,
        withholdingTax,
        localTax,
        netAmount,
    };
}

export async function createInstructorPaymentForAcademy(academyId: string, input: CreateInstructorPaymentInput) {
    const baseAmount = Math.max(0, toNumber(input.baseAmount ?? input.grossAmount));
    const additionalAmount = Math.max(0, toNumber(input.additionalAmount));
    const deductionAmount = Math.max(0, toNumber(input.deductionAmount));
    const grossAmount = input.baseAmount === undefined && input.additionalAmount === undefined && input.deductionAmount === undefined
        ? Math.max(0, toNumber(input.grossAmount))
        : Math.max(0, baseAmount + additionalAmount - deductionAmount);
    if (!input.serviceMonth) throw new Error('급여 월을 입력하세요.');
    if (!input.paymentDate) throw new Error('지급일을 입력하세요.');
    if (grossAmount <= 0) throw new Error('급여 금액은 0보다 커야 합니다.');
    if (!input.instructorId && !input.recipientName?.trim()) {
        throw new Error('강사 또는 수령인명을 입력하세요.');
    }

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    let recipientName = input.recipientName?.trim() || null;
    if (input.instructorId) {
        await assertStaffBelongsToAcademy(core, academyId, input.instructorId);
        if (!recipientName) {
            const { data: staff, error: staffError } = await core
                .from('staff_members')
                .select('person_id')
                .eq('academy_id', academyId)
                .eq('id', input.instructorId)
                .maybeSingle();
            ensureNoError(staffError, 'Failed to load instructor name');
            if ((staff as Row | null)?.person_id) {
                const { data: person, error: personError } = await core
                    .from('people')
                    .select('display_name,full_name')
                    .eq('id', (staff as Row).person_id)
                    .maybeSingle();
                ensureNoError(personError, 'Failed to load instructor person');
                recipientName = (person as Row | null)?.display_name || (person as Row | null)?.full_name || null;
            }
        }
    }

    const { data: settingRows, error: settingsError } = await lms
        .from('settings')
        .select('key,value')
        .eq('academy_id', academyId)
        .in('key', ['tax_payroll_income_tax_rate', 'tax_payroll_local_tax_rate']);
    ensureNoError(settingsError, 'Failed to load payroll tax settings');
    const settings = new Map(((settingRows || []) as Row[]).map((row) => [String(row.key), Number(row.value)]));
    const incomeTaxRate = settings.get('tax_payroll_income_tax_rate');
    const localTaxRate = settings.get('tax_payroll_local_tax_rate');
    const amounts = calculatePayrollAmounts({ ...input, grossAmount }, {
        incomeTaxRate: typeof incomeTaxRate === 'number' && Number.isFinite(incomeTaxRate)
            ? incomeTaxRate
            : 3,
        localTaxRate: typeof localTaxRate === 'number' && Number.isFinite(localTaxRate)
            ? localTaxRate
            : 0.3,
    });
    const { error } = await lms.from('instructor_payments').insert({
        academy_id: academyId,
        instructor_id: input.instructorId || null,
        recipient_name: recipientName,
        service_month: input.serviceMonth,
        payment_date: input.paymentDate,
        gross_amount: grossAmount,
        base_amount: baseAmount,
        additional_amount: additionalAmount,
        deduction_amount: deductionAmount,
        withholding_type: amounts.withholdingType,
        withholding_rate: amounts.withholdingRate,
        withholding_tax: amounts.withholdingTax,
        local_tax: amounts.localTax,
        net_amount: amounts.netAmount,
        hours_worked: input.hoursWorked ?? null,
        hourly_rate: input.hourlyRate ?? null,
        payment_method: input.paymentMethod || null,
        status: normalizePayrollStatus(input.status),
        notes: input.notes || null,
    });
    ensureNoError(error, 'Failed to create instructor payment');
}

type BillingDraftForAcademy = {
    student: Row & { id: string; name: string };
    draft: ReturnType<typeof calculateInvoiceDraft> | null;
};

async function buildBillingDraftsForAcademy(client: LmsAdminClient, academyId: string, serviceMonth: string): Promise<BillingDraftForAcademy[]> {
    const core = client.schema('core');
    const lms = client.schema('lms');
    const range = monthRange(serviceMonth);

    const { data: studentsData, error: studentsError } = await core
        .from('students')
        .select('id,person_id')
        .eq('academy_id', academyId)
        .eq('status', 'active');
    ensureNoError(studentsError, 'Failed to load students');

    const students = (studentsData || []) as Row[];
    const studentIds = students.map((student) => student.id);
    if (studentIds.length === 0) return [];
    const peopleNames = await fetchPeopleNames(core, students.map((student) => student.person_id));

    const [
        { data: contractsData, error: contractsError },
        { data: rulesData, error: rulesError },
        { data: occurrencesData, error: occurrencesError },
    ] = await Promise.all([
        lms
            .from('student_billing_contracts')
            .select('id,student_id,billing_mode,base_monthly_fee,hourly_rate,effective_from,effective_to')
            .eq('academy_id', academyId)
            .eq('status', 'active')
            .in('student_id', studentIds),
        lms.from('billing_class_rules').select('contract_id,class_id,rule_type,amount,effective_from,effective_to').eq('academy_id', academyId),
        lms
            .from('lesson_occurrences')
            .select('id,class_id,occurrence_date')
            .eq('academy_id', academyId)
            .gte('occurrence_date', range.start)
            .lte('occurrence_date', range.end),
    ]);
    ensureNoError(contractsError, 'Failed to load billing contracts');
    ensureNoError(rulesError, 'Failed to load billing class rules');
    ensureNoError(occurrencesError, 'Failed to load lesson occurrences');

    const contracts = ((contractsData || []) as Row[]).filter((row) => isEffective(row, range.start, range.end));
    const contractMap = new Map(contracts.map((row) => [row.student_id, row]));
    const contractIds = contracts.map((row) => row.id);
    const contractIdSet = new Set(contractIds);
    const rules = ((rulesData || []) as Row[])
        .filter((row) => contractIdSet.has(row.contract_id))
        .filter((row) => isEffective(row, range.start, range.end));
    const occurrenceRows = (occurrencesData || []) as Row[];
    const classNames = await fetchClassNames(core, [
        ...rules.map((row) => row.class_id),
        ...occurrenceRows.map((row) => row.class_id),
    ]);

    let attendanceRows: Row[] = [];
    const occurrenceIds = occurrenceRows.map((row) => row.id);
    if (occurrenceIds.length > 0) {
        const { data, error } = await lms
            .from('attendance_records')
            .select('occurrence_id,student_id,status,billable_minutes')
            .eq('academy_id', academyId)
            .in('occurrence_id', occurrenceIds)
            .in('student_id', studentIds);
        ensureNoError(error, 'Failed to load attendance records');
        attendanceRows = (data || []) as Row[];
    }

    const occurrenceMap = new Map(occurrenceRows.map((row) => [row.id, row]));
    const rulesByContract = new Map<string, Row[]>();
    for (const rule of rules) {
        rulesByContract.set(rule.contract_id, [...(rulesByContract.get(rule.contract_id) || []), rule]);
    }

    const attendanceByStudent = new Map<string, Row[]>();
    for (const attendance of attendanceRows) {
        attendanceByStudent.set(attendance.student_id, [...(attendanceByStudent.get(attendance.student_id) || []), attendance]);
    }

    return students.map((student) => {
        const studentWithName = {
            ...student,
            name: peopleNames.get(student.person_id) || 'Unknown student',
        } as Row & { id: string; name: string };
        const contract = contractMap.get(student.id);
        if (!contract) return { student: studentWithName, draft: null };

        const draft = calculateInvoiceDraft({
            contract: {
                studentId: student.id,
                billingMode: contract.billing_mode,
                baseMonthlyFee: toNumber(contract.base_monthly_fee),
                hourlyRate: contract.hourly_rate === null || contract.hourly_rate === undefined ? null : Number(contract.hourly_rate),
            },
            rules: (rulesByContract.get(contract.id) || []).map((rule) => ({
                classId: rule.class_id,
                className: classNames.get(rule.class_id) || null,
                ruleType: rule.rule_type as BillingClassRuleType,
                amount: toNumber(rule.amount),
            })),
            attendances: (attendanceByStudent.get(student.id) || []).map((attendance) => {
                const occurrence = occurrenceMap.get(attendance.occurrence_id);
                return {
                    classId: occurrence?.class_id || '',
                    className: occurrence?.class_id ? classNames.get(occurrence.class_id) || null : null,
                    occurrenceId: attendance.occurrence_id,
                    status: attendance.status,
                    billableMinutes: attendance.billable_minutes ?? null,
                };
            }),
        });

        return {
            student: studentWithName,
            draft,
        };
    });
}

async function replaceInvoiceLinesSafely(lms: SchemaClient, invoiceId: string, lines: ReturnType<typeof calculateInvoiceDraft>['lines']) {
    const { data: existingLines, error: existingError } = await lms
        .from('invoice_lines')
        .select('line_type,class_id,occurrence_id,description,quantity,unit_amount,amount,metadata')
        .eq('invoice_id', invoiceId);
    ensureNoError(existingError, 'Failed to snapshot existing invoice lines');

    const { error: deleteError } = await lms.from('invoice_lines').delete().eq('invoice_id', invoiceId);
    ensureNoError(deleteError, 'Failed to delete invoice lines');

    try {
        if (lines.length > 0) {
            const { error: insertError } = await lms.from('invoice_lines').insert(
                lines.map((line) => ({
                    invoice_id: invoiceId,
                    line_type: line.lineType,
                    class_id: line.classId,
                    occurrence_id: line.occurrenceId,
                    description: line.description,
                    quantity: line.quantity,
                    unit_amount: line.unitAmount,
                    amount: line.amount,
                })),
            );
            ensureNoError(insertError, 'Failed to insert invoice lines');
        }
    } catch (error) {
        if ((existingLines || []).length > 0) {
            await lms.from('invoice_lines').insert(
                (existingLines || []).map((line: Row) => ({
                    invoice_id: invoiceId,
                    line_type: line.line_type,
                    class_id: line.class_id,
                    occurrence_id: line.occurrence_id,
                    description: line.description,
                    quantity: line.quantity,
                    unit_amount: line.unit_amount,
                    amount: line.amount,
                    metadata: line.metadata || {},
                })),
            );
        }
        throw error;
    }
}

export async function generateMonthlyInvoicesForAcademy(academyId: string, serviceMonth: string) {
    const client = createAdminClient();
    const lms = client.schema('lms');
    const drafts = await buildBillingDraftsForAcademy(client, academyId, serviceMonth);
    const [year, month] = serviceMonth.split('-').map(Number);
    const dueDate = `${serviceMonth}-${String(Math.min(28, new Date(year, month, 0).getDate())).padStart(2, '0')}`;

    const { data: existingInvoices, error: existingError } = await lms
        .from('invoices')
        .select('id,student_id,paid_amount,student_name_snapshot')
        .eq('academy_id', academyId)
        .eq('service_month', serviceMonth);
    ensureNoError(existingError, 'Failed to load existing invoices');

    const existingMap = new Map((existingInvoices || []).map((row: Row) => [row.student_id, row]));

    for (const { student, draft } of drafts) {
        if (!draft) continue;
        const existing = existingMap.get(student.id);
        const paidAmount = toNumber(existing?.paid_amount);
        const status = draft.totalAmount <= 0
            ? 'draft'
            : paidAmount >= draft.totalAmount
                ? 'paid'
                : paidAmount > 0
                    ? 'partial'
                    : 'issued';

        const { data: invoice, error: invoiceError } = await lms
            .from('invoices')
            .upsert({
                academy_id: academyId,
                student_id: student.id,
                student_name_snapshot: existing?.student_name_snapshot || student.name || 'Unknown student',
                service_month: serviceMonth,
                due_date: dueDate,
                subtotal_amount: draft.subtotalAmount,
                discount_amount: draft.discountAmount,
                total_amount: draft.totalAmount,
                status,
            }, { onConflict: 'student_id,service_month' })
            .select('id')
            .single();
        ensureNoError(invoiceError, 'Failed to upsert invoice');

        await replaceInvoiceLinesSafely(lms, (invoice as Row).id, draft.lines);
    }
}
