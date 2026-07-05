// Instructor APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { Instructor as InstructorType, InstructorLessonSummary, InstructorScheduleItem, IrregularLessonSchedule, SalaryData } from '../types';
import type { Result } from './shared/types';
import { slotToTime } from './shared/normalizers';
import { ok, err } from './shared/result';
import { logger } from '../logger';
import { listInstructorsFromCoreProjection, mapLegacyInstructor } from './directoryAdapters';

async function tryListInstructorsFromCore(filter?: { status?: string; search?: string }): Promise<InstructorType[] | null> {
    try {
        return await listInstructorsFromCoreProjection(filter);
    } catch (error) {
        console.warn('[Instructors] Core instructor projection failed; falling back to lms.instructors:', error);
        return null;
    }
}

export async function listInstructors(filter?: { status?: string }): Promise<Result<InstructorType[]>> {
    const coreInstructors = await tryListInstructorsFromCore(filter);
    if (coreInstructors) return ok(coreInstructors);

    let query = supabase.from('instructors').select('*');

    if (filter?.status) {
        query = query.eq('status', filter.status);
    }

    const { data, error } = await query.order('name');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((row) => mapLegacyInstructor(row as Record<string, unknown>)));
}

export async function searchInstructors(searchQuery: string): Promise<Result<InstructorType[]>> {
    const coreInstructors = await tryListInstructorsFromCore({ search: searchQuery });
    if (coreInstructors) return ok(coreInstructors);

    const { data, error } = await supabase
        .from('instructors')
        .select('*')
        .ilike('name', `%${searchQuery}%`)
        .order('name');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((row) => mapLegacyInstructor(row as Record<string, unknown>)));
}

export async function createInstructor(data: Partial<InstructorType>): Promise<Result<InstructorType>> {
    const { data: created, error } = await supabase
        .from('instructors')
        .insert({
            name: data.name ?? '',
            phone: data.phone ?? null,
            email: data.email ?? null,
            qualifications: data.qualifications ?? null,
            hourly_rate: data.hourly_rate ?? null,
            hire_date: data.hire_date ?? null,
            status: data.status ?? 'active',
            notes: data.notes ?? null,
        })
        .select()
        .single();

    if (error) return err(new Error(error.message));

    return ok(mapLegacyInstructor(created as Record<string, unknown>));
}

