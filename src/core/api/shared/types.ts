// Shared types for API modules
export { type Classroom, type Lesson, type ScheduleLesson, type LessonRow, type ScheduleRow, type Student, type Instructor } from '../../types';

// ==============================
// Result Pattern Types
// ==============================

/**
 * Result type for API operations.
 * Forces callers to handle both success and error cases.
 */
export type Result<T, E = Error> =
    | { success: true; data: T }
    | { success: false; error: E };

/**
 * Structured API error with code and details.
 */
export interface ApiError {
    code: string;
    message: string;
    details?: unknown;
}

// ==============================
// Payload Types
// ==============================


// Lesson payload interface
export interface LessonPayload {
    id?: number;
    classroomId: number;
    title: string;
    instructor: string;
    instructorId?: number | null;
    courseId?: number | null;
    note: string;
    isRegular?: boolean;
    day?: number;
    startSlot?: number;
    endSlot?: number;
    startDate?: string;
    endDate?: string | null;
    scheduleDate?: string;
}

// Enrollment interface
export interface Enrollment {
    id: number;
    studentId: number;
    lessonId: number;
    enrolledAt?: string;
    status: 'enrolled' | 'completed' | 'dropped';
}

// Accounting interfaces
export interface ExpenseData {
    id?: number;
    expense_date: string;
    category: string;
    amount: number;
    payment_method?: string;
    recipient?: string;
    description?: string;
    notes?: string;
}

export interface StudentPaymentData {
    student_id: number;
    payment_date: string;
    amount: number;
    payment_method?: string;
    expected_date?: string;
    status?: string;
    notes?: string;
}

export interface InstructorPaymentData {
    instructor_id: number;
    payment_date: string;
    amount: number;
    work_hours?: number;
    period_start?: string;
    period_end?: string;
    status?: string;
    notes?: string;
}

// ==============================
// DB Response Types (Supabase)
// ==============================

/** Lesson with joined lesson_rules from Supabase */
export interface LessonWithRulesRow {
    id: number;
    classroom_id: number;
    title: string;
    instructor: string;
    instructor_id: number | null;
    note: string | null;
    lesson_rules: Array<{
        day: number;
        start_slot: number;
        end_slot: number;
    }> | null;
}

/** Schedule with joined lessons from Supabase */
export interface ScheduleWithLessonRow {
    id: number;
    lesson_id: number;
    rule_id: number | null;
    date: string;
    start_time: string;
    end_time: string;
    status: string;
    notes: string | null;
    substitute_instructor_id: number | null;
    substitute_instructor_name: string | null;
    cancel_reason: string | null;
    lessons?: {
        id?: number;
        title?: string;
        instructor?: string;
        instructor_id?: number | null;
        classroom_id?: number;
        note?: string | null;
    } | null;
}

/** Enrollment row from Supabase */
export interface EnrollmentRow {
    id: number;
    student_id: number;
    lesson_id: number;
    enrolled_at: string;
    status: string;
}

/** Enrollment with joined lesson data */
export interface EnrollmentWithLessonRow {
    id: number;
    lesson_id: number;
    status: string;
    lessons: {
        id: number;
        title: string;
        instructor: string;
        classroom_id: number;
        classrooms: { name: string } | null;
    } | null;
}

/** Student enrollment with lesson details */
export interface StudentEnrollmentRow {
    lesson_id: number;
    lessons: {
        id: number;
        title: string;
        instructor: string;
        classrooms: { name: string } | null;
    } | null;
}

/** Lesson rule row */
export interface LessonRuleRow {
    id: number;
    lesson_id: number;
    day: number;
    start_slot: number;
    end_slot: number;
    start_date: string | null;
    end_date: string | null;
    active: number;
    lessons: {
        id: number;
        title: string;
        instructor: string;
        instructor_id: number | null;
        classroom_id: number;
        note: string | null;
    } | null;
}

/** Schedule row for instructor queries */
export interface InstructorScheduleRow {
    id: number;
    lesson_id: number;
    rule_id: number | null;
    date: string;
    start_time: string;
    end_time: string;
    status: string;
    substitute_instructor_id: number | null;
    substitute_instructor_name: string | null;
    lessons: {
        title: string;
        instructor: string;
        instructor_id: number | null;
        classroom_id: number;
        classrooms: { name: string } | null;
    } | null;
}

/** Instructor lesson summary row */
export interface InstructorLessonRow {
    lesson_id: number;
    lessons: {
        id: number;
        title: string;
        classroom_id: number;
        classrooms: { name: string } | null;
    } | null;
}

/** Payment row */
export interface PaymentRow {
    id: number;
    student_id?: number;
    instructor_id?: number;
    payment_date: string;
    amount: number;
    payment_method: string | null;
    status: string;
    notes: string | null;
}

