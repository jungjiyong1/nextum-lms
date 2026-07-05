import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { Search, UserPlus, UserMinus, Clock, MapPin, User } from 'lucide-react';
import { slotToTime } from '../../core/utils/time';
import type { ScheduleLesson, Student } from '../../core/types';

interface LessonStudentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lesson?: ScheduleLesson | null;
    lessonId?: number;  // Alternative: just provide lessonId
    onSuccess?: () => void;
}

interface EnrolledStudent {
    enrollmentId: number;
    student: Student;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function LessonStudentDialog({ open, onOpenChange, lesson, lessonId: propLessonId, onSuccess }: LessonStudentDialogProps) {
    const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
    const [allStudents, setAllStudents] = useState<Student[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [assigningId, setAssigningId] = useState<number | null>(null);
    const [lessonInfo, setLessonInfo] = useState<{ title: string; day: number; startSlot: number; endSlot: number; instructor?: string } | null>(null);

    // Determine effective lessonId
    const effectiveLessonId = lesson?.lessonId ?? propLessonId;

    // Load enrolled students and all students using Supabase API
    const loadData = useCallback(async () => {
        if (!effectiveLessonId) return;
        setLoading(true);
        try {
            // Use Supabase API instead of window.api
            const supabase = (await import('../../core/supabaseClient')).lmsDb;
            const api = await import('../../core/api');

            // Load lesson info if we only have lessonId (not full lesson object)
            if (!lesson && propLessonId) {
                const { data: lessonData } = await supabase
                    .from('lessons')
                    .select('title, lesson_rules(day, start_slot, end_slot), instructors(name)')
                    .eq('id', propLessonId)
                    .single();
                if (lessonData) {
                    const rule = lessonData.lesson_rules?.[0];
                    setLessonInfo({
                        title: lessonData.title,
                        day: rule?.day ?? 0,
                        startSlot: rule?.start_slot ?? 0,
                        endSlot: rule?.end_slot ?? 0,
                        instructor: (lessonData as any).instructors?.name
                    });
                }
            } else if (lesson) {
                setLessonInfo({
                    title: lesson.title,
                    day: lesson.day,
                    startSlot: lesson.startSlot,
                    endSlot: lesson.endSlot,
                    instructor: lesson.instructor
                });
            }

            // Load enrollments with student info
            const { data: enrollments } = await supabase
                .from('enrollments')
                .select('id, student_id, students(id, name, phone, school_type, grade)')
                .eq('lesson_id', effectiveLessonId)
                .eq('status', 'enrolled');

            // Load all active students
            const studentsResult = await api.listStudents();
            if (!studentsResult.success) {
                toast.error('학생 목록 로드 실패: ' + studentsResult.error.message);
                setLoading(false);
                return;
            }

            // Map enrollments to EnrolledStudent format
            const enrolled: EnrolledStudent[] = (enrollments || []).map((e: any) => ({
                enrollmentId: e.id,
                student: {
                    id: e.students?.id ?? e.student_id,
                    name: e.students?.name ?? '',
                    email: null,
                    phone: e.students?.phone ?? null,
                    date_of_birth: null,
                    enrollment_date: null,
                    status: 'active' as const,
                    parent_name: null,
                    parent_phone: null,
                    monthly_tuition: null,
                    payment_cycle_day: 1,
                    last_payment_date: null,
                    notes: null,
                    school_type: e.students?.school_type ?? null,
                    grade: e.students?.grade ?? null,
                }
            }));

            setEnrolledStudents(enrolled);
            setAllStudents(studentsResult.data);
        } catch (e) {
            console.error('Failed to load data:', e);
            toast.error('데이터 로드 실패');
        } finally {
            setLoading(false);
        }
    }, [effectiveLessonId, lesson, propLessonId]);

    useEffect(() => {
        if (open && effectiveLessonId) {
            loadData();
            setSearchQuery('');
        }
    }, [open, effectiveLessonId, loadData]);

    // Helper to format school/grade
    const getSchoolGradeLabel = (schoolType: string | null, grade: number | null): string => {
        if (!schoolType || grade === null) return '';
        const schoolLabels: Record<string, string> = {
            'elementary': '초',
            'middle': '중',
            'high': '고',
        };
        return `${schoolLabels[schoolType] || schoolType}${grade}`;
    };

    // Filter available students (not enrolled) and match search
    const availableStudents = useMemo(() => {
        const enrolledIds = new Set(enrolledStudents.map(e => e.student.id));
        return allStudents
            .filter(s => !enrolledIds.has(s.id))
            .filter(s => {
                if (!searchQuery.trim()) return true;
                const fullName = s.name?.toLowerCase() || '';
                const query = searchQuery.toLowerCase();
                return fullName.includes(query) ||
                    (s.phone && s.phone.includes(query)) ||
                    getSchoolGradeLabel(s.school_type, s.grade).includes(query);
            });
    }, [allStudents, enrolledStudents, searchQuery]);

    // Assign student to lesson using Supabase API
    const handleAssign = async (studentId: number) => {
        if (!effectiveLessonId) return;
        setAssigningId(studentId);
        const api = await import('../../core/api');
        const result = await api.createEnrollment({ studentId, lessonId: effectiveLessonId });
        if (result.success) {
            toast.success('학생이 배정되었습니다');
            await loadData();
            onSuccess?.();
        } else {
            console.error('Failed to assign:', result.error);
            toast.error('배정 중 오류 발생: ' + result.error.message);
        }
        setAssigningId(null);
    };

    // Unassign student from lesson using Supabase API
    const handleUnassign = async (enrollmentId: number) => {
        const api = await import('../../core/api');
        const result = await api.deleteEnrollment(enrollmentId);
        if (result.success) {
            toast.success('학생이 제외되었습니다');
            await loadData();
            onSuccess?.();
        } else {
            console.error('Failed to unassign:', result.error);
            toast.error('제외 중 오류 발생: ' + result.error.message);
        }
    };

    // Use lessonInfo (from API) or fall back to lesson prop
    const displayInfo = lessonInfo ?? (lesson ? { title: lesson.title, day: lesson.day, startSlot: lesson.startSlot, endSlot: lesson.endSlot, instructor: lesson.instructor } : null);
    if (!effectiveLessonId || !displayInfo) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span className="text-xl">📚</span>
                        <span>{displayInfo.title}</span>
                        <span className="text-sm font-normal text-muted-foreground">
                            학생 관리
                        </span>
                    </DialogTitle>
                </DialogHeader>

                {/* Lesson Info */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground border-b pb-3">
                    <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        <span>{DAYS[displayInfo.day]} {slotToTime(displayInfo.startSlot)}~{slotToTime(displayInfo.endSlot)}</span>
                    </div>
                    {displayInfo.instructor && (
                        <div className="flex items-center gap-1.5">
                            <User className="w-4 h-4" />
                            <span>{displayInfo.instructor}</span>
                        </div>
                    )}
                </div>

                <div className="flex-1 flex gap-4 overflow-hidden pt-3">
                    {/* Enrolled Students */}
                    <div className="flex-1 flex flex-col border rounded-lg overflow-hidden">
                        <div className="bg-muted px-3 py-2 font-medium text-sm flex items-center justify-between">
                            <span>등록된 학생</span>
                            <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
                                {enrolledStudents.length}명
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {loading ? (
                                <div className="text-center text-muted-foreground py-8">로딩 중...</div>
                            ) : enrolledStudents.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8 text-sm">
                                    등록된 학생이 없습니다
                                </div>
                            ) : (
                                enrolledStudents.map(({ enrollmentId, student }) => (
                                    <div
                                        key={enrollmentId}
                                        className="flex items-center justify-between p-2.5 rounded-lg bg-background hover:bg-muted/50 border group transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm truncate">
                                                {student.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {getSchoolGradeLabel(student.school_type, student.grade)}
                                                {student.phone && ` · ${student.phone}`}
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => handleUnassign(enrollmentId)}
                                        >
                                            <UserMinus className="w-4 h-4 mr-1" />
                                            제외
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Available Students (with search) */}
                    <div className="flex-1 flex flex-col border rounded-lg overflow-hidden">
                        <div className="bg-muted px-3 py-2 font-medium text-sm">
                            학생 추가
                        </div>

                        {/* Search bar */}
                        <div className="p-2 border-b">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    type="text"
                                    placeholder="이름, 전화번호, 학년으로 검색..."
                                    value={searchQuery}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                                    className="pl-8 h-9"
                                />
                            </div>
                        </div>

                        {/* Student list */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {loading ? (
                                <div className="text-center text-muted-foreground py-8">로딩 중...</div>
                            ) : availableStudents.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8 text-sm">
                                    {searchQuery ? '검색 결과가 없습니다' : '추가 가능한 학생이 없습니다'}
                                </div>
                            ) : (
                                availableStudents.map((student) => (
                                    <div
                                        key={student.id}
                                        className={cn(
                                            "flex items-center justify-between p-2.5 rounded-lg bg-background hover:bg-primary/5 border group transition-colors cursor-pointer",
                                            assigningId === student.id && "opacity-50 pointer-events-none"
                                        )}
                                        onClick={() => handleAssign(student.id)}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm truncate">
                                                {student.name}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {getSchoolGradeLabel(student.school_type, student.grade)}
                                                {student.phone && ` · ${student.phone}`}
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="opacity-0 group-hover:opacity-100 text-primary hover:text-primary hover:bg-primary/10"
                                            onClick={(e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                handleAssign(student.id);
                                            }}
                                            disabled={assigningId === student.id}
                                        >
                                            <UserPlus className="w-4 h-4 mr-1" />
                                            추가
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end pt-3 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        닫기
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
