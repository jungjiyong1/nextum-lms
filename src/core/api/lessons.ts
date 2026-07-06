// Lesson APIs - Result Pattern
import { lmsDb as supabase } from '../supabaseClient';
import type { Lesson, ScheduleLesson } from '../types';
import type { LessonPayload, LessonWithRulesRow, Result, LessonRow } from './shared/types';
import { normalizeLesson, slotToTime } from './shared/normalizers';
import { ok, err } from './shared/result';
import { getDayIndex } from '../utils/date';
import { timeToSlot } from '../utils/time';
import { logger } from '../logger';
import { resetLessons as resetLessonsViaAdmin } from './reset';
import { buildLessonScheduleKey } from './scheduleStatus';

export async function listLessons(): Promise<Result<Lesson[]>> {
    const { data, error } = await supabase
        .from('lessons')
        .select(`
      *,
      lesson_rules (
        day,
        start_slot,
        end_slot
      )
    `)
        .order('id');

    if (error) return err(new Error(error.message));

    return ok((data || []).map((row: LessonWithRulesRow) => ({
        id: Number(row.id),
        classroomId: Number(row.classroom_id),
        day: row.lesson_rules?.[0]?.day ?? null,
        startSlot: row.lesson_rules?.[0]?.start_slot ?? null,
        endSlot: row.lesson_rules?.[0]?.end_slot ?? null,
        title: row.title || '',
        instructor: row.instructor || '',
        instructorId: row.instructor_id ?? null,
        note: row.note || '',
    })));
}