export async function updateInstructor(id: number, data: Partial<InstructorType>): Promise<Result<void>> {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.email !== undefined) updates.email = data.email;
    if (data.qualifications !== undefined) updates.qualifications = data.qualifications;
    if (data.hourly_rate !== undefined) updates.hourly_rate = data.hourly_rate;
    if (data.hire_date !== undefined) updates.hire_date = data.hire_date;
    if (data.status !== undefined) updates.status = data.status;
    if (data.notes !== undefined) updates.notes = data.notes;

    const { error } = await supabase
        .from('instructors')
        .update(updates)
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function deleteInstructor(id: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('instructors')
        .delete()
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function resetInstructors(): Promise<Result<void>> {
    const { error } = await supabase
        .from('instructors')
        .delete()
        .neq('id', 0);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Get lessons assigned to a specific instructor
export async function listLessonsByInstructor(instructorId: number): Promise<Result<InstructorLessonSummary[]>> {
    const { data, error } = await supabase
        .from('lessons')
        .select(`
      id,
      title,
      classroom_id,
      classrooms (name),
      lesson_rules (
        id,
        day,
        start_slot,
        end_slot
      )
    `)
        .eq('instructor_id', instructorId)
        .order('title');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((row) => {
        const classroom = Array.isArray(row.classrooms) ? row.classrooms[0] : row.classrooms;
        return {
            lesson_id: row.id,
            title: row.title ?? '',
            day: row.lesson_rules?.[0]?.day ?? null,
            start_slot: row.lesson_rules?.[0]?.start_slot ?? null,
            end_slot: row.lesson_rules?.[0]?.end_slot ?? null,
            classroom_name: classroom?.name ?? '',
            classroom_id: row.classroom_id ?? 0,
            rule_id: row.lesson_rules?.[0]?.id ?? null,
        };
    }));
}

// Get instructor's monthly schedule for calendar view
export async function getInstructorMonthlySchedule(
    instructorId: number,
    year: number,
    month: number
): Promise<Result<InstructorScheduleItem[]>> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    logger.debug('getInstructorMonthlySchedule', 'Query for instructor:', instructorId, 'range:', startDate, 'to', endDate);

    // Step 1: Get all lesson IDs where this instructor is the primary instructor
    const { data: lessons, error: lessonsError } = await supabase
        .from('lessons')
        .select('id')
        .eq('instructor_id', instructorId);

    if (lessonsError) return err(new Error(lessonsError.message));

    const lessonIds = (lessons || []).map(l => l.id);
    logger.debug('getInstructorMonthlySchedule', 'Found', lessonIds.length, 'lessons for instructor');

    // Step 2: Get ALL schedules for this instructor (both as primary and substitute)
    let schedulesData: any[] = [];

    if (lessonIds.length > 0) {
        const { data: ownSchedules, error: ownError } = await supabase
            .from('lesson_schedules')
            .select(`
        id,
        lesson_id,
        rule_id,
        date,
        start_time,
        end_time,
        status,
        substitute_instructor_id,
        substitute_instructor_name,
        lessons (
          id,
          title,
          instructor,
          instructor_id,
          classroom_id,
          classrooms (name)
        )
      `)
            .in('lesson_id', lessonIds)
            .gte('date', startDate)
            .lte('date', endDate);

        if (ownError) return err(new Error(ownError.message));
        schedulesData = ownSchedules || [];
    }

    // Also get schedules where this instructor is substitute
    const { data: substituteSchedules, error: subError } = await supabase
        .from('lesson_schedules')
        .select(`
      id,
      lesson_id,
      rule_id,
      date,
      start_time,
      end_time,
      status,
      substitute_instructor_id,
      substitute_instructor_name,
      lessons (
        id,
        title,
        instructor,
        instructor_id,
        classroom_id,
        classrooms (name)
      )
    `)
        .eq('substitute_instructor_id', instructorId)
        .gte('date', startDate)
        .lte('date', endDate);

    if (subError) return err(new Error(subError.message));

    // Merge and deduplicate
    const scheduleIds = new Set(schedulesData.map((s: { id: number }) => s.id));
    for (const sub of substituteSchedules || []) {
        if (!scheduleIds.has(sub.id)) {
            schedulesData.push(sub);
        }
    }

    logger.debug('getInstructorMonthlySchedule', 'Found', schedulesData.length, 'schedules from lesson_schedules');

    const scheduleResults: InstructorScheduleItem[] = schedulesData.map((row) => {
        const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
        const classroom = Array.isArray(lesson?.classrooms) ? lesson?.classrooms[0] : lesson?.classrooms;
        const startTime = row.start_time || '00:00';
        const endTime = row.end_time || '00:00';
        const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1] || '0');
        const endMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1] || '0');
        const durationMinutes = endMinutes - startMinutes;

        return {
            schedule_id: row.id,
            lesson_id: row.lesson_id,
            rule_id: row.rule_id ?? null,
            date: row.date,
            start_time: startTime,
            end_time: endTime,
            duration_minutes: durationMinutes,
            lesson_title: lesson?.title ?? '',
            classroom_name: classroom?.name ?? '',
            classroom_id: lesson?.classroom_id ?? 0,
            status: row.status ?? 'scheduled',
            instructor_name: lesson?.instructor ?? '',
            instructor_id: lesson?.instructor_id ?? 0,
            substitute_instructor_id: row.substitute_instructor_id ?? null,
            substitute_instructor_name: row.substitute_instructor_name ?? null,
        };
    });

    // Step 3: Get lesson_rules for virtual schedule generation
    if (lessonIds.length === 0) {
        logger.debug('getInstructorMonthlySchedule', 'No lesson IDs, returning schedule results only');
        return ok(scheduleResults);
    }

    const { data: rulesData, error: rulesError } = await supabase
        .from('lesson_rules')
        .select(`
      id,
      lesson_id,
      day,
      start_slot,
      end_slot,
      start_date,
      end_date,
      active,
      lessons!inner (
        id,
        title,
        instructor,
        instructor_id,
        classroom_id,
        classrooms (name)
      )
    `)
        .in('lesson_id', lessonIds)
        .eq('active', 1);

    if (rulesError) return err(new Error(rulesError.message));

    logger.debug('getInstructorMonthlySchedule', 'Found', (rulesData || []).length, 'active rules');

    // Track existing schedules to avoid duplicates
    const existingScheduleKeys = new Set(
        scheduleResults.map(s => `${s.lesson_id}-${s.date}`)
    );

    const ruleResults: InstructorScheduleItem[] = [];
    const monthStart = new Date(startDate + 'T00:00:00');
    const monthEnd = new Date(endDate + 'T00:00:00');

    for (const rule of rulesData || []) {
        const ruleStartDate = rule.start_date ? new Date(rule.start_date + 'T00:00:00') : null;
        const ruleEndDate = rule.end_date ? new Date(rule.end_date + 'T00:00:00') : null;

        logger.debug('getInstructorMonthlySchedule', `Rule ${rule.id}: day=${rule.day}, start_date=${rule.start_date}, end_date=${rule.end_date}`);

        const iterStart = ruleStartDate && ruleStartDate > monthStart ? ruleStartDate : monthStart;
        const iterEnd = ruleEndDate && ruleEndDate < monthEnd ? ruleEndDate : monthEnd;

        const current = new Date(iterStart);

        while (current <= iterEnd) {
            const dayOfWeek = (current.getDay() + 6) % 7;

            if (dayOfWeek === rule.day) {
                const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const key = `${rule.lesson_id}-${dateStr}`;

                if (!existingScheduleKeys.has(key)) {
                    const startTime = slotToTime(rule.start_slot);
                    const endTime = slotToTime(rule.end_slot);
                    const durationMinutes = (rule.end_slot - rule.start_slot) * 30;

                    ruleResults.push({
                        schedule_id: -(rule.id * 1000 + ruleResults.length),
                        lesson_id: rule.lesson_id,
                        rule_id: rule.id,
                        date: dateStr,
                        start_time: startTime,
                        end_time: endTime,
                        duration_minutes: durationMinutes,
                        lesson_title: (rule as any).lessons?.title ?? '',
                        classroom_name: (rule as any).lessons?.classrooms?.name ?? '',
                        classroom_id: (rule as any).lessons?.classroom_id ?? 0,
                        status: 'scheduled',
                        instructor_name: (rule as any).lessons?.instructor ?? '',
                        instructor_id: (rule as any).lessons?.instructor_id ?? 0,
                        substitute_instructor_id: null,
                        substitute_instructor_name: null,
                    });
                }
            }
            current.setDate(current.getDate() + 1);
        }
    }

    logger.debug('getInstructorMonthlySchedule', 'Generated', ruleResults.length, 'virtual schedules from rules');

    const allSchedules = [...scheduleResults, ...ruleResults];
    allSchedules.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.start_time.localeCompare(b.start_time);
    });

    logger.debug('getInstructorMonthlySchedule', 'Total schedules:', allSchedules.length);
    return ok(allSchedules);
}

