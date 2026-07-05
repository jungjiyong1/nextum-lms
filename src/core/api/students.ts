// Student APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { Student, IrregularLessonSchedule } from '../types';
import type { Result } from './shared/types';
import { ok, err } from './shared/result';
import { listStudentsFromCoreProjection, mapLegacyStudent } from './directoryAdapters';
import { resetStudents as resetStudentsViaAdmin } from './reset';

async function tryListStudentsFromCore(filter?: { status?: string; search?: string }): Promise<Student[] | null> {
    try {
        return await listStudentsFromCoreProjection(filter);
    } catch (error) {
        console.warn('[Students] Core student projection failed; falling back to lms.students:', error);
        return null;
    }
}

export async function listStudents(): Promise<Result<Student[]>> {
    const coreStudents = await tryListStudentsFromCore();
    if (coreStudents) return ok(coreStudents);

    const { data, error } = await supabase
        .from('students')
        .select('*')
        .order('name');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((row) => mapLegacyStudent(row as Record<string, unknown>)));
}

export async function createStudent(data: Partial<Student>): Promise<Result<Student>> {
    const { data: created, error } = await supabase
        .from('students')
        .insert({
            name: data.name ?? '',
            phone: data.phone ?? null,
            email: data.email ?? null,
            date_of_birth: data.date_of_birth ?? null,
            enrollment_date: data.enrollment_date ?? new Date().toISOString().split('T')[0],
            status: data.status ?? 'active',
            parent_name: data.parent_name ?? null,
            parent_phone: data.parent_phone ?? null,
            monthly_tuition: data.monthly_tuition ?? 0,
            payment_cycle_day: data.payment_cycle_day ?? 1,
            school_type: data.school_type ?? null,
            grade: data.grade ? String(data.grade) : null,
            notes: data.notes ?? null,
        })
        .select()
        .single();

    if (error) return err(new Error(error.message));

    return ok(mapLegacyStudent(created as Record<string, unknown>));
}

