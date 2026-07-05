import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useLessonStore } from '../../stores/lessonStore';
import { useClassroomStore } from '../../stores/classroomStore';
import * as api from '../../core/api';
import { ALL_DAYS, START_MINUTES, SLOT_MINUTES, SLOT_COUNT, LESSON_DRAG_THRESHOLD } from '../../core/constants';
import { timeLabel, clamp } from '../../core/utils/dom';
import { safeSetPointerCapture } from '../../core/utils/pointer';
import { addDays, formatDate, parseDate } from '../../core/utils/date';
import type { ScheduleLesson, SelectionState, GridMetrics } from '../../core/types';
import { emitDataChange } from '../../core/events';
import { Users, Edit, Ban, RefreshCw, UserPlus, Calendar, Plus, MapPin } from 'lucide-react';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu';
import { LessonCancelDialog } from './LessonCancelDialog';
import { SubstituteDialog } from './SubstituteDialog';
import { PeriodCancelDialog } from './PeriodCancelDialog';
import { MakeupDialog } from './MakeupDialog';
import { LessonBlock } from './LessonBlock';

interface TimetableGridProps {
    onLessonClick: (lesson: ScheduleLesson) => void;
    onSelectionComplete: (selection: SelectionState) => void;
    onStudentManage?: (lesson: ScheduleLesson) => void;
}

interface DragState {
    lessonId: number;
    classroomId: number;
    startX: number;
    startY: number;
    initialLeft: number;
    initialTop: number;
    width: number;
    height: number;
    duration: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
    moved: boolean;
    block: HTMLDivElement;
}

interface ResizeState {
    lessonId: number;
    classroomId: number;
    edge: 'start' | 'end';
    startSlot: number;
    endSlot: number;
    day: number;
    initialY: number;
    initialSlot: number;
    previewStart?: number;
    previewEnd?: number;
}
import { getLessonColor } from '../../core/lessonColors';

