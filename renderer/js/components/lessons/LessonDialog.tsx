import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toast } from 'sonner';

import { useLessonStore } from '../../stores/lessonStore';
import { useClassroomStore } from '../../stores/classroomStore';
import * as api from '../../core/api';
import { emitDataChange } from '../../core/events';
import { timeLabel } from '../../core/utils/dom';
import { addDays, formatDate, parseDate } from '../../core/utils/date';
import { ALL_DAYS, START_MINUTES, SLOT_MINUTES, SLOT_COUNT } from '../../core/constants';
import type { ScheduleLesson, SelectionState } from '../../core/types';

interface Instructor {
    id: number;
    name: string;
    status: string;
}

interface LessonDialogProps {
    onSave?: () => void;
    onDelete?: () => void;
}

export interface LessonDialogRef {
    open: (lesson: ScheduleLesson | null, selection: SelectionState | null, classroomId: number | null, preSelectedInstructorId?: number) => void;
    close: () => void;
}

export const LessonDialog = forwardRef<LessonDialogRef, LessonDialogProps>(({ onSave, onDelete }, ref) => {
    // Store access
    const includeWeekend = useLessonStore((state) => state.includeWeekend);
    const weekStartStr = useLessonStore((state) => state.weekStart);
    const setIncludeWeekend = useLessonStore((state) => state.setIncludeWeekend);
    const classrooms = useClassroomStore((state) => state.classrooms);

    const [open, setOpen] = useState(false);
    const [instructors, setInstructors] = useState<Instructor[]>([]);

    // Form State
    const [title, setTitle] = useState('');
    const [instructorId, setInstructorId] = useState<string>('');
    const [day, setDay] = useState<string>('0');
    const [startSlot, setStartSlot] = useState<string>('0');
    const [endSlot, setEndSlot] = useState<string>('1');
    const [note, setNote] = useState('');
    const [isRegular, setIsRegular] = useState(true);

    // Edit Context State
    const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
    const [editingLessonId, setEditingLessonId] = useState<number | null>(null);
    const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
    const [editingClassroomId, setEditingClassroomId] = useState<number | null>(null);
    const [editingScheduleDate, setEditingScheduleDate] = useState<string | null>(null);

    // Locked instructor (when opened from instructor detail panel)
    const [lockedInstructorId, setLockedInstructorId] = useState<number | null>(null);

    // Delete Confirm Dialog State
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    // Calculated State
    const [dateLabel, setDateLabel] = useState('');

    useImperativeHandle(ref, () => ({
        open: (lesson, selection, classroomId, preSelectedInstructorId) => {
            handleOpen(lesson, selection, classroomId, preSelectedInstructorId);
        },
        close: () => setOpen(false)
    }));

    useEffect(() => {
        if (open) {
            loadInstructors();
        }
    }, [open]);

    useEffect(() => {
        updateScheduleDateLabel(Number(day));
    }, [day]);

    const loadInstructors = async () => {
        const windowApi = (window as any).api;
        const result = await windowApi.instructors.list({ status: 'active' });
        if (result.success) {
            setInstructors(result.data);
        } else {
            console.error('Failed to load instructors:', result.error);
            toast.error('강사 목록을 불러오지 못했습니다.');
        }
    };

    const getVisibleDays = () => {
        return includeWeekend ? ALL_DAYS : ALL_DAYS.slice(0, 5);
    };

    const getScheduleDate = (dayIndex: number) => {
        if (!weekStartStr) return '';
        const weekStart = parseDate(weekStartStr);
        const targetDate = addDays(weekStart, dayIndex);
        return formatDate(targetDate);
    };

    const updateScheduleDateLabel = (dayIndex: number) => {
        setDateLabel(getScheduleDate(dayIndex));
    };

    const handleOpen = async (lesson: ScheduleLesson | null, selection: SelectionState | null, classroomId: number | null, preSelectedInstructorId?: number) => {
        // Weekend check
        if (lesson && lesson.day >= 5 && !useLessonStore.getState().includeWeekend) {
            setIncludeWeekend(true);
        }

        // We need to re-evaluate visible days if state changed?
        // React state update might not flush immediately, but 'setIncludeWeekend' updates store.
        // Components re-render.
        // But logic below relies on state.
        // For 'handleOpen', we can just use store state or simple check.
        // But for 'setDay(defaultDay)', we need to know what days are visible.
        // If we just set weekend=true, effectively we should consider all days.

        const effectiveIncludeWeekend = (lesson && lesson.day >= 5) || useLessonStore.getState().includeWeekend;
        const visibleDays = effectiveIncludeWeekend ? ALL_DAYS : ALL_DAYS.slice(0, 5);
        const defaultDay = visibleDays[0]?.index ?? 0;

        await loadInstructors();

        if (lesson) {
            // Edit Mode
            setEditingScheduleId(lesson.id);
            setEditingLessonId(lesson.lessonId);
            setEditingRuleId(lesson.ruleId ?? null);
            setEditingClassroomId(lesson.classroomId);
            setEditingScheduleDate(lesson.date || getScheduleDate(lesson.day));

            setTitle(lesson.title);
            setInstructorId(lesson.instructorId ? String(lesson.instructorId) : '');
            setDay(String(lesson.day));
            setStartSlot(String(lesson.startSlot));
            setEndSlot(String(lesson.endSlot));
            setNote(lesson.note || '');
            setIsRegular(!!lesson.ruleId);

            updateScheduleDateLabel(lesson.day);
        } else if (selection) {
            // Create from Selection
            resetState();
            setEditingClassroomId(classroomId);

            // Handle pre-selected instructor
            if (preSelectedInstructorId) {
                setInstructorId(String(preSelectedInstructorId));
                setLockedInstructorId(preSelectedInstructorId);
            }

            setDay(String(selection.day));
            setStartSlot(String(selection.startSlot));
            setEndSlot(String(selection.endSlot));
            setIsRegular(true);

            updateScheduleDateLabel(selection.day);
        } else {
            // Create Empty
            resetState();
            setEditingClassroomId(classroomId);

            // Handle pre-selected instructor
            if (preSelectedInstructorId) {
                setInstructorId(String(preSelectedInstructorId));
                setLockedInstructorId(preSelectedInstructorId);
            }

            setDay(String(defaultDay));
            setStartSlot('0');
            setEndSlot('1');
            setIsRegular(true);

            updateScheduleDateLabel(defaultDay);
        }

        setOpen(true);
    };

    const resetState = () => {
        setEditingScheduleId(null);
        setEditingLessonId(null);
        setEditingRuleId(null);
        setEditingClassroomId(null);
        setEditingScheduleDate(null);
        setLockedInstructorId(null);

        setTitle('');
        setInstructorId('');
        setNote('');
    };

    const handleSave = async () => {
        // For new lessons, require classroom selection
        if (!editingLessonId && !editingClassroomId) {
            toast.error('강의실을 먼저 선택해주세요.');
            return;
        }

        const start = Number(startSlot);
        const end = Number(endSlot);

        if (end <= start) {
            toast.error('종료 시간은 시작 시간보다 이후여야 합니다.');
            return;
        }

        const selectedInstructor = instructors.find(i => i.id === Number(instructorId));
        const instructorName = selectedInstructor
            ? selectedInstructor.name || ''
            : '';

        const payload = {
            id: editingLessonId ?? undefined,
            classroomId: editingClassroomId ?? 0,
            day: Number(day),
            startSlot: start,
            endSlot: end,
            title: title.trim() || '수업',
            instructor: instructorName,
            instructorId: instructorId ? Number(instructorId) : null,
            note: note.trim(),
        };

        const scheduleDate = getScheduleDate(payload.day);
        const startTimeStr = timeLabel(payload.startSlot, START_MINUTES, SLOT_MINUTES);
        const endTimeStr = timeLabel(payload.endSlot, START_MINUTES, SLOT_MINUTES);


        if (editingLessonId) {
            // Update existing lesson
            const updateResult = await api.updateLesson(payload);
            if (!updateResult.success) {
                toast.error('저장에 실패했습니다: ' + updateResult.error.message);
                return;
            }

            if (editingRuleId) {
                // Update rule for regular lessons
                const effectiveFromDate = editingScheduleDate
                    ? (editingScheduleDate < scheduleDate ? editingScheduleDate : scheduleDate)
                    : scheduleDate;

                const ruleResult = await api.updateLessonRule({
                    ruleId: editingRuleId,
                    day: payload.day,
                    startSlot: payload.startSlot,
                    endSlot: payload.endSlot,
                    effectiveFromDate,
                });
                if (!ruleResult.success) {
                    toast.error('규칙 업데이트 실패: ' + ruleResult.error.message);
                    return;
                }
            } else if (editingScheduleId) {
                // Update specific schedule instance (non-regular lessons)
                const scheduleResult = await api.updateSchedule({
                    id: editingScheduleId,
                    date: scheduleDate,
                    start_time: startTimeStr,
                    end_time: endTimeStr,
                    notes: payload.note,
                });
                if (!scheduleResult.success) {
                    toast.error('스케줄 업데이트 실패: ' + scheduleResult.error.message);
                    return;
                }
            }
            // If neither ruleId nor scheduleId, just lesson update is sufficient
        } else {
            // Create
            const createResult = await api.createLesson({
                ...payload,
                isRegular,
                scheduleDate,
                startDate: isRegular ? scheduleDate : undefined,
            });
            if (!createResult.success) {
                toast.error('저장에 실패했습니다: ' + createResult.error.message);
                return;
            }
        }

        emitDataChange('lessons');
        setOpen(false);
        onSave?.();
        toast.success('저장되었습니다.');
    };

    const handleDelete = async () => {
        if (!editingLessonId) return;
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = async () => {
        if (!editingLessonId) return;
        const result = await api.deleteLesson(editingLessonId);
        if (result.success) {
            emitDataChange('lessons');
            setOpen(false);
            onDelete?.();
            toast.success('삭제되었습니다.');
        } else {
            console.error('Delete failed:', result.error);
            toast.error('삭제에 실패했습니다: ' + result.error.message);
        }
    };

    const slotOptions = [];
    for (let i = 0; i <= SLOT_COUNT; i++) {
        slotOptions.push({
            value: String(i),
            label: timeLabel(i, START_MINUTES, SLOT_MINUTES)
        });
    }

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{editingLessonId ? '수업 수정' : '새 수업 등록'}</DialogTitle>
                        <DialogDescription>
                            {editingClassroomId && classrooms[editingClassroomId]
                                ? `강의실: ${classrooms[editingClassroomId].name}`
                                : '수업 정보를 입력하세요.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="title" className="text-right">수업명</Label>
                            <Input
                                id="title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="col-span-3"
                                placeholder="수업명 입력"
                            />
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="instructor" className="text-right">강사</Label>
                            <Select value={instructorId} onValueChange={setInstructorId} disabled={!!lockedInstructorId}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="강사 선택 (선택사항)" />
                                </SelectTrigger>
                                <SelectContent>
                                    {instructors.map(inst => (
                                        <SelectItem key={inst.id} value={String(inst.id)}>
                                            {inst.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="day" className="text-right">요일</Label>
                            <div className="col-span-3 flex items-center gap-2">
                                <Select value={day} onValueChange={setDay}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {getVisibleDays().map(d => (
                                            <SelectItem key={d.index} value={String(d.index)}>{d.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground w-32 shrink-0 text-right">{dateLabel}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">시간</Label>
                            <div className="col-span-3 flex items-center gap-2">
                                <Select value={startSlot} onValueChange={setStartSlot}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {slotOptions.map(opt => (
                                            <SelectItem key={`start-${opt.value}`} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span>~</span>
                                <Select value={endSlot} onValueChange={setEndSlot}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {slotOptions.map(opt => (
                                            <SelectItem key={`end-${opt.value}`} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="regular" className="text-right">정규 수업</Label>
                            <div className="col-span-3 flex items-center space-x-2">
                                <Switch
                                    id="regular"
                                    checked={isRegular}
                                    onCheckedChange={setIsRegular}
                                    disabled={!!editingLessonId && !!editingRuleId} // Regular lesson editing keeps it regular
                                />
                                <Label htmlFor="regular" className="text-sm text-muted-foreground">
                                    {isRegular ? '매주 반복됩니다.' : '이 날짜에만 적용됩니다.'}
                                </Label>
                            </div>
                        </div>

                        <div className="grid grid-cols-4 items-start gap-4">
                            <Label htmlFor="note" className="text-right mt-2">비고</Label>
                            <Textarea
                                id="note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                    </div>

                    <DialogFooter className="flex justify-between sm:justify-between">
                        {editingLessonId ? (
                            <Button variant="destructive" onClick={handleDelete}>삭제</Button>
                        ) : <div></div>}
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
                            <Button onClick={handleSave}>저장</Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirm Dialog */}
            <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title="수업 삭제"
                description="이 수업을 삭제하시겠습니까? 관련된 스케줄도 함께 삭제됩니다."
                confirmLabel="삭제"
                variant="destructive"
                onConfirm={confirmDelete}
            />
        </>
    );
});

LessonDialog.displayName = "LessonDialog";
