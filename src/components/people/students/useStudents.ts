import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { emitDataChange, onDataChange } from '../../../core/events';
import * as api from '../../../core/api';
import type { Student, Enrollment, StudentPayment as Payment, IrregularLessonSchedule } from '../../../core/types';

function apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string' && error) return error;
    return fallback;
}

// State Interfaces
interface StudentsState {
    students: Student[];
    loading: boolean;
    error: string | null;
}

interface StudentExtrasState {
    enrollments: Enrollment[];
    payments: Payment[];
    irregularLessons: IrregularLessonSchedule[];
    loading: boolean;
}

// Hook Options
interface UseStudentsOptions {
    initialFilters?: {
        status?: string;
        schoolType?: string;
        grade?: string;
        overdue?: boolean;
    };
}

export function useStudents(options: UseStudentsOptions = {}) {
    // --- State ---
    const [state, setState] = useState<StudentsState>({
        students: [],
        loading: true,
        error: null,
    });

    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const [extras, setExtras] = useState<StudentExtrasState>({
        enrollments: [],
        payments: [],
        irregularLessons: [],
        loading: false,
    });

    // --- Actions ---

    const loadStudents = useCallback(async (searchQuery?: string, overdueOnly?: boolean, statusFilter?: string) => {
        setState(prev => ({ ...prev, loading: true, error: null }));
        let result: any;
        if (overdueOnly) {
            result = await window.api.students.overdue();
        } else if (searchQuery) {
            result = await window.api.students.search(searchQuery);
        } else {
            result = await window.api.students.list({
                status: (statusFilter && statusFilter !== 'all') ? statusFilter : undefined
            });
        }
        if (result.success) {
            setState({ students: result.data, loading: false, error: null });
        } else {
            console.error(result.error);
            setState(prev => ({ ...prev, loading: false, error: 'Failed to load students' }));
            toast.error('학생 목록을 불러오지 못했습니다.');
        }
    }, []);

    const loadStudentExtras = useCallback(async (studentId: number) => {
        setExtras(prev => ({ ...prev, loading: true }));
        const [enrollmentsResult, paymentsResult, irregularResult] = await Promise.all([
            window.api.students.enrollments(studentId),
            window.api.accounting.studentPayments(studentId),
            api.listIrregularLessonsByStudent(studentId)
        ]);

        const enrollmentsData = enrollmentsResult.success ? enrollmentsResult.data as Enrollment[] : [];
        const paymentsData = paymentsResult.success ? paymentsResult.data as Payment[] : [];
        const irregularData = irregularResult.success ? irregularResult.data : [];

        setExtras({
            enrollments: enrollmentsData,
            payments: paymentsData,
            irregularLessons: irregularData,
            loading: false
        });
    }, []);

    const createStudent = async (data: Partial<Student>) => {
        try {
            const res = await window.api.students.create(data);
            if (res.success) {
                toast.success('학생이 추가되었습니다.');
                emitDataChange('students');
                return true;
            } else {
                toast.error(apiErrorMessage(res.error, '추가 실패'));
                return false;
            }
        } catch (e) {
            console.error(e);
            toast.error('오류 발생');
            return false;
        }
    };

    const updateStudent = async (id: number, data: Partial<Student>) => {
        try {
            const res = await window.api.students.update({ ...data, id });
            if (res.success) {
                toast.success('수정되었습니다.');
                emitDataChange('students');
                // Update selected student if it's the same
                if (selectedStudent?.id === id) {
                    setSelectedStudent(prev => prev ? { ...prev, ...data } : null);
                }
                return true;
            } else {
                toast.error(apiErrorMessage(res.error, '수정 실패'));
                return false;
            }
        } catch (e) {
            console.error(e);
            toast.error('오류 발생');
            return false;
        }
    };

    const deleteStudent = async (id: number) => {
        try {
            const res = await window.api.students.delete(id);
            if (res.success) {
                toast.success('삭제되었습니다.');
                emitDataChange('students');
                if (selectedStudent?.id === id) setSelectedStudent(null);
                return true;
            } else {
                toast.error(apiErrorMessage(res.error, '삭제 실패'));
                return false;
            }
        } catch (e) {
            console.error(e);
            toast.error('오류 발생');
            return false;
        }
    };

    const unassignEnrollment = async (enrollmentId: number) => {
        try {
            const res = await window.api.enrollments.unassign(enrollmentId);
            if (res.success) {
                toast.success('수강 해제 완료');
                emitDataChange('enrollments');
                if (selectedStudent) loadStudentExtras(selectedStudent.id);
            } else {
                toast.error(apiErrorMessage(res.error, '수강 해제 실패'));
            }
        } catch (e) {
            toast.error('오류 발생');
        }
    };

    // --- Effects ---
    // Event listener handled by component usually, or here?
    // If here, we need access to current filters to reload correct data.
    // It's cleaner to expose a `refresh` method and let component handle event listening, OR manage it here with refs.
    // Let's expose refresh.

    return {
        students: state.students,
        loading: state.loading,
        error: state.error,
        selectedStudent,
        setSelectedStudent,
        extras,
        loadStudents,
        loadStudentExtras,
        createStudent,
        updateStudent,
        deleteStudent,
        unassignEnrollment,
    };
}