export function TimetableGrid({ onLessonClick, onSelectionComplete, onStudentManage }: TimetableGridProps) {
    // Stores
    const selectedClassroomId = useClassroomStore((state) => state.selectedId);
    const includeWeekend = useLessonStore((state) => state.includeWeekend);
    const viewMode = useLessonStore((state) => state.viewMode);

    // Select lessons for current classroom
    const lessonsMap = useLessonStore((state) => state.lessons);
    const lessons = useMemo(() => {
        if (!selectedClassroomId) return [];
        return Object.values(lessonsMap).filter(l => l.classroomId === selectedClassroomId);
    }, [lessonsMap, selectedClassroomId]);

    // Helper to check conflicts from store
    const conflicts = useLessonStore((state) => state.conflicts);

    // Interaction State
    const containerRef = useRef<HTMLDivElement>(null);
    const dragState = useRef<DragState | null>(null);
    const resizeState = useRef<ResizeState | null>(null);
    const [ghostBlock, setGhostBlock] = useState<{ style: React.CSSProperties, className: string, lesson?: { id: number, ruleId?: number | null } } | null>(null);
    const [selectionPreview, setSelectionPreview] = useState<{ day: number, start: number, end: number } | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, lesson: ScheduleLesson } | null>(null);

    // Dialog states for Feature 3
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [cancelDialogLesson, setCancelDialogLesson] = useState<ScheduleLesson | null>(null);
    const [substituteDialogOpen, setSubstituteDialogOpen] = useState(false);
    const [substituteDialogLesson, setSubstituteDialogLesson] = useState<ScheduleLesson | null>(null);
    const [periodCancelDialogOpen, setPeriodCancelDialogOpen] = useState(false);
    const [periodCancelDialogLesson, setPeriodCancelDialogLesson] = useState<ScheduleLesson | null>(null);
    const [makeupDialogOpen, setMakeupDialogOpen] = useState(false);
    const [makeupDialogLesson, setMakeupDialogLesson] = useState<ScheduleLesson | null>(null);

    // Constants
    const visibleDays = useMemo(() => includeWeekend ? ALL_DAYS : ALL_DAYS.slice(0, 5), [includeWeekend]);

    // Helper: Conflict Candidate Check (local logic using store state)
    const hasConflictCandidate = (lessonId: number | null, classroomId: number, day: number, startSlot: number, endSlot: number) => {
        const allLessons = useLessonStore.getState().lessons;
        for (const lesson of Object.values(allLessons)) {
            if (lesson.id === lessonId) continue;
            if (lesson.classroomId !== classroomId || lesson.day !== day) continue;
            if (lesson.startSlot < endSlot && lesson.endSlot > startSlot) {
                return true;
            }
        }
        return false;
    };

    // Helpers
    const getGridMetrics = (): GridMetrics | null => {
        if (!containerRef.current) return null;
        const gridRect = containerRef.current.getBoundingClientRect();
        const timeWidth = 90;
        const headerHeight = 44;
        const rowHeight = 36;
        const dayCount = visibleDays.length;

        const firstDayHeader = containerRef.current.querySelector('.cell.header:not(:first-child)');
        let dayWidth = (gridRect.width - timeWidth) / dayCount;
        if (firstDayHeader) {
            dayWidth = firstDayHeader.getBoundingClientRect().width;
        }

        return { gridRect, timeWidth, headerHeight, rowHeight, dayCount, dayWidth };
    };

    const getSlotFromPoint = (x: number, y: number) => {
        const metrics = getGridMetrics();
        if (!metrics) return null;

        const scrollLeft = containerRef.current?.scrollLeft || 0;
        const scrollTop = containerRef.current?.scrollTop || 0;

        const viewportRelX = x - metrics.gridRect.left;
        const viewportRelY = y - metrics.gridRect.top;

        const absoluteX = viewportRelX + scrollLeft;
        const absoluteY = viewportRelY + scrollTop;

        if (absoluteX < metrics.timeWidth) return null;
        if (absoluteY < metrics.headerHeight) return null;

        const dayIndex = clamp(Math.floor((absoluteX - metrics.timeWidth) / metrics.dayWidth), 0, metrics.dayCount - 1);
        const slot = clamp(Math.floor((absoluteY - metrics.headerHeight) / metrics.rowHeight), 0, SLOT_COUNT);

        return { day: visibleDays[dayIndex].index, slot };
    };

    // Drag Logic
    const handlePointerDown = (e: React.PointerEvent, lesson: ScheduleLesson) => {
        if (e.button !== 0 || viewMode !== 'single') return;
        e.stopPropagation();

        const block = e.currentTarget as HTMLDivElement;
        const rect = block.getBoundingClientRect();

        dragState.current = {
            lessonId: lesson.id,
            classroomId: lesson.classroomId,
            startX: e.clientX,
            startY: e.clientY,
            initialLeft: rect.left,
            initialTop: rect.top,
            width: rect.width,
            height: rect.height,
            duration: lesson.endSlot - lesson.startSlot,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            dragging: false,
            moved: false,
            block
        };

        safeSetPointerCapture(block, e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (dragState.current) {
            handleDragMove(e);
        } else if (resizeState.current) {
            handleResizeMove(e);
        }
    };

    const handleDragMove = (e: React.PointerEvent) => {
        const state = dragState.current;
        if (!state) return;

        if (!state.dragging) {
            const deltaX = Math.abs(e.clientX - state.startX);
            const deltaY = Math.abs(e.clientY - state.startY);
            if (Math.hypot(deltaX, deltaY) > LESSON_DRAG_THRESHOLD) {
                state.dragging = true;
                state.block.classList.add('dragging', 'z-50', 'opacity-80', 'shadow-xl');
                state.block.style.position = 'fixed';
                state.block.style.width = `${state.width}px`;
                state.block.style.height = `${state.height}px`;
            } else {
                return;
            }
        }

        state.moved = true;
        state.block.style.left = `${e.clientX - state.offsetX}px`;
        state.block.style.top = `${e.clientY - state.offsetY}px`;

        // Ghost
        const metrics = getGridMetrics();
        if (metrics && containerRef.current) {
            const scrollLeft = containerRef.current.scrollLeft;
            const scrollTop = containerRef.current.scrollTop;

            const relX = e.clientX - metrics.gridRect.left + scrollLeft - state.offsetX;
            const relY = e.clientY - metrics.gridRect.top + scrollTop - state.offsetY;

            const dayIdx = clamp(Math.round((relX - metrics.timeWidth) / metrics.dayWidth), 0, metrics.dayCount - 1);
            const startSlot = clamp(Math.round((relY - metrics.headerHeight) / metrics.rowHeight), 0, SLOT_COUNT - state.duration);

            const day = visibleDays[dayIdx].index;

            setGhostBlock({
                style: {
                    gridColumn: `${dayIdx + 2} / ${dayIdx + 3}`,
                    gridRow: `${startSlot + 2} / ${startSlot + state.duration + 2}`
                },
                className: hasConflictCandidate(state.lessonId, state.classroomId, day, startSlot, startSlot + state.duration) ? 'conflict' : '',
                lesson: lessons.find(l => l.id === state.lessonId)
            });
        }
    };

    const handlePointerUp = async (e: React.PointerEvent) => {
        if (!dragState.current && !resizeState.current) return;

        try {
            if (dragState.current) {
                const state = dragState.current;
                if (state.moved && ghostBlock && containerRef.current) {
                    const metrics = getGridMetrics();
                    if (metrics) {
                        const scrollLeft = containerRef.current.scrollLeft;
                        const scrollTop = containerRef.current.scrollTop;

                        const centerX = e.clientX - state.offsetX;
                        const centerY = e.clientY - state.offsetY;
                        const relX = centerX - metrics.gridRect.left + scrollLeft;
                        const relY = centerY - metrics.gridRect.top + scrollTop;

                        const dayIdx = clamp(Math.round((relX - metrics.timeWidth) / metrics.dayWidth), 0, metrics.dayCount - 1);
                        const startSlot = clamp(Math.round((relY - metrics.headerHeight) / metrics.rowHeight), 0, SLOT_COUNT - state.duration);

                        const day = visibleDays[dayIdx].index;
                        const endSlot = startSlot + state.duration;

                        await updateLessonSchedule(state.lessonId, day, startSlot, endSlot);
                    }
                }

                if (!state.moved) {
                    const l = lessons.find(x => x.id === state.lessonId);
                    if (l) onLessonClick(l);
                }
            } else if (resizeState.current) {
                const state = resizeState.current;
                if (state.previewStart !== undefined && state.previewEnd !== undefined) {
                    await updateLessonSchedule(state.lessonId, state.day, state.previewStart, state.previewEnd);
                }
            }
        } finally {
            if (dragState.current?.block) {
                const block = dragState.current.block;
                block.classList.remove('dragging', 'z-50', 'opacity-80', 'shadow-xl');
                block.style.position = '';
                block.style.left = '';
                block.style.top = '';
                block.style.width = '';
                block.style.height = '';
            }
            dragState.current = null;
            resizeState.current = null;
            setGhostBlock(null);
        }
    };

    const updateLessonSchedule = async (scheduleId: number, day: number, start: number, end: number) => {
        const store = useLessonStore.getState();
        const schedule = store.lessons[scheduleId];
        if (!schedule) return;

        // No change - skip update
        if (schedule.day === day && schedule.startSlot === start && schedule.endSlot === end) {
            return;
        }

        const weekStartStr = store.weekStart;
        if (!weekStartStr) return;
        const weekStart = parseDate(weekStartStr);
        const realDate = addDays(weekStart, day);
        const scheduleDate = formatDate(realDate);

        const startTime = timeLabel(start, START_MINUTES, SLOT_MINUTES);
        const endTime = timeLabel(end, START_MINUTES, SLOT_MINUTES);

        try {
            if (schedule.ruleId) {
                // Update the rule for recurring lessons
                const originalDate = schedule.date || scheduleDate;
                const effectiveDate = scheduleDate < originalDate ? scheduleDate : originalDate;

                const result = await api.updateLessonRule({
                    ruleId: schedule.ruleId,
                    day,
                    startSlot: start,
                    endSlot: end,
                    effectiveFromDate: effectiveDate
                });
                if (!result.success) {
                    toast.error('일정 업데이트에 실패했습니다: ' + result.error.message);
                    return;
                }
            } else if (scheduleId < 0) {
                // Virtual schedule (negative ID) - create a new schedule
                const result = await api.createSchedule({
                    lesson_id: schedule.lessonId,
                    date: scheduleDate,
                    start_time: startTime,
                    end_time: endTime,
                    notes: schedule.note
                });
                if (!result.success) {
                    toast.error('일정 생성에 실패했습니다: ' + result.error.message);
                    return;
                }
            } else {
                // Existing schedule - update it
                const result = await api.updateSchedule({
                    id: scheduleId,
                    date: scheduleDate,
                    start_time: startTime,
                    end_time: endTime,
                    notes: schedule.note
                });
                if (!result.success) {
                    toast.error('일정 업데이트에 실패했습니다: ' + result.error.message);
                    return;
                }
            }

            // Refresh lessons to reflect the change
            emitDataChange('lessons');
        } catch (e) {
            console.error(e);
            toast.error('일정 업데이트에 실패했습니다.');
        }
    };

    // Resize Logic
    const handleResizeStart = (e: React.PointerEvent, lesson: ScheduleLesson, edge: 'start' | 'end') => {
        e.stopPropagation();
        e.preventDefault();

        const dayIdx = visibleDays.findIndex(d => d.index === lesson.day);
        if (dayIdx === -1) return;

        resizeState.current = {
            lessonId: lesson.id,
            classroomId: lesson.classroomId,
            edge,
            startSlot: lesson.startSlot,
            endSlot: lesson.endSlot,
            day: lesson.day,
            initialY: e.clientY,
            initialSlot: edge === 'start' ? lesson.startSlot : lesson.endSlot
        };

        safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
    };

    const handleResizeMove = (e: React.PointerEvent) => {
        const state = resizeState.current;
        if (!state) return;

        const metrics = getGridMetrics();
        if (!metrics || !containerRef.current) return;

        // Calculate slot delta based on mouse movement from initial position
        const deltaY = e.clientY - state.initialY;
        const slotDelta = Math.round(deltaY / metrics.rowHeight);
        const targetSlot = state.initialSlot + slotDelta;

        let newStart = state.startSlot;
        let newEnd = state.endSlot;

        if (state.edge === 'start') {
            newStart = clamp(targetSlot, 0, state.endSlot - 1);
        } else {
            newEnd = clamp(targetSlot, state.startSlot + 1, SLOT_COUNT);
        }

        state.previewStart = newStart;
        state.previewEnd = newEnd;

        const dayIdx = visibleDays.findIndex(d => d.index === state.day);
        setGhostBlock({
            style: {
                gridColumn: `${dayIdx + 2} / ${dayIdx + 3}`,
                gridRow: `${newStart + 2} / ${newEnd + 2}`
            },
            className: 'resizing',
            lesson: lessons.find(l => l.id === state.lessonId)
        });
    };

    // Selection Logic
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionStart = useRef<{ day: number, slot: number } | null>(null);

    const handleGridPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0 || !selectedClassroomId || viewMode !== 'single') return;
        if ((e.target as HTMLElement).closest('.timetable-block')) return;
        // Prevent selection when any dialog or context menu is open
        if (cancelDialogOpen || substituteDialogOpen || periodCancelDialogOpen || makeupDialogOpen || contextMenu) return;

        const hit = getSlotFromPoint(e.clientX, e.clientY);
        if (!hit) return;

        setIsSelecting(true);
        selectionStart.current = hit;
        setSelectionPreview({ day: hit.day, start: hit.slot, end: hit.slot + 1 });

        safeSetPointerCapture(e.currentTarget as HTMLElement, e.pointerId);
    };

    const handleGridPointerMove = (e: React.PointerEvent) => {
        if (dragState.current || resizeState.current) {
            handlePointerMove(e);
            return;
        }

        if (!isSelecting || !selectionStart.current) return;

        const hit = getSlotFromPoint(e.clientX, e.clientY);
        if (!hit) return;

        if (hit.day !== selectionStart.current.day) return;

        const start = Math.min(selectionStart.current.slot, hit.slot);
        const end = Math.max(selectionStart.current.slot, hit.slot) + 1;

        setSelectionPreview({ day: hit.day, start, end });
    };

    const handleGridPointerUp = (e: React.PointerEvent) => {
        if (dragState.current || resizeState.current) {
            handlePointerUp(e);
            return;
        }

        if (isSelecting && selectionPreview) {
            onSelectionComplete({
                day: selectionPreview.day,
                startSlot: selectionPreview.start,
                endSlot: selectionPreview.end
            });
            setIsSelecting(false);
            setSelectionPreview(null);
            selectionStart.current = null;
        }
    };

    // Context menu handlers
    const handleContextMenu = (e: React.MouseEvent, lesson: ScheduleLesson) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, lesson });
    };

    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    // Feature 3: 휴강 처리 핸들러
    const handleCancelClick = (lesson: ScheduleLesson) => {
        closeContextMenu();
        setCancelDialogLesson(lesson);
        setCancelDialogOpen(true);
    };

    // Feature 3: 대타 설정 핸들러
    const handleSubstituteClick = (lesson: ScheduleLesson) => {
        closeContextMenu();
        setSubstituteDialogLesson(lesson);
        setSubstituteDialogOpen(true);
    };

    // Feature 3: 휴강 복원 핸들러
    const handleRestoreClick = async (lesson: ScheduleLesson) => {
        closeContextMenu();
        const result = await api.restoreSchedule(lesson.id);
        if (result.success) {
            toast.success('수업이 복원되었습니다.');
            emitDataChange('lessons');
        } else {
            console.error('Failed to restore schedule:', result.error);
            toast.error('복원에 실패했습니다: ' + result.error.message);
        }
    };

    // Feature 3: 대타 해제 핸들러
    const handleClearSubstituteClick = async (lesson: ScheduleLesson) => {
        closeContextMenu();
        const result = await api.clearSubstituteInstructor(lesson.id);
        if (result.success) {
            toast.success('대타가 해제되었습니다.');
            emitDataChange('lessons');
        } else {
            console.error('Failed to clear substitute:', result.error);
            toast.error('대타 해제에 실패했습니다: ' + result.error.message);
        }
    };

    // Feature 3: 기간 휴강 핸들러
    const handlePeriodCancelClick = (lesson: ScheduleLesson) => {
        closeContextMenu();
        setPeriodCancelDialogLesson(lesson);
        setPeriodCancelDialogOpen(true);
    };

    // Feature 3: 보강 추가 핸들러
    const handleMakeupClick = (lesson: ScheduleLesson) => {
        closeContextMenu();
        setMakeupDialogLesson(lesson);
        setMakeupDialogOpen(true);
    };

    // Show empty state when no classroom is selected
    if (!selectedClassroomId || viewMode !== 'single') {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
                <MapPin className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">강의실을 선택하세요</p>
                <p className="text-sm text-center mt-1">
                    도면에서 강의실을 클릭하거나<br />강의실별 탭에서 선택할 수 있습니다.
                </p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="timetable-grid-container relative h-full w-full select-none overflow-auto bg-white"
            style={{
                display: 'grid',
                gridTemplateColumns: `90px repeat(${visibleDays.length}, minmax(120px, 1fr))`,
                gridTemplateRows: `44px repeat(${SLOT_COUNT}, 36px)`,
            }}
            onPointerDown={handleGridPointerDown}
            onPointerMove={handleGridPointerMove}
            onPointerUp={handleGridPointerUp}
        >
            {/* 09:00 label in header row */}
            <div
                className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-r border-gray-200 relative"
                style={{ gridColumn: 1, gridRow: 1 }}
            >
                <span
                    className="absolute text-sm font-semibold text-gray-800 bg-gray-50 px-1"
                    style={{
                        bottom: '-0.6em',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 31,
                    }}
                >
                    {timeLabel(0, START_MINUTES, SLOT_MINUTES)}
                </span>
            </div >

            {
                visibleDays.map((day, i) => (
                    <div
                        key={day.index}
                        className="sticky top-0 z-20 bg-gray-50 font-semibold text-base text-gray-800 flex items-center justify-center border-b border-gray-200"
                        style={{ gridColumn: i + 2, gridRow: 1 }}
                    >
                        {day.label}
                    </div>
                ))
            }

            {/* 09:00 separator line - 요일 헤더 바로 아래 */}
            <div
                className="pointer-events-none z-10"
                style={{
                    gridColumn: `2 / -1`,
                    gridRow: 2,
                    height: '1px',
                    marginTop: '-0.5px',
                    background: '#9ca3af',
                }}
            />

            {/* Time Labels - 정시(00분)만 표시, 선과 나란히 (정시 슬롯 상단에 배치) */}
            {
                Array.from({ length: SLOT_COUNT }).map((_, i) => {
                    const isHourStart = i % 2 === 0 && i > 0; // 10:00부터 표시 (09:00은 헤더에)
                    return (
                        <div
                            key={i}
                            className="sticky left-0 z-20 border-r border-gray-200 bg-white relative"
                            style={{ gridColumn: 1, gridRow: i + 2 }}
                        >
                            {isHourStart && (
                                <span
                                    className="absolute text-sm font-semibold text-gray-800 bg-white px-1"
                                    style={{
                                        top: '-0.6em',
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                    }}
                                >
                                    {timeLabel(i, START_MINUTES, SLOT_MINUTES)}
                                </span>
                            )}
                        </div>
                    );
                })
            }

            {/* Hour separator lines - 1시간 단위 구분선 (10:00부터), 시간 라벨 오른쪽부터 시작 */}
            {
                Array.from({ length: Math.floor(SLOT_COUNT / 2) }).map((_, hourIdx) => {
                    const slotIdx = (hourIdx + 1) * 2; // 2, 4, 6, ... (10:00, 11:00, ...)
                    if (slotIdx > SLOT_COUNT) return null;
                    return (
                        <div
                            key={`hour-line-${hourIdx}`}
                            className="pointer-events-none z-10"
                            style={{
                                gridColumn: `2 / -1`,
                                gridRow: slotIdx + 2,
                                height: '1px',
                                marginTop: '-0.5px',
                                background: '#9ca3af',
                            }}
                        />
                    );
                })
            }

            {/* Content Cells - 배경만, border 없음 */}
            {
                Array.from({ length: SLOT_COUNT }).map((_, r) => {
                    return visibleDays.map((d, c) => (
                        <div
                            key={`${d.index}-${r}`}
                            className={cn(
                                "box-border bg-white",
                                selectionPreview && selectionPreview.day === d.index && r >= selectionPreview.start && r < selectionPreview.end
                                    ? "bg-emerald-100/60"
                                    : ""
                            )}
                            style={{ gridColumn: c + 2, gridRow: r + 2 }}
                        />
                    ));
                })
            }

            {/* Day separator lines - 요일 구분 연한 점선 세로선 (Content Cells 위에 표시) */}
            {
                visibleDays.slice(1).map((_, i) => (
                    <div
                        key={`day-sep-${i}`}
                        className="pointer-events-none"
                        style={{
                            gridColumn: i + 3,
                            gridRow: `2 / -1`,
                            width: '0px',
                            borderLeft: '1px dashed #9ca3af',
                            zIndex: 5,
                        }}
                    />
                ))
            }

            {/* Lessons - Memoized for performance */}
            {
                lessons.map(lesson => {
                    const dayIdx = visibleDays.findIndex(d => d.index === lesson.day);
                    if (dayIdx === -1) return null;
                    const conflict = !!conflicts[lesson.id];

                    return (
                        <LessonBlock
                            key={lesson.id}
                            lesson={lesson}
                            dayIdx={dayIdx}
                            conflict={conflict}
                            onPointerDown={handlePointerDown}
                            onContextMenu={handleContextMenu}
                            onResizeStart={handleResizeStart}
                        />
                    );
                })
            }

            {/* Ghost block for drag/resize preview */}
            {
                ghostBlock && (
                    <div
                        className={cn(
                            "timetable-block m-1 rounded-md border-2 border-dashed z-30 pointer-events-none opacity-60",
                            ghostBlock.className.includes('conflict')
                                ? "border-red-400 bg-red-200"
                                : ghostBlock.lesson
                                    ? `${getLessonColor(ghostBlock.lesson).bg} border-current`
                                    : "border-emerald-400 bg-emerald-100"
                        )}
                        style={ghostBlock.style}
                    />
                )
            }

            {/* Context Menu */}
            <ContextMenu
                open={!!contextMenu}
                x={contextMenu?.x ?? 0}
                y={contextMenu?.y ?? 0}
                onClose={closeContextMenu}
            >
                {onStudentManage && contextMenu && (
                    <ContextMenuItem
                        icon={<Users className="w-4 h-4" />}
                        label="학생 관리"
                        onClick={() => {
                            const lesson = contextMenu.lesson;
                            closeContextMenu();
                            onStudentManage(lesson);
                        }}
                    />
                )}
                {onStudentManage && <ContextMenuSeparator />}
                {contextMenu && (
                    <ContextMenuItem
                        icon={<Edit className="w-4 h-4" />}
                        label="수업 편집"
                        onClick={() => {
                            const lesson = contextMenu.lesson;
                            closeContextMenu();
                            onLessonClick(lesson);
                        }}
                    />
                )}
                <ContextMenuSeparator />
                {/* Feature 3: 휴강/대타/복원 메뉴 */}
                {contextMenu && contextMenu.lesson.status !== 'cancelled' && !contextMenu.lesson.substituteInstructorId && (
                    <ContextMenuItem
                        icon={<Ban className="w-4 h-4" />}
                        label="휴강 처리"
                        onClick={() => handleCancelClick(contextMenu.lesson)}
                    />
                )}
                {/* 대타 설정된 수업은 휴강 처리 불가 - 대타 해제 후 휴강 처리 가능 */}
                {contextMenu && contextMenu.lesson.status !== 'cancelled' && contextMenu.lesson.substituteInstructorId && (
                    <ContextMenuItem
                        icon={<Ban className="w-4 h-4 opacity-40" />}
                        label="휴강 처리 (대타 해제 필요)"
                        disabled
                        onClick={() => { }}
                    />
                )}
                {contextMenu && contextMenu.lesson.status === 'cancelled' && (
                    <ContextMenuItem
                        icon={<RefreshCw className="w-4 h-4" />}
                        label="휴강 복원"
                        onClick={() => handleRestoreClick(contextMenu.lesson)}
                    />
                )}
                {contextMenu && contextMenu.lesson.status !== 'cancelled' && !contextMenu.lesson.substituteInstructorId && (
                    <ContextMenuItem
                        icon={<UserPlus className="w-4 h-4" />}
                        label="대타 강사 설정"
                        onClick={() => handleSubstituteClick(contextMenu.lesson)}
                    />
                )}
                {contextMenu && contextMenu.lesson.substituteInstructorId && (
                    <ContextMenuItem
                        icon={<RefreshCw className="w-4 h-4" />}
                        label="대타 해제"
                        onClick={() => handleClearSubstituteClick(contextMenu.lesson)}
                    />
                )}
                {/* 기간 휴강 (정상 수업에서만 표시) */}
                {contextMenu && contextMenu.lesson.status !== 'cancelled' && contextMenu.lesson.ruleId && (
                    <ContextMenuItem
                        icon={<Calendar className="w-4 h-4" />}
                        label="기간 휴강"
                        onClick={() => handlePeriodCancelClick(contextMenu.lesson)}
                    />
                )}
                {/* 보강 추가 (휴강된 수업에서만 표시) */}
                {contextMenu && contextMenu.lesson.status === 'cancelled' && (
                    <ContextMenuItem
                        icon={<Plus className="w-4 h-4" />}
                        label="보강 수업 추가"
                        onClick={() => handleMakeupClick(contextMenu.lesson)}
                    />
                )}
            </ContextMenu>

            {/* Feature 3: 휴강 다이얼로그 */}
            {
                cancelDialogLesson && (
                    <LessonCancelDialog
                        open={cancelDialogOpen}
                        onOpenChange={setCancelDialogOpen}
                        scheduleId={cancelDialogLesson.id}
                        lessonId={cancelDialogLesson.lessonId}
                        lessonTitle={cancelDialogLesson.title}
                        date={cancelDialogLesson.date || ''}
                        startTime={cancelDialogLesson.startTime}
                        endTime={cancelDialogLesson.endTime}
                        onSuccess={() => emitDataChange('lessons')}
                    />
                )
            }

            {/* Feature 3: 대타 설정 다이얼로그 */}
            {
                substituteDialogLesson && (
                    <SubstituteDialog
                        open={substituteDialogOpen}
                        onOpenChange={setSubstituteDialogOpen}
                        scheduleId={substituteDialogLesson.id}
                        lessonId={substituteDialogLesson.lessonId}
                        lessonTitle={substituteDialogLesson.title}
                        date={substituteDialogLesson.date || ''}
                        startTime={substituteDialogLesson.startTime}
                        endTime={substituteDialogLesson.endTime}
                        currentInstructor={substituteDialogLesson.instructor}
                        currentInstructorId={substituteDialogLesson.instructorId}
                        onSuccess={() => emitDataChange('lessons')}
                    />
                )
            }

            {/* Feature 3: 기간 휴강 다이얼로그 */}
            {
                periodCancelDialogLesson && (
                    <PeriodCancelDialog
                        open={periodCancelDialogOpen}
                        onOpenChange={setPeriodCancelDialogOpen}
                        lessonId={periodCancelDialogLesson.lessonId}
                        lessonTitle={periodCancelDialogLesson.title}
                        instructor={periodCancelDialogLesson.instructor}
                        dayOfWeek={ALL_DAYS.find(d => d.index === periodCancelDialogLesson.day)?.label || ''}
                        onSuccess={() => emitDataChange('lessons')}
                    />
                )
            }

            {/* Feature 3: 보강 추가 다이얼로그 */}
            {
                makeupDialogLesson && (
                    <MakeupDialog
                        open={makeupDialogOpen}
                        onOpenChange={setMakeupDialogOpen}
                        originalScheduleId={makeupDialogLesson.id}
                        lessonTitle={makeupDialogLesson.title}
                        originalDate={makeupDialogLesson.date || ''}
                        originalStartTime={`${String(Math.floor((makeupDialogLesson.startSlot * 30 + 480) / 60)).padStart(2, '0')}:${String((makeupDialogLesson.startSlot * 30 + 480) % 60).padStart(2, '0')}`}
                        originalEndTime={`${String(Math.floor((makeupDialogLesson.endSlot * 30 + 480) / 60)).padStart(2, '0')}:${String((makeupDialogLesson.endSlot * 30 + 480) % 60).padStart(2, '0')}`}
                        originalClassroomId={makeupDialogLesson.classroomId}
                        originalInstructorId={makeupDialogLesson.instructorId || 0}
                        originalInstructor={makeupDialogLesson.instructor}
                        onSuccess={() => emitDataChange('lessons')}
                    />
                )
            }
        </div >
    );
}

