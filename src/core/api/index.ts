// API Module Index - Re-exports all API functions for backward compatibility
// This file maintains the same export surface as the original api.ts

// Re-export from shared
export { normalizeLesson, normalizeSchedule, slotToTime } from './shared/normalizers';
export type { LessonPayload, Enrollment, ExpenseData, StudentPaymentData, InstructorPaymentData } from './shared/types';

// Re-export from classrooms
export {
    listClassrooms,
    createClassroom,
    updateClassroomPosition,
    updateClassroomRect,
    renameClassroom,
    deleteClassroom,
} from './classrooms';

// Re-export from lessons
export {
    listLessons,
    listScheduleLessons,
    listScheduleLessonsByRange,
    createLesson,
    updateLesson,
    updateLessonRule,
    deleteLesson,
} from './lessons';

// Re-export from schedules
export {
    createSchedule,
    updateSchedule,
    deleteSchedule,
    cancelSchedule,
    setSubstituteInstructor,
    cancelSchedulesByDateRange,
    restoreSchedule,
    clearSubstituteInstructor,
    schedulesApi,
} from './schedules';

// Re-export from students
export {
    listStudents,
    createStudent,
    updateStudent,
    deleteStudent,
    listIrregularLessonsByStudent,
    studentsApi,
} from './students';

// Re-export from instructors
export {
    listInstructors,
    searchInstructors,
    createInstructor,
    updateInstructor,
    deleteInstructor,
    listLessonsByInstructor,
    getInstructorMonthlySchedule,
    listIrregularLessonsByInstructor,
    calculateInstructorMonthlySalary,
    instructorsApi,
} from './instructors';

// Re-export from enrollments
export {
    listEnrollments,
    listEnrollmentsByLessonIds,
    listEnrollmentsByStudent,
    createEnrollment,
    deleteEnrollment,
    enrollmentsApi,
} from './enrollments';

// Re-export from accounting
export {
    accountingApi,
} from './accounting';

// Re-export from pin
export { pinApi } from './pin';

// Identity/profile compatibility helpers
export { loadAuthProfile, loadSecuritySettings, updateSecuritySettings } from './identity';
export type { AcademyId, AppRole, AuthProfile, SecuritySettings } from './identity';

// Academy API
export { getAcademyName } from './academy';

// Re-export destructive reset operations through server-backed handlers.
export {
    resetClassrooms,
    resetLessons,
    resetSchedules,
    resetStudents,
    resetInstructors,
    resetCourses,
    resetEnrollments,
    resetAccounting,
    resetAll,
} from './reset';

// Import for supabaseApi object
import { lmsDb as supabase } from '../supabaseClient';
import * as classroomsModule from './classrooms';
import * as lessonsModule from './lessons';
import { schedulesApi } from './schedules';
import { studentsApi } from './students';
import { instructorsApi } from './instructors';
import { enrollmentsApi } from './enrollments';
import { accountingApi } from './accounting';
import { resetClassrooms } from './reset';
import type { LessonPayload } from './shared/types';

// Export Supabase API for direct import (backward compatible object)
export const supabaseApi = {
    // Classroom APIs
    listClassrooms: classroomsModule.listClassrooms,
    createClassroom: classroomsModule.createClassroom,
    updateClassroomPosition: async (id: number, x: number, y: number) => {
        const { error } = await supabase.from('classrooms').update({ x, y }).eq('id', id);
        if (error) throw error;
    },
    updateClassroomRect: async (id: number, x: number, y: number, width: number, height: number) => {
        const { error } = await supabase.from('classrooms').update({ x, y, width, height }).eq('id', id);
        if (error) throw error;
    },
    renameClassroom: async (id: number, name: string) => {
        const { error } = await supabase.from('classrooms').update({ name }).eq('id', id);
        if (error) throw error;
    },
    deleteClassroom: classroomsModule.deleteClassroom,
    resetClassrooms,

    // Lesson APIs
    listLessons: lessonsModule.listLessons,
    createLesson: lessonsModule.createLesson,
    updateLesson: async (data: LessonPayload) => {
        if (data.id) {
            const { error } = await supabase
                .from('lessons')
                .update({
                    classroom_id: data.classroomId,
                    title: data.title,
                    instructor: data.instructor,
                    instructor_id: data.instructorId,
                    note: data.note,
                })
                .eq('id', data.id);
            if (error) throw error;
        }
    },
    deleteLesson: lessonsModule.deleteLesson,

    // Schedule APIs
    schedules: schedulesApi,

    // Instructor APIs
    instructors: instructorsApi,

    // Student APIs
    students: studentsApi,

    // Enrollment APIs
    enrollments: enrollmentsApi,

    // Accounting APIs
    accounting: accountingApi,
};

