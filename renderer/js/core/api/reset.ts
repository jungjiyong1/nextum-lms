// Reset functions - centralized for all domains
import { lmsDb as supabase } from '../supabaseClient';
import { resetClassrooms } from './classrooms';
import { resetLessons } from './lessons';
import { resetSchedules } from './schedules';
import { resetStudents } from './students';
import { resetInstructors } from './instructors';
import { resetEnrollments } from './enrollments';
import { resetAccounting } from './accounting';

export async function resetCourses(): Promise<void> {
    const { error } = await supabase
        .from('courses')
        .delete()
        .neq('id', 0);

    if (error) throw error;
}

export async function resetAll(): Promise<void> {
    // Delete all data in correct order to respect foreign keys
    await resetAccounting();
    await resetEnrollments();
    await resetSchedules();
    await supabase.from('lesson_rules').delete().neq('id', 0);
    await resetLessons();
    await resetClassrooms();
    await resetStudents();
    await resetInstructors();
    await resetCourses();
}

// Re-export individual reset functions
export { resetClassrooms } from './classrooms';
export { resetLessons } from './lessons';
export { resetSchedules } from './schedules';
export { resetStudents } from './students';
export { resetInstructors } from './instructors';
export { resetEnrollments } from './enrollments';
export { resetAccounting } from './accounting';
