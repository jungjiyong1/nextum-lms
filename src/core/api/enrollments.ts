// Enrollment APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { Enrollment, Result } from './shared/types';
import { ok, err } from './shared/result';

export async function listEnrollments(lessonId?: number): Promise<Result<Enrollment[]>> {
    let query = supabase
        .from('enrollments')
        .select('*');

    if (lessonId !== undefined) {
        query = query.eq('lesson_id', lessonId);
    }

    const { data, error } = await query.order('id');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((row) => ({
        id: Number(row.id),
        studentId: Number(row.student_id),
        lessonId: Number(row.lesson_id),
        enrolledAt: row.enrolled_at ?? undefined,
        status: row.status as Enrollment['status'],
    })));
}

export async function createEnrollment(data: { studentId: number; lessonId: number }): Promise<Result<Enrollment>> {
    const { data: created, error } = await supabase
        .from('enrollments')
        .insert({
            student_id: data.studentId,
            lesson_id: data.lessonId,
            status: 'enrolled',
        })
        .select()
        .single();

    if (error) return err(new Error(error.message));

    return ok({
        id: Number(created.id),
        studentId: Number(created.student_id),
        lessonId: Number(created.lesson_id),
        enrolledAt: created.enrolled_at ?? undefined,
        status: created.status as Enrollment['status'],
    });
}

export async function deleteEnrollment(id: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('enrollments')
        .delete()
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function resetEnrollments(): Promise<Result<void>> {
    const { error } = await supabase
        .from('enrollments')
        .delete()
        .neq('id', 0);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Get all enrollments for a specific student
export async function listEnrollmentsByStudent(studentId: number): Promise<Result<Array<{ id: number; lesson_id: number; status: string }>>> {
    const { data, error } = await supabase
        .from('enrollments')
        .select('id, lesson_id, status')
        .eq('student_id', studentId)
        .eq('status', 'enrolled');

    if (error) return err(new Error(error.message));
    return ok(data || []);
}

interface EnrollmentWithStudent {
    id: number;
    student_id: number;
    student_name: string;
    email: string | null;
    phone: string | null;
    parent_phone: string | null;
    school_type: string | null;
    grade: string | null;
}

interface EnrollmentWithStudentAndLesson extends EnrollmentWithStudent {
    lesson_id: number;
}

// Batch API: 여러 수업의 등록 정보를 한 번에 조회 (N+1 문제 해결)
export async function listEnrollmentsByLessonIds(
    lessonIds: number[]
): Promise<Result<Record<number, EnrollmentWithStudent[]>>> {
    if (lessonIds.length === 0) {
        return ok({});
    }

    const { data, error } = await supabase
        .from('enrollments')
        .select(`
            id,
            lesson_id,
            student_id,
            students (
                id,
                name,
                email,
                phone,
                parent_phone,
                school_type,
                grade,
                status
            )
        `)
        .in('lesson_id', lessonIds)
        .eq('status', 'enrolled');

    if (error) return err(new Error(error.message));

    // lesson_id 기준으로 그룹화
    const result: Record<number, EnrollmentWithStudent[]> = {};

    // 모든 lessonId에 대해 빈 배열로 초기화
    for (const lessonId of lessonIds) {
        result[lessonId] = [];
    }

    for (const row of data || []) {
        const student = Array.isArray(row.students) ? row.students[0] : row.students;
        const enrollment: EnrollmentWithStudent = {
            id: row.id,
            student_id: row.student_id,
            student_name: student?.name ?? '',
            email: student?.email ?? null,
            phone: student?.phone ?? null,
            parent_phone: student?.parent_phone ?? null,
            school_type: student?.school_type ?? null,
            grade: student?.grade ?? null,
        };

        if (result[row.lesson_id]) {
            result[row.lesson_id].push(enrollment);
        }
    }

    return ok(result);
}

// Enrollments API object for shim compatibility
export const enrollmentsApi = {
    list: listEnrollments,
    assign: async (studentId: number, lessonId: number): Promise<Result<void>> => {
        const result = await createEnrollment({ studentId, lessonId });
        if (!result.success) return result;
        return ok(undefined);
    },
    unassign: async (enrollmentId: number): Promise<Result<void>> => {
        return deleteEnrollment(enrollmentId);
    },
    // Fetch enrollments with student info for a specific lesson
    byLesson: async (lessonId: number): Promise<Result<EnrollmentWithStudent[]>> => {
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
        id,
        student_id,
        students (
          id,
          name,
          email,
          phone,
          parent_phone,
          school_type,
          grade,
          status
        )
      `)
            .eq('lesson_id', lessonId)
            .eq('status', 'enrolled');

        if (error) return err(new Error(error.message));

        return ok((data || []).map((row) => {
            const student = Array.isArray(row.students) ? row.students[0] : row.students;
            return {
                id: row.id,
                student_id: row.student_id,
                student_name: student?.name ?? '',
                email: student?.email ?? null,
                phone: student?.phone ?? null,
                parent_phone: student?.parent_phone ?? null,
                school_type: student?.school_type ?? null,
                grade: student?.grade ?? null,
            };
        }));
    },
};