// Get future irregular lessons assigned to a specific instructor
export async function listIrregularLessonsByInstructor(instructorId: number): Promise<Result<IrregularLessonSchedule[]>> {
    const today = new Date().toISOString().split('T')[0];

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
        .eq('lessons.instructor_id', instructorId)
        .gte('date', today)
        .order('date');

    if (error) return err(new Error(error.message));

    if (!data || data.length === 0) return ok([]);

    const lessonIds = [...new Set(data.map((row) => {
        const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
        return lesson?.id;
    }).filter(Boolean))];

    const { data: rulesData } = await supabase
        .from('lesson_rules')
        .select('lesson_id')
        .in('lesson_id', lessonIds);

    const lessonsWithRules = new Set((rulesData || []).map((r: { lesson_id: number }) => r.lesson_id));

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

// Calculate instructor's monthly salary data
export async function calculateInstructorMonthlySalary(
    instructorId: number,
    year: number,
    month: number
): Promise<Result<SalaryData | null>> {
    const { data: instructor, error: instructorError } = await supabase
        .from('instructors')
        .select('id, name, hourly_rate')
        .eq('id', instructorId)
        .single();

    if (instructorError || !instructor) {
        console.error('Failed to get instructor:', instructorError);
        return ok(null);
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data: lessons, error: lessonsError } = await supabase
        .from('lessons')
        .select('id')
        .eq('instructor_id', instructorId);

    if (lessonsError) {
        console.error('Failed to get lessons:', lessonsError);
        return ok(null);
    }

    const lessonIds = (lessons || []).map(l => l.id);
    if (lessonIds.length === 0) {
        return ok({
            instructor: { id: instructor.id, name: instructor.name, hourly_rate: instructor.hourly_rate },
            totalMinutes: 0,
            totalHours: 0,
            estimatedSalary: 0
        });
    }

    logger.debug('calculateInstructorMonthlySalary', 'Query for instructor:', instructorId, 'range:', startDate, 'to', endDate);

    let schedulesData: any[] = [];

    if (lessonIds.length > 0) {
        const { data: ownSchedules, error: ownError } = await supabase
            .from('lesson_schedules')
            .select(`
        lesson_id,
        date,
        start_time,
        end_time,
        status,
        substitute_instructor_id,
        lessons!inner(instructor_id)
      `)
            .in('lesson_id', lessonIds)
            .gte('date', startDate)
            .lte('date', endDate)
            .neq('status', 'cancelled');

        if (ownError) {
            console.error('Failed to get own schedules:', ownError);
            return ok(null);
        }
        schedulesData = ownSchedules || [];
    }

    const { data: substituteSchedules, error: subError } = await supabase
        .from('lesson_schedules')
        .select(`
      lesson_id,
      date,
      start_time,
      end_time,
      status,
      substitute_instructor_id,
      lessons!inner(instructor_id)
    `)
        .eq('substitute_instructor_id', instructorId)
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('status', 'cancelled');

    if (subError) {
        console.error('Failed to get substitute schedules:', subError);
        return ok(null);
    }

    for (const sub of substituteSchedules || []) {
        const key = `${sub.lesson_id}-${sub.date}`;
        const existsInOwn = schedulesData.some((s: { lesson_id: number; date: string }) => `${s.lesson_id}-${s.date}` === key);
        if (!existsInOwn) {
            schedulesData.push(sub);
        }
    }

    logger.debug('calculateInstructorMonthlySalary', 'Found', schedulesData.length, 'schedules from lesson_schedules');

    const existingScheduleKeys = new Set(
        schedulesData.map((s: { lesson_id: number; date: string }) => `${s.lesson_id}-${s.date}`)
    );

    let totalMinutes = 0;

    schedulesData.forEach((s) => {
        const lesson = Array.isArray(s.lessons) ? s.lessons[0] : s.lessons;
        const isSubstitute = s.substitute_instructor_id === instructorId;
        const isOriginal = lesson?.instructor_id === instructorId && !s.substitute_instructor_id;

        if (isSubstitute || isOriginal) {
            const start = s.start_time?.split(':').map(Number) || [0, 0];
            const end = s.end_time?.split(':').map(Number) || [0, 0];
            totalMinutes += (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
        }
    });

    logger.debug('calculateInstructorMonthlySalary', 'Minutes from actual schedules:', totalMinutes);

    if (lessonIds.length === 0) {
        const totalHours = totalMinutes / 60;
        const hourlyRate = instructor.hourly_rate || 0;
        const estimatedSalary = totalHours * hourlyRate;
        return ok({
            instructor: { id: instructor.id, name: instructor.name, hourly_rate: instructor.hourly_rate },
            totalMinutes,
            totalHours,
            estimatedSalary
        });
    }

    const { data: rulesData, error: rulesError } = await supabase
        .from('lesson_rules')
        .select(`
      id,
      lesson_id,
      day,
      start_slot,
      end_slot,
      start_date,
      end_date,
      active
    `)
        .in('lesson_id', lessonIds)
        .eq('active', 1);

    if (rulesError) {
        console.error('Failed to get rules:', rulesError);
        return ok(null);
    }

    logger.debug('calculateInstructorMonthlySalary', 'Found', (rulesData || []).length, 'active rules');

    const monthStart = new Date(startDate + 'T00:00:00');
    const monthEnd = new Date(endDate + 'T00:00:00');

    for (const rule of rulesData || []) {
        const ruleStartDate = rule.start_date ? new Date(rule.start_date + 'T00:00:00') : null;
        const ruleEndDate = rule.end_date ? new Date(rule.end_date + 'T00:00:00') : null;

        const iterStart = ruleStartDate && ruleStartDate > monthStart ? ruleStartDate : monthStart;
        const iterEnd = ruleEndDate && ruleEndDate < monthEnd ? ruleEndDate : monthEnd;

        const current = new Date(iterStart);

        while (current <= iterEnd) {
            const dayOfWeek = (current.getDay() + 6) % 7;

            if (dayOfWeek === rule.day) {
                const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
                const key = `${rule.lesson_id}-${dateStr}`;

                if (!existingScheduleKeys.has(key)) {
                    const durationMinutes = (rule.end_slot - rule.start_slot) * 30;
                    totalMinutes += durationMinutes;
                }
            }
            current.setDate(current.getDate() + 1);
        }
    }

    logger.debug('calculateInstructorMonthlySalary', 'Total minutes after rules:', totalMinutes);

    const totalHours = totalMinutes / 60;
    const hourlyRate = instructor.hourly_rate || 0;
    const estimatedSalary = totalHours * hourlyRate;

    return ok({
        instructor: {
            id: instructor.id,
            name: instructor.name,
            hourly_rate: instructor.hourly_rate
        },
        totalMinutes,
        totalHours,
        estimatedSalary
    });
}

// Instructors API object for shim compatibility
export const instructorsApi = {
    list: async (options?: { status?: string }): Promise<Result<InstructorType[]>> => {
        const coreInstructors = await tryListInstructorsFromCore({ status: options?.status });
        if (coreInstructors) return ok(coreInstructors);

        let query = supabase.from('instructors').select('*').order('name');
        if (options?.status) {
            query = query.eq('status', options.status);
        }
        const { data, error } = await query;
        if (error) return err(new Error(error.message));
        return ok((data || []).map((row: Record<string, unknown>) => mapLegacyInstructor(row)));
    },
    search: async (query: string): Promise<Result<InstructorType[]>> => {
        const coreInstructors = await tryListInstructorsFromCore({ search: query });
        if (coreInstructors) return ok(coreInstructors);

        const { data, error } = await supabase
            .from('instructors')
            .select('*')
            .ilike('name', `%${query}%`)
            .order('name');
        if (error) return err(new Error(error.message));
        return ok((data || []).map((row: Record<string, unknown>) => mapLegacyInstructor(row)));
    },
    create: async (data: Partial<InstructorType>): Promise<Result<void>> => {
        const result = await createInstructor(data);
        if (!result.success) return result;
        return ok(undefined);
    },
    update: async (data: Partial<InstructorType> & { id: number }): Promise<Result<void>> => {
        return updateInstructor(data.id, data);
    },
    delete: async (id: number): Promise<Result<void>> => {
        return deleteInstructor(id);
    },
    lessons: async (instructorId: number): Promise<Result<unknown[]>> => {
        const { data, error } = await supabase
            .from('lessons')
            .select('id, title, classroom_id')
            .eq('instructor_id', instructorId);
        if (error) return err(new Error(error.message));
        return ok(data || []);
    },
};