export async function listScheduleLessons(startDate: string, endDate: string): Promise<Result<ScheduleLesson[]>> {
    // 병렬 쿼리 실행 (네트워크 RTT 50% 감소)
    const [schedulesResult, rulesResult] = await Promise.all([
        // 1. lesson_schedules 조회
        supabase
            .from('lesson_schedules')
            .select(`
      id,
      lesson_id,
      rule_id,
      date,
      start_time,
      end_time,
      status,
      notes,
      classroom_id,
      substitute_instructor_id,
      substitute_instructor_name,
      cancel_reason,
      lessons!inner (
        id,
        title,
        instructor,
        instructor_id,
        classroom_id,
        note
      )
    `)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date')
            .order('start_time'),
        // 2. lesson_rules 조회
        supabase
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
        note
      )
    `)
            .eq('active', 1)
    ]);

    const { data: schedulesData, error: schedulesError } = schedulesResult;
    const { data: rulesData, error: rulesError } = rulesResult;

    if (schedulesError) return err(new Error(schedulesError.message));
    if (rulesError) return err(new Error(rulesError.message));

    // lesson_schedules에서 가져온 실제 스케줄
    const scheduleResults: ScheduleLesson[] = (schedulesData || []).map((row) => {
        // Supabase may return lessons as array or single object
        const lesson = Array.isArray(row.lessons) ? row.lessons[0] : row.lessons;
        return {
            id: Number(row.id),
            lessonId: Number(row.lesson_id),
            ruleId: row.rule_id ?? null,
            classroomId: Number(row.classroom_id ?? lesson?.classroom_id ?? 0),
            day: getDayIndex(row.date),
            startSlot: timeToSlot(row.start_time),
            endSlot: timeToSlot(row.end_time),
            title: lesson?.title || '',
            instructor: lesson?.instructor || '',
            instructorId: lesson?.instructor_id ?? null,
            note: lesson?.note ?? row.notes ?? '',
            date: row.date,
            startTime: row.start_time,
            endTime: row.end_time,
            status: row.status as ScheduleLesson['status'],
            substituteInstructorId: row.substitute_instructor_id ?? null,
            substituteInstructorName: row.substitute_instructor_name ?? null,
            cancelReason: row.cancel_reason ?? null,
        };
    });

    // 실제 스케줄이 있는 날짜/수업 조합을 추적 (중복 방지)
    const existingScheduleKeys = new Set(
        scheduleResults.map(s => buildLessonScheduleKey(s.lessonId, s.date, s.startTime, s.endTime))
    );

    const ruleResults: ScheduleLesson[] = [];
    // Parse dates as local time (adding T00:00:00 forces local timezone interpretation)
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');

    logger.debug('listScheduleLessons', 'Querying rules for date range:', startDate, 'to', endDate);
    logger.debug('listScheduleLessons', 'Found', rulesData?.length || 0, 'active rules');

    for (const rule of rulesData || []) {
        // 각 rule에 대해 해당 주간의 날짜 생성 (parse as local time)
        const ruleStartDate = rule.start_date ? new Date(rule.start_date + 'T00:00:00') : null;
        const ruleEndDate = rule.end_date ? new Date(rule.end_date + 'T00:00:00') : null;

        logger.debug('listScheduleLessons', `Processing rule ${rule.id}: day=${rule.day}, lesson_id=${rule.lesson_id}, classroom_id=${(rule as any).lessons?.classroom_id}`);

        // 해당 주간의 모든 요일을 순회
        const current = new Date(start);
        logger.debug('listScheduleLessons', `Rule ${rule.id}: iterating from ${current.toISOString()} to ${end.toISOString()}`);

        while (current <= end) {
            // rule.day uses Monday-first format (0=Mon, 1=Tue, ..., 6=Sun)
            // getDay() returns Sunday-first (0=Sun, 1=Mon, ...)
            // Convert to Monday-first to match DB format
            const dayOfWeek = (current.getDay() + 6) % 7; // Monday=0, Tuesday=1, ..., Sunday=6
            logger.debug('listScheduleLessons', `Rule ${rule.id}: checking date ${current.toISOString()}, dayOfWeek=${dayOfWeek}, rule.day=${rule.day}`);

            // rule.day와 일치하는지 확인
            if (dayOfWeek === rule.day) {
                // 규칙 유효 기간 확인
                if (ruleStartDate && current < ruleStartDate) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }
                if (ruleEndDate && current > ruleEndDate) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }

                // Use local date format instead of toISOString() which returns UTC
                const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

                // 이미 실제 스케줄이 있으면 가상 스케줄 생성하지 않음
                const startTime = slotToTime(rule.start_slot);
                const endTime = slotToTime(rule.end_slot);
                const key = buildLessonScheduleKey(rule.lesson_id, dateStr, startTime, endTime);
                if (existingScheduleKeys.has(key)) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }

                ruleResults.push({
                    id: -(rule.id * 1000 + ruleResults.length), // 가상 ID (음수)
                    lessonId: Number(rule.lesson_id),
                    ruleId: rule.id,
                    classroomId: Number((rule as any).lessons?.classroom_id ?? 0),
                    day: dayOfWeek,
                    startSlot: rule.start_slot,
                    endSlot: rule.end_slot,
                    title: (rule as any).lessons?.title || '',
                    instructor: (rule as any).lessons?.instructor || '',
                    instructorId: (rule as any).lessons?.instructor_id ?? null,
                    note: (rule as any).lessons?.note ?? '',
                    date: dateStr,
                    startTime,
                    endTime,
                    status: 'scheduled',
                    substituteInstructorId: null,
                    substituteInstructorName: null,
                    cancelReason: null,
                });
            }
            current.setDate(current.getDate() + 1);
        }
    }

    logger.debug('listScheduleLessons', 'Returning', scheduleResults.length, 'schedule results +', ruleResults.length, 'rule results');

    // 3. 실제 스케줄과 가상 스케줄 합쳐서 반환
    return ok([...scheduleResults, ...ruleResults]);
}

export async function createLesson(data: LessonPayload): Promise<Result<Lesson>> {
    // 1. Create lesson
    const { data: created, error } = await supabase
        .from('lessons')
        .insert({
            classroom_id: data.classroomId,
            title: data.title,
            instructor: data.instructor,
            instructor_id: data.instructorId ?? null,
            note: data.note ?? '',
        })
        .select()
        .single();

    if (error) return err(new Error(error.message));

    // 2. Create rule or schedule based on lesson type
    if (data.day !== undefined && data.startSlot !== undefined && data.endSlot !== undefined) {
        const startTime = slotToTime(data.startSlot);
        const endTime = slotToTime(data.endSlot);

        if (data.isRegular) {
            // Regular lesson: create lesson_rules for recurring display
            const { error: ruleError } = await supabase
                .from('lesson_rules')
                .insert({
                    lesson_id: created.id,
                    day: data.day,
                    start_slot: data.startSlot,
                    end_slot: data.endSlot,
                    start_date: data.startDate ?? new Date().toISOString().split('T')[0],
                    end_date: data.endDate ?? null,
                });

            if (ruleError) return err(new Error(ruleError.message));
        } else {
            // Non-regular lesson: create lesson_schedules for one-time display
            const scheduleDate = data.scheduleDate ?? data.startDate ?? new Date().toISOString().split('T')[0];

            // Calculate duration in minutes (each slot is 30 minutes)
            const durationMinutes = (data.endSlot - data.startSlot) * 30;

            const { error: scheduleError } = await supabase
                .from('lesson_schedules')
                .insert({
                    lesson_id: created.id,
                    date: scheduleDate,
                    start_time: startTime,
                    end_time: endTime,
                    duration_minutes: durationMinutes,
                    status: 'scheduled',
                    notes: data.note ?? null,
                });

            if (scheduleError) return err(new Error(scheduleError.message));
        }
    }

    return ok(normalizeLesson(created as LessonRow));
}

export async function updateLesson(data: LessonPayload): Promise<Result<void>> {
    if (!data.id) return err(new Error('Lesson ID is required'));

    const { error } = await supabase
        .from('lessons')
        .update({
            classroom_id: data.classroomId,
            title: data.title,
            instructor: data.instructor,
            instructor_id: data.instructorId ?? null,
            note: data.note ?? '',
        })
        .eq('id', data.id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function updateLessonRule(data: {
    ruleId: number;
    day: number;
    startSlot: number;
    endSlot: number;
    startDate?: string | null;
    endDate?: string | null;
    effectiveFromDate?: string
}): Promise<Result<void>> {
    const today = new Date().toISOString().split('T')[0];

    // 1. 기존 규칙 정보 가져오기
    const { data: existingRule, error: fetchError } = await supabase
        .from('lesson_rules')
        .select('lesson_id, day, start_slot, end_slot, start_date')
        .eq('id', data.ruleId)
        .single();

    if (fetchError || !existingRule) {
        return err(new Error(fetchError?.message || 'Rule not found'));
    }

    // 2. 기존 start_date부터 오늘까지 가상 스케줄을 실제 스케줄로 "확정"
    const oldStartDate = existingRule.start_date || today;
    const oldDay = existingRule.day;
    const oldStartSlot = existingRule.start_slot;
    const oldEndSlot = existingRule.end_slot;

    // 기존 start_date부터 오늘 전날까지의 모든 해당 요일에 스케줄 생성
    const startDateObj = new Date(oldStartDate + 'T00:00:00');
    const todayObj = new Date(today + 'T00:00:00');

    // 이미 존재하는 스케줄 확인 (중복 방지)
    const { data: existingSchedules } = await supabase
        .from('lesson_schedules')
        .select('date')
        .eq('lesson_id', existingRule.lesson_id)
        .gte('date', oldStartDate)
        .lt('date', today);

    const existingDates = new Set((existingSchedules || []).map(s => s.date));

    // 가상 스케줄을 실제 스케줄로 변환
    const schedulesToCreate: Array<{
        lesson_id: number;
        rule_id: number;
        date: string;
        start_time: string;
        end_time: string;
        status: string;
    }> = [];

    const current = new Date(startDateObj);
    while (current < todayObj) {
        const dayOfWeek = (current.getDay() + 6) % 7; // Monday-first format

        if (dayOfWeek === oldDay) {
            const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

            if (!existingDates.has(dateStr)) {
                schedulesToCreate.push({
                    lesson_id: existingRule.lesson_id,
                    rule_id: data.ruleId,
                    date: dateStr,
                    start_time: slotToTime(oldStartSlot),
                    end_time: slotToTime(oldEndSlot),
                    status: 'completed'
                });
            }
        }
        current.setDate(current.getDate() + 1);
    }

    // 확정된 스케줄들을 DB에 삽입
    if (schedulesToCreate.length > 0) {
        const { error: insertError } = await supabase
            .from('lesson_schedules')
            .insert(schedulesToCreate);

        if (insertError) {
            logger.warn('updateLessonRule', 'Failed to materialize past schedules:', insertError.message);
            // 경고만 하고 계속 진행 (과거 스케줄 생성 실패가 규칙 업데이트를 막지 않음)
        } else {
            logger.debug('updateLessonRule', `Materialized ${schedulesToCreate.length} past schedules`);
        }
    }

    // 3. 규칙 업데이트 - effectiveFromDate(이동 대상 날짜) 또는 startDate 또는 today 사용
    const newStartDate = data.effectiveFromDate ?? (data.startDate !== undefined ? data.startDate : today);

    const { error } = await supabase
        .from('lesson_rules')
        .update({
            day: data.day,
            start_slot: data.startSlot,
            end_slot: data.endSlot,
            start_date: newStartDate,
            end_date: data.endDate ?? null,
        })
        .eq('id', data.ruleId);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function deleteLesson(id: number): Promise<Result<void>> {
    // Cascade delete should handle related records
    const { error } = await supabase
        .from('lessons')
        .delete()
        .eq('id', id);

    if (error) return err(new Error(error.message));
    return ok(undefined);
}

export async function resetLessons(): Promise<Result<void>> {
    return resetLessonsViaAdmin();
}

export async function listScheduleLessonsByRange(startDate: string, endDate: string): Promise<Result<ScheduleLesson[]>> {
    return listScheduleLessons(startDate, endDate);
}
