// Schedule APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import { timeToSlot } from '../utils/time';
import type { Result } from './shared/types';
import { ok, err } from './shared/result';

interface ScheduleData {
    id: number;
    lesson_id: number;
    date: string;
    start_time: string;
    end_time: string;
    status: string;
    notes?: string | null;
}

export async function createSchedule(data: {
    lesson_id: number;
    date: string;
    start_time: string;
    end_time: string;
    notes?: string;
}): Promise<Result<ScheduleData>> {
    // Calculate duration in minutes from time strings
    const startSlot = timeToSlot(data.start_time);
    const endSlot = timeToSlot(data.end_time);
    const durationMinutes = (endSlot - startSlot) * 30;

    const { data: created, error } = await supabase
        .from('lesson_schedules')
        .insert({
            lesson_id: data.lesson_id,
            date: data.date,
            start_time: data.start_time,
            end_time: data.end_time,
            duration_minutes: durationMinutes,
            notes: data.notes ?? null,
            status: 'scheduled',
        })
        .select()
        .single();

    if (error) return err(new Error(error.message));
    return ok(created as ScheduleData);
}

export async function updateSchedule(data: {
    id: number;
    date?: string;
    start_time?: string;
    end_time?: string;
    notes?: string;
}): Promise<Result<ScheduleData>> {
    const updates: Record<string, unknown> = {};
    if (data.date) updates.date = data.date;
    if (data.start_time) updates.start_time = data.start_time;
    if (data.end_time) updates.end_time = data.end_time;
    if (data.notes !== undefined) updates.notes = data.notes;

    const { data: updated, error } = await supabase
        .from('lesson_schedules')
        .update(updates)
        .eq('id', data.id)
        .select()
        .single();

    if (error) return err(new Error(error.message));
    return ok(updated as ScheduleData);
}

