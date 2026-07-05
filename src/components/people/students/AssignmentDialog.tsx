import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '../../../lib/utils';
import { MiniTimetable } from '../../lessons/MiniTimetable';
import { slotToTime } from '../../../core/utils/time';
import * as api from '../../../core/api';
import type { Student, Instructor, Lesson, IrregularLessonSchedule } from '../../../core/types';

interface AssignmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    student: Student;
    onSuccess: () => void;
}

export function AssignmentDialog({ open, onOpenChange, student, onSuccess }: AssignmentDialogProps) {
    const [instructors, setInstructors] = useState<Instructor[]>([]);
    const [lessons, setLessons] = useState<Lesson[]>([]);
    const [irregularSchedules, setIrregularSchedules] = useState<IrregularLessonSchedule[]>([]);
    const [selectedInstructorKey, setSelectedInstructorKey] = useState<string | null>(null);
    const [selectedLessonIds, setSelectedLessonIds] = useState<Set<number>>(new Set());
    // Map of lessonId -> enrollmentId for already enrolled lessons
    const [enrollmentMap, setEnrollmentMap] = useState<Map<number, number>>(new Map());

    useEffect(() => {
        if (!open) return;
        const loadData = async () => {
            const [insResult, allLessonsResult, enrollmentsResult] = await Promise.all([
                api.listInstructors({ status: 'active' }),
                api.listLessons(),
                api.listEnrollmentsByStudent(student.id)
            ]);

            if (!insResult.success) {
                toast.error('강사 목록 로드 실패: ' + insResult.error.message);
                return;
            }
            if (!allLessonsResult.success) {
                toast.error('강의 목록 로드 실패: ' + allLessonsResult.error.message);
                return;
            }

            setInstructors(insResult.data);
            setLessons(allLessonsResult.data);

            // Load existing enrollments and pre-select them
            const enrolledIds = new Set<number>();
            const enrollMap = new Map<number, number>();
            if (enrollmentsResult.success) {
                enrollmentsResult.data.forEach((e: { id: number; lesson_id: number }) => {
                    enrolledIds.add(e.lesson_id);
                    enrollMap.set(e.lesson_id, e.id);
                });
            }
            setEnrollmentMap(enrollMap);
            setSelectedLessonIds(new Set(enrolledIds));

            if (insResult.data.length > 0) {
                setSelectedInstructorKey(String(insResult.data[0].id));
                // Load irregular schedules for first instructor
                const irregularsResult = await api.listIrregularLessonsByInstructor(insResult.data[0].id);
                if (irregularsResult.success) {
                    setIrregularSchedules(irregularsResult.data);
                }
            }
        };
        loadData();
    }, [open, student.id]);

    // Load irregular schedules when instructor changes
    useEffect(() => {
        if (!selectedInstructorKey) return;
        const loadIrregulars = async () => {
            const result = await api.listIrregularLessonsByInstructor(Number(selectedInstructorKey));
            if (result.success) {
                setIrregularSchedules(result.data);
            } else {
                console.error(result.error);
            }
        };
        loadIrregulars();
    }, [selectedInstructorKey]);

    const handleAssign = async () => {
        // New lessons to assign (selected but not enrolled)
        const newLessonIds = Array.from(selectedLessonIds).filter(id => !enrollmentMap.has(id));
        // Lessons to unassign (enrolled but not selected)
        const unassignLessonIds = Array.from(enrollmentMap.keys()).filter(id => !selectedLessonIds.has(id));

        if (newLessonIds.length === 0 && unassignLessonIds.length === 0) {
            toast.error('변경 사항이 없습니다.');
            return;
        }

        let assignSuccess = 0;
        let assignFail = 0;
        let unassignSuccess = 0;
        let unassignFail = 0;

        // Create new enrollments
        for (const lessonId of newLessonIds) {
            const result = await api.createEnrollment({ studentId: student.id, lessonId });
            if (result.success) {
                assignSuccess++;
            } else {
                console.error('Enrollment failed:', result.error);
                assignFail++;
            }
        }

        // Delete enrollments
        for (const lessonId of unassignLessonIds) {
            const enrollmentId = enrollmentMap.get(lessonId);
            if (enrollmentId) {
                const result = await api.deleteEnrollment(enrollmentId);
                if (result.success) {
                    unassignSuccess++;
                } else {
                    console.error('Unenrollment failed:', result.error);
                    unassignFail++;
                }
            }
        }

        const messages: string[] = [];
        if (assignSuccess > 0) messages.push(`${assignSuccess}개 배정`);
        if (unassignSuccess > 0) messages.push(`${unassignSuccess}개 해제`);
        if (assignFail > 0 || unassignFail > 0) messages.push(`${assignFail + unassignFail}개 실패`);

        toast.message(`완료: ${messages.join(', ')}`);
        onSuccess();
        onOpenChange(false);
    };

    const toggleLesson = (id: number) => {
        const newSet = new Set(selectedLessonIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedLessonIds(newSet);
    };

    // Filter lessons by selected instructor
    const filteredLessons = useMemo(() => {
        if (!selectedInstructorKey) return [];
        return lessons.filter(l =>
            String(l.instructorId) === selectedInstructorKey
        );
    }, [lessons, selectedInstructorKey]);

    // Check if lesson is irregular (no day/time set)
    const isIrregularLesson = (lesson: Lesson) => {
        return lesson.day === null || lesson.startSlot === null || lesson.endSlot === null;
    };

    const formatTime = (day: number | null, start: number | null, end: number | null, lessonId?: number) => {
        if (day === null || start === null || end === null) {
            // Find schedule info for this irregular lesson
            if (lessonId) {
                const schedule = irregularSchedules.find(s => s.lesson_title && lessons.find(l => l.id === lessonId)?.title === s.lesson_title);
                if (schedule) {
                    const d = new Date(schedule.date);
                    const days = ['일', '월', '화', '수', '목', '금', '토'];
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const dayNum = String(d.getDate()).padStart(2, '0');
                    const dayName = days[d.getDay()];
                    return `${month}/${dayNum}(${dayName}) ${schedule.start_time.slice(0, 5)}-${schedule.end_time.slice(0, 5)}`;
                }
            }
            return '비정규 수업';
        }
        const days = ['월', '화', '수', '목', '금', '토', '일'];
        return `${days[day]} ${slotToTime(start)}-${slotToTime(end)}`;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>강의 배정 - {student.name}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-1 gap-4 overflow-hidden pt-4">
                    {/* Instructors */}
                    <div className="w-1/5 border rounded overflow-y-auto p-2 space-y-1">
                        <div className="text-sm font-medium mb-2 sticky top-0 bg-background">강사</div>
                        {instructors.map(ins => (
                            <div
                                key={ins.id}
                                onClick={() => setSelectedInstructorKey(String(ins.id))}
                                className={cn(
                                    "p-1.5 rounded cursor-pointer text-xs hover:bg-accent",
                                    selectedInstructorKey === String(ins.id) ? "bg-accent font-medium text-primary" : ""
                                )}
                            >
                                {ins.name}
                            </div>
                        ))}
                    </div>

                    {/* Lessons - Card Selection */}
                    <div className="w-2/5 border rounded overflow-y-auto p-2 space-y-2">
                        <div className="text-sm font-medium mb-2 sticky top-0 bg-background">강의 (선택)</div>
                        {filteredLessons.length === 0 ? (
                            <div className="text-muted-foreground text-xs">강의 없음</div>
                        ) : (
                            <div className="grid gap-2">
                                {filteredLessons.map(lesson => {
                                    const isSelected = selectedLessonIds.has(lesson.id);
                                    const isEnrolled = enrollmentMap.has(lesson.id);
                                    return (
                                        <div
                                            key={lesson.id}
                                            onClick={() => toggleLesson(lesson.id)}
                                            className={cn(
                                                "relative p-3 rounded-lg border-2 cursor-pointer transition-all duration-200",
                                                "hover:shadow-md hover:scale-[1.02]",
                                                isIrregularLesson(lesson) && "border-dashed bg-orange-50/50",
                                                isSelected
                                                    ? "border-primary bg-primary/10 shadow-sm"
                                                    : isIrregularLesson(lesson)
                                                        ? "border-orange-300 hover:border-orange-400 hover:bg-orange-50"
                                                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                                            )}
                                        >
                                            {/* Selected checkmark badge */}
                                            {isSelected && (
                                                <div className={cn(
                                                    "absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center",
                                                    isEnrolled ? "bg-green-500" : "bg-primary"
                                                )}>
                                                    <svg
                                                        className="w-3 h-3 text-primary-foreground"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={3}
                                                            d="M5 13l4 4L19 7"
                                                        />
                                                    </svg>
                                                </div>
                                            )}
                                            {/* Enrolled badge */}
                                            {isEnrolled && (
                                                <div className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                                                    배정됨
                                                </div>
                                            )}
                                            <div className="pr-6">
                                                <div className={cn(
                                                    "text-sm font-medium",
                                                    isSelected && "text-primary"
                                                )}>
                                                    {lesson.title}
                                                </div>
                                                <div className={cn(
                                                    "text-xs mt-1",
                                                    isIrregularLesson(lesson) ? "text-orange-600 font-medium" : "text-muted-foreground"
                                                )}>
                                                    {formatTime(lesson.day, lesson.startSlot, lesson.endSlot, lesson.id)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Selected Summary + Timetable Preview */}
                    <div className="w-2/5 flex flex-col gap-3">
                        {/* Selected lessons list */}
                        <div className="border rounded p-3 flex flex-col h-1/3">
                            <div className="font-medium mb-2 text-sm">선택된 강의 ({selectedLessonIds.size})</div>
                            <div className="flex-1 overflow-y-auto space-y-1">
                                {Array.from(selectedLessonIds).map(id => {
                                    const l = lessons.find(x => x.id === id);
                                    if (!l) return null;
                                    return (
                                        <div key={id} className="text-xs p-1.5 bg-muted rounded flex justify-between items-center">
                                            <span className="truncate">{l.title}</span>
                                            <span
                                                className="text-muted-foreground hover:text-destructive cursor-pointer ml-2"
                                                onClick={() => toggleLesson(id)}
                                                role="button"
                                            >
                                                ✕
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Timetable preview */}
                        <div className="border rounded p-3 flex-1 flex flex-col min-h-0">
                            <div className="font-medium mb-2 text-sm">시간표 미리보기</div>
                            <div className="flex-1 min-h-0">
                                <MiniTimetable
                                    lessons={Array.from(selectedLessonIds).map(id => lessons.find(x => x.id === id)).filter((l): l is Lesson => !!l)}
                                />
                            </div>
                        </div>

                        <Button
                            className="w-full"
                            onClick={handleAssign}
                            disabled={
                                // 변경 사항이 없을 때만 비활성화
                                Array.from(selectedLessonIds).filter(id => !enrollmentMap.has(id)).length === 0 &&
                                Array.from(enrollmentMap.keys()).filter(id => !selectedLessonIds.has(id)).length === 0
                            }
                        >
                            배정하기
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
