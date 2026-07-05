import 'server-only';

import { createHash, randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateInvoiceDraft } from '@/features/lms/billing';
import type {
    BillingClassRuleType,
    BillingMode,
    CreateExpenseInput,
    CreateInstructorPaymentInput,
    CreateBookInput,
    CreateClassInput,
    CreateClassroomInput,
    CreateScheduleRuleInput,
    CreateStaffInput,
    CreateStudentInput,
    PaymentStatus,
    PayrollStatus,
    RecordAttendanceInput,
    RecordPaymentInput,
    StudentStatus,
    StudentClassBillingInput,
    StudentInvitationResult,
    StaffRole,
    StaffStatus,
    ClassStatus,
    UpdateBookInput,
    UpdateClassroomInput,
    UpdateStaffInput,
    UpdateClassInput,
    UpdateLessonOccurrenceInput,
    UpdateScheduleRuleInput,
    UpdateStudentInput,
    WithholdingType,
    LessonOccurrenceStatus,
} from '@/features/lms/types';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;
type SchemaClient = ReturnType<LmsAdminClient['schema']>;

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

function randomInviteCode(): string {
    const token = randomBytes(9).toString('base64url').replace(/[^A-Z0-9]/gi, '').slice(0, 12).toUpperCase();
    return `NX-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

function hashInviteCode(code: string): string {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
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

async function assertBookAssignableToAcademy(content: SchemaClient, academyId: string, bookId: string) {
    const { data, error } = await content
        .from('books')
        .select('id,academy_id')
        .eq('id', bookId)
        .maybeSingle();
    ensureNoError(error, 'Failed to verify book');

    const book = data as Row | null;
    if (!book || (book.academy_id && book.academy_id !== academyId)) {
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

function normalizeLessonOccurrenceStatus(value: LessonOccurrenceStatus): LessonOccurrenceStatus {
    if (value === 'scheduled' || value === 'completed' || value === 'cancelled' || value === 'makeup' || value === 'substitute') {
        return value;
    }
    return 'scheduled';
}

function isBillableStudentStatus(status: StudentStatus) {
    return status === 'active';
}

function normalizePaymentStatus(value: PaymentStatus | undefined): PaymentStatus {
    if (value === 'pending' || value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'refunded') {
        return value;
    }
    return 'completed';
}

function normalizePayrollStatus(value: PayrollStatus | undefined): PayrollStatus {
    if (value === 'pending' || value === 'paid' || value === 'cancelled') return value;
    return 'paid';
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
    if (!name) throw new Error('반 이름을 입력하세요.');
    if (input.defaultInstructorId) {
        await assertStaffBelongsToAcademy(core, academyId, input.defaultInstructorId);
    }
    await assertClassroomBelongsToAcademy(lms, academyId, input.defaultClassroomId);

    const { data: createdClass, error: classError } = await core
        .from('classes')
        .insert({
            academy_id: academyId,
            name,
            grade: input.grade || null,
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
            capacity: input.capacity ?? null,
            color: input.color || null,
            default_instructor_staff_id: input.defaultInstructorId || null,
            default_classroom_id: input.defaultClassroomId || null,
            status: 'active',
        });
        ensureNoError(profileError, 'Failed to create class profile');
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
                enrollment_date: dateString(new Date()),
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
    } catch (error) {
        await core.from('people').delete().eq('id', personRow.id).eq('primary_academy_id', academyId);
        throw error;
    }
}

export async function updateClassForAcademy(academyId: string, classId: string, input: UpdateClassInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    const name = input.name.trim();
    if (!classId) throw new Error('반을 선택하세요.');
    if (!name) throw new Error('반 이름을 입력하세요.');

    await assertClassesBelongToAcademy(core, academyId, [classId]);
    if (input.defaultInstructorId) {
        await assertStaffBelongsToAcademy(core, academyId, input.defaultInstructorId);
    }
    await assertClassroomBelongsToAcademy(lms, academyId, input.defaultClassroomId);

    const status = normalizeClassStatus(input.status);
    const active = input.active && status === 'active';

    const { error: classError } = await core
        .from('classes')
        .update({
            name,
            grade: input.grade || null,
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
            capacity: input.capacity ?? null,
            color: input.color || null,
            default_instructor_staff_id: input.defaultInstructorId || null,
            default_classroom_id: input.defaultClassroomId || null,
            status,
        }, { onConflict: 'class_id' })
        .select('class_id')
        .single();
    ensureNoError(profileError, 'Failed to update class profile');

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
                .update({ status: 'inactive', effective_to: dateString(new Date()) })
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

export async function createStaffForAcademy(academyId: string, input: CreateStaffInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const name = input.name.trim();
    if (!name) throw new Error('이름을 입력하세요.');

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
        const { error: staffError } = await core.from('staff_members').insert({
            academy_id: academyId,
            person_id: personRow.id,
            role: input.role,
            status: 'active',
            hourly_rate: input.hourlyRate ?? null,
        });
        ensureNoError(staffError, 'Failed to create staff member');
    } catch (error) {
        await core.from('people').delete().eq('id', personRow.id).eq('primary_academy_id', academyId);
        throw error;
    }
}

export async function updateStaffForAcademy(academyId: string, staffId: string, input: UpdateStaffInput) {
    const client = createAdminClient();
    const core = client.schema('core');
    const name = input.name.trim();
    if (!staffId) throw new Error('강사/직원을 선택하세요.');
    if (!name) throw new Error('이름을 입력하세요.');

    const { data: staff, error: staffError } = await core
        .from('staff_members')
        .select('id,person_id,role')
        .eq('academy_id', academyId)
        .eq('id', staffId)
        .maybeSingle();
    ensureNoError(staffError, 'Failed to load staff member');
    if (!staff?.id) throw new Error('Selected staff member does not belong to this academy.');
    if ((staff as Row).role === 'owner') throw new Error('Owner role cannot be edited here.');

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
            hourly_rate: input.hourlyRate ?? null,
        })
        .eq('academy_id', academyId)
        .eq('id', staffId)
        .select('id')
        .single();
    ensureNoError(updateError, 'Failed to update staff member');
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

export async function setClassBookForAcademy(academyId: string, classId: string, bookId: string, active: boolean) {
    if (!classId || !bookId) throw new Error('반과 교재를 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const content = client.schema('content');
    await assertClassesBelongToAcademy(core, academyId, [classId]);
    await assertBookAssignableToAcademy(content, academyId, bookId);

    const { error } = await core
        .from('class_books')
        .upsert({ class_id: classId, book_id: bookId, active }, { onConflict: 'class_id,book_id' });
    ensureNoError(error, 'Failed to assign class book');
}

export async function createStudentInvitationForAcademy(
    academyId: string,
    studentId: string,
): Promise<StudentInvitationResult> {
    if (!studentId) throw new Error('학생을 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const { data: student, error: studentError } = await core
        .from('students')
        .select('id,person_id,status')
        .eq('academy_id', academyId)
        .eq('id', studentId)
        .eq('status', 'active')
        .single();
    ensureNoError(studentError, 'Failed to load student');

    const studentRow = student as Row;
    const { data: person, error: personError } = await core
        .from('people')
        .select('id,full_name,display_name')
        .eq('id', studentRow.person_id)
        .single();
    ensureNoError(personError, 'Failed to load person');

    const personRow = person as Row;
    const code = randomInviteCode();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await core.from('account_invitations').insert({
        academy_id: academyId,
        person_id: studentRow.person_id,
        student_id: studentRow.id,
        role: 'student',
        invite_code_hash: hashInviteCode(code),
        login_hint: personRow.display_name || personRow.full_name || null,
        expires_at: expiresAt,
    });
    ensureNoError(error, 'Failed to create student invitation');

    return {
        code,
        expiresAt,
        loginHint: personRow.display_name || personRow.full_name || null,
    };
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
        return input.occurrenceId;
    }

    const row = {
        academy_id: academyId,
        class_id: input.classId,
        rule_id: input.ruleId || null,
        occurrence_date: input.date,
        start_time: input.startTime,
        end_time: input.endTime,
        status: 'scheduled',
    };

    const { data, error } = await lms.from('lesson_occurrences').insert(row).select('id').single();
    if (!error) return (data as Row).id;

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
    return existing.id;
}

export async function updateLessonOccurrenceForAcademy(academyId: string, input: UpdateLessonOccurrenceInput) {
    if (!input.classId) throw new Error('반을 선택하세요.');

    const client = createAdminClient();
    const core = client.schema('core');
    const lms = client.schema('lms');
    await assertClassesBelongToAcademy(core, academyId, [input.classId]);

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
    const { error } = await lms
        .from('lesson_occurrences')
        .update({
            status,
            cancel_reason: status === 'cancelled' ? input.cancelReason || null : null,
            notes: input.notes || null,
        })
        .eq('academy_id', academyId)
        .eq('id', occurrenceId)
        .select('id')
        .single();
    ensureNoError(error, 'Failed to update lesson occurrence');
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
        .eq('status', 'completed');
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
    await assertStudentBelongsToAcademy(core, academyId, input.studentId);

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

function calculatePayrollAmounts(input: CreateInstructorPaymentInput) {
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
        const withholdingTax = roundCurrency(grossAmount * 0.03);
        const localTax = roundCurrency(withholdingTax * 0.1);
        return {
            withholdingType,
            withholdingRate: 3.3,
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
    const grossAmount = toNumber(input.grossAmount);
    if (!input.serviceMonth) throw new Error('급여 월을 입력하세요.');
    if (!input.paymentDate) throw new Error('지급일을 입력하세요.');
    if (grossAmount <= 0) throw new Error('급여 금액은 0보다 커야 합니다.');
    if (!input.instructorId && !input.recipientName?.trim()) {
        throw new Error('강사 또는 수령인명을 입력하세요.');
    }

    const client = createAdminClient();
    const core = client.schema('core');
    if (input.instructorId) {
        await assertStaffBelongsToAcademy(core, academyId, input.instructorId);
    }

    const amounts = calculatePayrollAmounts(input);
    const { error } = await client.schema('lms').from('instructor_payments').insert({
        academy_id: academyId,
        instructor_id: input.instructorId || null,
        recipient_name: input.recipientName?.trim() || null,
        service_month: input.serviceMonth,
        payment_date: input.paymentDate,
        gross_amount: grossAmount,
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

async function buildBillingDraftsForAcademy(client: LmsAdminClient, academyId: string, serviceMonth: string) {
    const core = client.schema('core');
    const lms = client.schema('lms');
    const range = monthRange(serviceMonth);

    const { data: studentsData, error: studentsError } = await core
        .from('students')
        .select('id')
        .eq('academy_id', academyId)
        .eq('status', 'active');
    ensureNoError(studentsError, 'Failed to load students');

    const students = (studentsData || []) as Row[];
    const studentIds = students.map((student) => student.id);
    if (studentIds.length === 0) return [];

    const [
        { data: contractsData, error: contractsError },
        { data: rulesData, error: rulesError },
        { data: occurrencesData, error: occurrencesError },
    ] = await Promise.all([
        lms
            .from('student_billing_contracts')
            .select('*')
            .eq('academy_id', academyId)
            .eq('status', 'active')
            .in('student_id', studentIds),
        lms.from('billing_class_rules').select('*').eq('academy_id', academyId),
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
    const rules = ((rulesData || []) as Row[])
        .filter((row) => contractIds.includes(row.contract_id))
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
        const contract = contractMap.get(student.id);
        if (!contract) return { student, draft: null };

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

        return { student, draft };
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
        .select('id,student_id,paid_amount')
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
