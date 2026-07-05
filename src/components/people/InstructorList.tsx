import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useDebounce } from '../../hooks/useDebounce';
import { onDataChange } from '../../core/events';
import { useInstructors } from './instructors/useInstructors';
import { InstructorListPanel } from './instructors/InstructorListPanel';
import { InstructorDetailPanel } from './instructors/InstructorDetailPanel';
import { InstructorFormDialog } from './instructors/InstructorFormDialog';
import { LessonStudentDialog } from '../lessons/LessonStudentDialog';
import { LessonDialog, LessonDialogRef } from '../lessons/LessonDialog';
import * as api from '../../core/api';
import { emitDataChange } from '../../core/events';
import { getWeekStart, getWeekRange } from '../../core/utils/date';
import type { Instructor, ScheduleLesson } from '../../core/types';

export function InstructorList() {
    // --- State & Hook ---
    const {
        instructors,
        loading,
        selectedInstructor,
        setSelectedInstructor,
        extras,
        loadInstructors,
        loadExtras,
        deleteInstructor
    } = useInstructors();

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const debouncedSearch = useDebounce(searchQuery, 300);

    // Calendar State
    const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
    const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);

    // Dialogs
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    // Lesson dialogs (triggered from InstructorDetailPanel context menu)
    const [studentDialogOpen, setStudentDialogOpen] = useState(false);
    const [studentDialogLessonId, setStudentDialogLessonId] = useState<number | null>(null);

    // Lesson Edit Dialog Ref
    const lessonDialogRef = useRef<LessonDialogRef>(null);

    // --- Loading Logic ---
    useEffect(() => {
        loadInstructors(debouncedSearch, statusFilter);
    }, [debouncedSearch, statusFilter, loadInstructors]);

    // Extras Loading
    useEffect(() => {
        if (selectedInstructor) {
            loadExtras(selectedInstructor.id, currentYear, currentMonth);
        }
    }, [selectedInstructor, currentYear, currentMonth, loadExtras]);

    // Data Change Listener
    useEffect(() => {
        const unsubscribe = onDataChange(({ scope }) => {
            if (['instructors', 'schedules', 'accounting', 'lessons'].includes(scope) || scope === 'general') {
                loadInstructors(debouncedSearch, statusFilter);
                if (selectedInstructor) {
                    loadExtras(selectedInstructor.id, currentYear, currentMonth);
                }
            }
        });
        return unsubscribe;
    }, [loadInstructors, loadExtras, selectedInstructor, currentYear, currentMonth, debouncedSearch, statusFilter]);

    // Handlers
    const handleSelectInstructor = (inst: Instructor) => {
        if (selectedInstructor?.id === inst.id) return;
        setSelectedInstructor(inst);
        // Extras effect will trigger
    };

    const handleMonthChange = (delta: number) => {
        let newMonth = currentMonth + delta;
        let newYear = currentYear;
        if (newMonth > 12) { newMonth = 1; newYear++; }
        if (newMonth < 1) { newMonth = 12; newYear--; }
        setCurrentMonth(newMonth);
        setCurrentYear(newYear);
    };

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b p-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold">강사 관리</h2>
                    <Button onClick={() => setIsAddDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        강사 추가
                    </Button>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="전체 상태" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체 상태</SelectItem>
                            <SelectItem value="active">활동 중</SelectItem>
                            <SelectItem value="inactive">비활성</SelectItem>
                            <SelectItem value="on_leave">휴직 중</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="강사 검색..."
                            className="w-64 pl-8"
                            value={searchQuery}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Split Content */}
            <div className="flex flex-1 overflow-hidden">
                <InstructorListPanel
                    instructors={instructors}
                    selectedId={selectedInstructor?.id || null}
                    onSelect={handleSelectInstructor}
                    loading={loading}
                />

                <InstructorDetailPanel
                    instructor={selectedInstructor}
                    salaryData={extras.salaryData}
                    calendarData={extras.calendarData}
                    payments={extras.payments}
                    lessons={extras.lessons}
                    irregularLessons={extras.irregularLessons}
                    loading={extras.loading}
                    currentYear={currentYear}
                    currentMonth={currentMonth}
                    onMonthChange={handleMonthChange}
                    onEdit={() => setIsEditDialogOpen(true)}
                    onDelete={() => selectedInstructor && deleteInstructor(selectedInstructor.id)}
                    onLessonCreate={() => {
                        if (selectedInstructor) {
                            lessonDialogRef.current?.open(null, null, null, selectedInstructor.id);
                        }
                    }}
                    onLessonEdit={async (lessonId) => {
                        // Find lesson from extras and construct ScheduleLesson to open edit dialog
                        const lessonSummary = extras.lessons.find(l => l.lesson_id === lessonId);
                        if (lessonSummary) {
                            // Construct a minimal ScheduleLesson from the summary data
                            // Use actual rule_id from API, not hardcoded value
                            const scheduleLesson: ScheduleLesson = {
                                id: lessonSummary.rule_id ? -1 : 0, // Use -1 for rule-based lessons to indicate "virtual schedule"
                                lessonId: lessonSummary.lesson_id,
                                ruleId: lessonSummary.rule_id, // Use actual rule_id from API
                                classroomId: lessonSummary.classroom_id,
                                day: lessonSummary.day ?? 0,
                                startSlot: lessonSummary.start_slot ?? 0,
                                endSlot: lessonSummary.end_slot ?? 1,
                                title: lessonSummary.title,
                                instructor: '',
                                instructorId: null,
                                note: '',
                                date: '',
                                startTime: '',
                                endTime: '',
                                status: 'scheduled',
                                substituteInstructorId: null,
                                substituteInstructorName: null,
                                cancelReason: null,
                            };
                            lessonDialogRef.current?.open(scheduleLesson, null, null);
                        } else {
                            toast.error('수업 정보를 찾을 수 없습니다.');
                        }
                    }}
                    onStudentManage={(lessonId) => {
                        setStudentDialogLessonId(lessonId);
                        setStudentDialogOpen(true);
                    }}
                    onRefresh={() => {
                        loadInstructors(debouncedSearch, statusFilter);
                        if (selectedInstructor) {
                            loadExtras(selectedInstructor.id, currentYear, currentMonth);
                        }
                    }}
                />
            </div>

            {/* Dialogs */}
            <InstructorFormDialog
                open={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                onSuccess={() => {
                    loadInstructors(debouncedSearch, statusFilter);
                    setSelectedInstructor(null);
                }}
            />
            {selectedInstructor && (
                <InstructorFormDialog
                    open={isEditDialogOpen}
                    onOpenChange={setIsEditDialogOpen}
                    instructor={selectedInstructor}
                    onSuccess={() => {
                        loadInstructors(debouncedSearch, statusFilter);
                        // Force reload extras if needed? Effect handles it.
                    }}
                />
            )}



            {/* Student Management Dialog (from context menu) */}
            {studentDialogLessonId && (
                <LessonStudentDialog
                    open={studentDialogOpen}
                    onOpenChange={(open) => {
                        setStudentDialogOpen(open);
                        if (!open) setStudentDialogLessonId(null);
                    }}
                    lessonId={studentDialogLessonId}
                    onSuccess={() => {
                        loadInstructors(debouncedSearch, statusFilter);
                        if (selectedInstructor) {
                            loadExtras(selectedInstructor.id, currentYear, currentMonth);
                        }
                    }}
                />
            )}

            {/* Lesson Edit Dialog */}
            <LessonDialog
                ref={lessonDialogRef}
                onSave={() => {
                    emitDataChange('lessons');
                    loadInstructors(debouncedSearch, statusFilter);
                    if (selectedInstructor) {
                        loadExtras(selectedInstructor.id, currentYear, currentMonth);
                    }
                }}
                onDelete={() => {
                    emitDataChange('lessons');
                    loadInstructors(debouncedSearch, statusFilter);
                    if (selectedInstructor) {
                        loadExtras(selectedInstructor.id, currentYear, currentMonth);
                    }
                }}
            />
        </div>
    );
}