export async function deleteSchedule(id: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('lesson_schedules')
        .delete()
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function resetSchedules(): Promise<Result<void>> {
    const { error } = await supabase
        .from('lesson_schedules')
        .delete()
        .neq('id', 0);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Cancel a scheduled lesson
export async function cancelSchedule(scheduleId: number, reason?: string): Promise<Result<void>> {
    const { error } = await supabase
        .from('lesson_schedules')
        .update({
            status: 'cancelled',
            cancel_reason: reason ?? null
        })
        .eq('id', scheduleId);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Set substitute instructor for a scheduled lesson
export async function setSubstituteInstructor(
    scheduleId: number,
    substituteInstructorId: number,
    substituteInstructorName: string
): Promise<Result<void>> {
    const { error } = await supabase
        .from('lesson_schedules')
        .update({
            substitute_instructor_id: substituteInstructorId,
            substitute_instructor_name: substituteInstructorName,
            status: 'substituted'
        })
        .eq('id', scheduleId);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Cancel multiple lesson schedules for a date range (period cancel)
export async function cancelSchedulesByDateRange(
    lessonId: number,
    startDate: string,
    endDate: string,
    reason?: string
): Promise<Result<{ count: number }>> {
    const { data, error } = await supabase
        .from('lesson_schedules')
        .update({
            status: 'cancelled',
            cancel_reason: reason ?? null
        })
        .eq('lesson_id', lessonId)
        .gte('date', startDate)
        .lte('date', endDate)
        .select();

    if (error) return err(new Error(error.message));
    return ok({ count: data?.length ?? 0 });
}

// Restore a cancelled schedule
export async function restoreSchedule(scheduleId: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('lesson_schedules')
        .update({
            status: 'scheduled',
            cancel_reason: null
        })
        .eq('id', scheduleId);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Clear substitute instructor from a schedule
export async function clearSubstituteInstructor(scheduleId: number): Promise<Result<void>> {
    const { error } = await supabase
        .from('lesson_schedules')
        .update({
            substitute_instructor_id: null,
            substitute_instructor_name: null,
            status: 'scheduled'
        })
        .eq('id', scheduleId);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

// Schedules API object for shim compatibility
export const schedulesApi = {
    create: createSchedule,
    update: updateSchedule,
    delete: deleteSchedule,
    cancel: async (scheduleId: number, reason?: string): Promise<Result<void>> => {
        const { error } = await supabase
            .from('lesson_schedules')
            .update({ status: 'cancelled', cancel_reason: reason })
            .eq('id', scheduleId);
        if (error) return err(new Error(error.message));
        return ok(undefined);
    },
    restore: async (scheduleId: number): Promise<Result<void>> => {
        const { error } = await supabase
            .from('lesson_schedules')
            .update({ status: 'scheduled', cancel_reason: null })
            .eq('id', scheduleId);
        if (error) return err(new Error(error.message));
        return ok(undefined);
    },
    setSubstitute: async (scheduleId: number, instructorId: number, instructorName: string): Promise<Result<void>> => {
        const { error } = await supabase
            .from('lesson_schedules')
            .update({
                substitute_instructor_id: instructorId,
                substitute_instructor_name: instructorName,
                status: 'substitute'
            })
            .eq('id', scheduleId);
        if (error) return err(new Error(error.message));
        return ok(undefined);
    },
    clearSubstitute: async (scheduleId: number): Promise<Result<void>> => {
        const { error } = await supabase
            .from('lesson_schedules')
            .update({
                substitute_instructor_id: null,
                substitute_instructor_name: null,
                status: 'scheduled'
            })
            .eq('id', scheduleId);
        if (error) return err(new Error(error.message));
        return ok(undefined);
    },
    cancelPeriod: async (lessonId: number, startDate: string, endDate: string, reason?: string): Promise<Result<{ count: number }>> => {
        const { data, error } = await supabase
            .from('lesson_schedules')
            .update({ status: 'cancelled', cancel_reason: reason })
            .eq('lesson_id', lessonId)
            .gte('date', startDate)
            .lte('date', endDate)
            .select();
        if (error) return err(new Error(error.message));
        return ok({ count: data?.length ?? 0 });
    },
    createMakeup: async (originalScheduleId: number, newDate: string, startTime: string, endTime: string, _classroomId: number, instructorId?: number, instructorName?: string): Promise<Result<{ schedule: ScheduleData }>> => {
        // 원래 스케줄 정보 가져오기
        const { data: orig, error: origError } = await supabase
            .from('lesson_schedules')
            .select('lesson_id')
            .eq('id', originalScheduleId)
            .single();

        if (origError || !orig) return err(new Error('Original schedule not found'));

        const { data: created, error } = await supabase
            .from('lesson_schedules')
            .insert({
                lesson_id: orig.lesson_id,
                date: newDate,
                start_time: startTime,
                end_time: endTime,
                status: 'makeup',
                substitute_instructor_id: instructorId,
                substitute_instructor_name: instructorName,
            })
            .select()
            .single();

        if (error) return err(new Error(error.message));
        return ok({ schedule: created as ScheduleData });
    },
    // 강사 급여 계산
    instructorSalary: async (instructorId: number, yearMonth: string): Promise<Result<{
        hourlyRate: number;
        totalHours: number;
        grossSalary: number;
        withholdingTax: number;
        netSalary: number;
    }>> => {
        const startDate = `${yearMonth}-01`;
        const lastDay = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]), 0).getDate();
        const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

        // 강사 정보
        const { data: instructor, error: instructorError } = await supabase
            .from('instructors')
            .select('hourly_rate')
            .eq('id', instructorId)
            .single();

        if (instructorError) return err(new Error(instructorError.message));

        const hourlyRate = instructor?.hourly_rate || 0;

        // 해당 월 스케줄
        const { data: schedules, error: schedulesError } = await supabase
            .from('lesson_schedules')
            .select('start_time, end_time, status, substitute_instructor_id, lessons!inner(instructor_id)')
            .gte('date', startDate)
            .lte('date', endDate)
            .in('status', ['scheduled', 'completed', 'substitute']);

        if (schedulesError) return err(new Error(schedulesError.message));

        let totalMinutes = 0;
        (schedules || []).forEach((s) => {
            const lesson = Array.isArray(s.lessons) ? s.lessons[0] : s.lessons;
            const isSubstitute = s.substitute_instructor_id === instructorId;
            const isOriginal = lesson?.instructor_id === instructorId && !s.substitute_instructor_id;

            if (isSubstitute || isOriginal) {
                const start = s.start_time?.split(':').map(Number) || [0, 0];
                const end = s.end_time?.split(':').map(Number) || [0, 0];
                totalMinutes += (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
            }
        });

        const totalHours = totalMinutes / 60;
        const grossSalary = Math.round(totalHours * hourlyRate);
        const withholdingTax = Math.round(grossSalary * 0.033);
        const netSalary = grossSalary - withholdingTax;

        return ok({
            hourlyRate,
            totalHours,
            grossSalary,
            withholdingTax,
            netSalary,
        });
    },
    // 강사 월별 스케줄
    instructorMonth: async (instructorId: number, yearMonth: string): Promise<Result<Array<{
        id: number;
        date: string;
        startTime: string;
        endTime: string;
        status: string;
        lessonTitle: string;
        classroomName: string;
        isSubstitute: boolean;
    }>>> => {
        const startDate = `${yearMonth}-01`;
        const lastDay = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]), 0).getDate();
        const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

        const { data, error } = await supabase
            .from('lesson_schedules')
            .select(`
        id,
        date,
        start_time,
        end_time,
        status,
        substitute_instructor_id,
        lessons!inner(id, title, instructor_id, classrooms(name))
      `)
            .gte('date', startDate)
            .lte('date', endDate)
            .or(`lessons.instructor_id.eq.${instructorId},substitute_instructor_id.eq.${instructorId}`)
            .order('date')
            .order('start_time');

        if (error) return err(new Error(error.message));

        return ok((data || []).map((s) => {
            const lesson = Array.isArray(s.lessons) ? s.lessons[0] : s.lessons;
            const classroom = Array.isArray(lesson?.classrooms) ? lesson?.classrooms[0] : lesson?.classrooms;
            return {
                id: s.id,
                date: s.date,
                startTime: s.start_time,
                endTime: s.end_time,
                status: s.status,
                lessonTitle: lesson?.title || '',
                classroomName: classroom?.name || '',
                isSubstitute: s.substitute_instructor_id === instructorId,
            };
        }));
    },
};