export async function updateStudent(id: number, data: Partial<Student>): Promise<Result<void>> {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.email !== undefined) updates.email = data.email;
    if (data.date_of_birth !== undefined) updates.date_of_birth = data.date_of_birth;
    if (data.enrollment_date !== undefined) updates.enrollment_date = data.enrollment_date;
    if (data.status !== undefined) updates.status = data.status;
    if (data.parent_name !== undefined) updates.parent_name = data.parent_name;
    if (data.parent_phone !== undefined) updates.parent_phone = data.parent_phone;
    if (data.monthly_tuition !== undefined) updates.monthly_tuition = data.monthly_tuition;
    if (data.payment_cycle_day !== undefined) updates.payment_cycle_day = data.payment_cycle_day;
    if (data.school_type !== undefined) updates.school_type = data.school_type;
    if (data.grade !== undefined) updates.grade = data.grade ? String(data.grade) : null;
    if (data.notes !== undefined) updates.notes = data.notes;

    const { error } = await supabase
        .from('students')
        .update(updates)
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function deleteStudent(id: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('students')
        .delete()
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function resetStudents(): Promise<Result<void>> {
    return resetStudentsViaAdmin();
}

// Get future irregular lessons for a specific student via enrollments
export async function listIrregularLessonsByStudent(studentId: number): Promise<Result<IrregularLessonSchedule[]>> {
    const today = new Date().toISOString().split('T')[0];

    // First, get all lesson IDs the student is enrolled in
    const { data: enrollments, error: enrollError } = await supabase
        .from('enrollments')
        .select('lesson_id')
        .eq('student_id', studentId)
        .eq('status', 'active');

    if (enrollError) return err(new Error(enrollError.message));
    if (!enrollments || enrollments.length === 0) return ok([]);

    const enrolledLessonIds = enrollments.map((e: { lesson_id: number }) => e.lesson_id);

    // Get schedules for enrolled lessons that are in the future
    const { data, error } = await supabase
        .from('lesson_schedules')
        .select(`
      id,
      date,
      start_time,
      end_time,
      lessons!inner (
        id,
        title,
        instructor_id,
        classroom_id,
        classrooms (name)
      )
    `)
        .in('lesson_id', enrolledLessonIds)
        .gte('date', today)
        .order('date');

    if (error) return err(new Error(error.message));
    if (!data || data.length === 0) return ok([]);

    // Get lessons that have rules (regular lessons)
    const lessonIds = [...new Set(data.map((row) => {
        const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
        return lesson?.id;
    }).filter(Boolean))];

    const { data: rulesData } = await supabase
        .from('lesson_rules')
        .select('lesson_id')
        .in('lesson_id', lessonIds);

    const lessonsWithRules = new Set((rulesData || []).map((r: { lesson_id: number }) => r.lesson_id));

    // Filter to only irregular lessons (no rules)
    return ok(data
        .filter((row) => {
            const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
            return lesson?.id && !lessonsWithRules.has(lesson.id);
        })
        .map((row) => {
            const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
            const classroom = Array.isArray(lesson?.classrooms) ? lesson?.classrooms[0] : lesson?.classrooms;
            return {
                schedule_id: row.id,
                lesson_id: lesson?.id ?? 0,
                date: row.date,
                start_time: row.start_time ?? '',
                end_time: row.end_time ?? '',
                lesson_title: lesson?.title ?? '',
                classroom_name: classroom?.name ?? '',
            };
        }));
}

// Students API object for shim compatibility
export const studentsApi = {
    list: async (options?: { status?: string }): Promise<Result<Student[]>> => {
        const coreStudents = await tryListStudentsFromCore({ status: options?.status });
        if (coreStudents) return ok(coreStudents);

        let query = supabase.from('students').select('*').order('name');
        if (options?.status) {
            query = query.eq('status', options.status);
        }
        const { data, error } = await query;
        if (error) return err(new Error(error.message));
        return ok((data || []).map((row: Record<string, unknown>) => mapLegacyStudent(row)));
    },
    search: async (query: string): Promise<Result<Student[]>> => {
        const coreStudents = await tryListStudentsFromCore({ search: query });
        if (coreStudents) return ok(coreStudents);

        const { data, error } = await supabase
            .from('students')
            .select('*')
            .ilike('name', `%${query}%`)
            .order('name');
        if (error) return err(new Error(error.message));
        return ok((data || []).map((row: Record<string, unknown>) => mapLegacyStudent(row)));
    },
    overdue: async (): Promise<Result<Student[]>> => {
        // 현재 월의 날짜 범위 계산
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        // 모든 활성/휴원 학생 조회 (월 수강료가 설정된 학생만)
        let students = await tryListStudentsFromCore();
        if (students) {
            students = students
                .filter((student) => ['active', 'on_leave'].includes(student.status))
                .filter((student) => (student.monthly_tuition ?? 0) > 0);
        } else {
            const { data, error: studentsError } = await supabase
                .from('students')
                .select('*')
                .in('status', ['active', 'on_leave'])
                .gt('monthly_tuition', 0)
                .order('name');

            if (studentsError) return err(new Error(studentsError.message));
            students = (data || []).map((row: Record<string, unknown>) => mapLegacyStudent(row));
        }

        if (students.length === 0) return ok([]);

        // 현재 월의 완료된 납부 기록 조회
        const { data: payments, error: paymentsError } = await supabase
            .from('student_payments')
            .select('student_id')
            .gte('payment_date', startDate)
            .lte('payment_date', endDate)
            .eq('status', 'completed');

        if (paymentsError) return err(new Error(paymentsError.message));

        // 납부 완료된 학생 ID Set
        const paidStudentIds = new Set((payments || []).map(p => p.student_id));

        // 미납 학생 필터링 (등록일이 현재 월 이전인 학생만 포함)
        const overdueStudents = students.filter(s => {
            // 이미 납부한 학생 제외
            if (paidStudentIds.has(s.id)) return false;
            // 등록일이 현재 월 이후인 학생 제외
            if (s.enrollment_date && s.enrollment_date > endDate) return false;
            return true;
        });

        return ok(overdueStudents);
    },
    create: async (data: Partial<Student>): Promise<Result<void>> => {
        const result = await createStudent(data);
        if (!result.success) return result;
        return ok(undefined);
    },
    update: async (data: Partial<Student> & { id: number }): Promise<Result<void>> => {
        return updateStudent(data.id, data);
    },
    delete: async (id: number): Promise<Result<void>> => {
        return deleteStudent(id);
    },
    enrollments: async (studentId: number): Promise<Result<unknown[]>> => {
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
                id,
                student_id,
                lesson_id,
                status,
                lessons (
                    id,
                    title,
                    instructor,
                    instructor_id,
                    lesson_rules (
                        day,
                        start_slot,
                        end_slot
                    )
                )
            `)
            .eq('student_id', studentId);
        if (error) return err(new Error(error.message));

        // Transform data to match Enrollment type expected by StudentDetailPanel
        const transformed = (data || []).map((row: any) => {
            const lesson = row.lessons;
            const rule = lesson?.lesson_rules?.[0];
            return {
                id: row.id,
                student_id: row.student_id,
                lesson_id: row.lesson_id,
                status: row.status,
                lesson_title: lesson?.title || '-',
                instructor_name: lesson?.instructor || '-',
                day: rule?.day ?? null,
                start_slot: rule?.start_slot ?? null,
                end_slot: rule?.end_slot ?? null,
            };
        });
        return ok(transformed);
    },
};
