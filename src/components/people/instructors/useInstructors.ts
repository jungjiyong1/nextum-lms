import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { emitDataChange } from '../../../core/events';
import * as api from '../../../core/api';
import { logger } from '../../../core/logger';
import type { Instructor, InstructorPayment as Payment, SalaryData, InstructorScheduleItem, InstructorLessonSummary, IrregularLessonSchedule } from '../../../core/types';

interface InstructorsState {
    instructors: Instructor[];
    loading: boolean;
    error: string | null;
}

interface InstructorExtrasState {
    salaryData: SalaryData | null;
    calendarData: InstructorScheduleItem[];
    payments: Payment[];
    lessons: InstructorLessonSummary[];
    irregularLessons: IrregularLessonSchedule[];
    loading: boolean;
}

export function useInstructors() {
    // --- State ---
    const [state, setState] = useState<InstructorsState>({
        instructors: [],
        loading: true,
        error: null,
    });

    const [selectedInstructor, setSelectedInstructor] = useState<Instructor | null>(null);
    const [extras, setExtras] = useState<InstructorExtrasState>({
        salaryData: null,
        calendarData: [],
        payments: [],
        lessons: [],
        irregularLessons: [],
        loading: false,
    });

    // --- Actions ---

    const loadInstructors = useCallback(async (searchQuery?: string, statusFilter?: string) => {
        setState(prev => ({ ...prev, loading: true, error: null }));
        let result;
        if (searchQuery) {
            result = await api.searchInstructors(searchQuery);
        } else {
            result = await api.listInstructors({
                status: (statusFilter && statusFilter !== 'all') ? statusFilter : undefined
            });
        }
        if (result.success) {
            setState({ instructors: result.data, loading: false, error: null });
        } else {
            console.error('Failed to load instructors:', result.error);
            setState(prev => ({ ...prev, loading: false, error: 'Failed to load instructors' }));
            toast.error('강사 목록을 불러오지 못했습니다.');
        }
    }, []);

    const loadExtras = useCallback(async (id: number, year: number, month: number) => {
        setExtras(prev => ({ ...prev, loading: true }));
        logger.debug('loadExtras', 'Loading for instructor:', id, 'year:', year, 'month:', month);
        // Load instructor lessons, irregular lessons, calendar data, and salary in parallel
        const [lessonsResult, irregularLessonsResult, calendarResult, salaryResult] = await Promise.all([
            api.listLessonsByInstructor(id),
            api.listIrregularLessonsByInstructor(id),
            api.getInstructorMonthlySchedule(id, year, month),
            api.calculateInstructorMonthlySalary(id, year, month)
        ]);

        const lessons = lessonsResult.success ? lessonsResult.data : [];
        const irregularLessons = irregularLessonsResult.success ? irregularLessonsResult.data : [];
        const calendarData = calendarResult.success ? calendarResult.data : [];
        const salaryData = salaryResult.success ? salaryResult.data : null;

        logger.debug('loadExtras', 'Results - lessons:', lessons.length, 'calendar:', calendarData.length, 'salary:', salaryData);

        setExtras({
            salaryData: salaryData,
            calendarData: calendarData,
            payments: [], // TODO: Add payments API
            lessons: lessons,
            irregularLessons: irregularLessons,
            loading: false
        });
    }, []);

    const createInstructor = async (data: Partial<Instructor>) => {
        const result = await api.createInstructor(data);
        if (result.success) {
            toast.success('강사가 추가되었습니다.');
            emitDataChange('instructors');
            return true;
        } else {
            console.error(result.error);
            toast.error('오류 발생');
            return false;
        }
    };

    const updateInstructor = async (id: number, data: Partial<Instructor>) => {
        const result = await api.updateInstructor(id, data);
        if (result.success) {
            toast.success('수정되었습니다.');
            emitDataChange('instructors');
            // Optimistic update for selected?
            if (selectedInstructor?.id === id) {
                setSelectedInstructor(prev => prev ? { ...prev, ...data } : null);
            }
            return true;
        } else {
            console.error(result.error);
            toast.error('오류 발생');
            return false;
        }
    };

    const deleteInstructor = async (id: number) => {
        const result = await api.deleteInstructor(id);
        if (result.success) {
            toast.success('삭제되었습니다.');
            emitDataChange('instructors');
            if (selectedInstructor?.id === id) setSelectedInstructor(null);
            return true;
        } else {
            console.error(result.error);
            toast.error('오류 발생');
            return false;
        }
    };

    return {
        instructors: state.instructors,
        loading: state.loading,
        error: state.error,
        selectedInstructor,
        setSelectedInstructor,
        extras,
        loadInstructors,
        loadExtras,
        createInstructor,
        updateInstructor,
        deleteInstructor
    };
}

