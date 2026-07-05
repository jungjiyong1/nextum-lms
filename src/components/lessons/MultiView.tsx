import React, { useState, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useLessonStore } from '../../stores/lessonStore';
import { useClassroomStore } from '../../stores/classroomStore';
import { ALL_DAYS, SLOT_COUNT } from '../../core/constants';
import { cn } from '../../lib/utils';
import { getLessonColor } from '../../core/lessonColors';
import type { ScheduleLesson, Classroom } from '../../core/types';

interface MultiViewProps {
    onClassroomClick: (id: number) => void;
    onLessonClick: (lesson: ScheduleLesson) => void;
}

export interface MultiViewRef {
    setSearchQuery: (query: string) => void;
    refresh: () => void;
}

export const MultiView = forwardRef<MultiViewRef, MultiViewProps>(({ onClassroomClick, onLessonClick }, ref) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [, setForceUpdate] = useState(0);

    const classrooms = useClassroomStore((state) => state.classrooms);
    const lessonsMap = useLessonStore((state) => state.lessons);
    const conflicts = useLessonStore((state) => state.conflicts);
    const includeWeekend = useLessonStore((state) => state.includeWeekend);
    const selectedId = useClassroomStore((state) => state.selectedId);

    useImperativeHandle(ref, () => ({
        setSearchQuery: (query: string) => {
            setSearchQuery(query);
        },
        refresh: () => {
            setForceUpdate(prev => prev + 1);
        }
    }));

    const visibleDays = includeWeekend ? ALL_DAYS : ALL_DAYS.slice(0, 5);

    // Group lessons by classroom
    const lessonsByClassroom = useMemo(() => {
        const map = new Map<number, ScheduleLesson[]>();
        Object.values(lessonsMap).forEach((lesson) => {
            if (!map.has(lesson.classroomId)) {
                map.set(lesson.classroomId, []);
            }
            map.get(lesson.classroomId)?.push(lesson);
        });
        return map;
    }, [lessonsMap]);

    const filteredClassrooms = useMemo(() => {
        const query = searchQuery.toLowerCase();
        return Object.values(classrooms).filter((room: Classroom) => {
            const name = room.name ? room.name.trim() : `강의실 ${room.id}`;
            return name.toLowerCase().includes(query);
        });
    }, [classrooms, searchQuery]);

    const getDisplayName = (room: Classroom) => {
        return room.name && room.name.trim() ? room.name.trim() : `강의실 ${room.id}`;
    };

    const MINI_SLOT_HEIGHT = 6;

    return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,400px))] gap-4 p-4">
            {filteredClassrooms.map(room => {
                const roomLessons = lessonsByClassroom.get(room.id) || [];
                const roomConflicts = roomLessons.filter(l => !!conflicts[l.id]).length;
                const isSelected = room.id === selectedId;

                return (
                    <div
                        key={room.id}
                        className={cn(
                            "rounded-2xl border bg-white p-3 shadow-lg cursor-pointer transition-all flex flex-col gap-2.5",
                            "hover:-translate-y-0.5 hover:shadow-xl",
                            isSelected && "border-emerald-500 ring-2 ring-emerald-100"
                        )}
                        onClick={() => onClassroomClick(room.id)}
                    >
                        {/* Card Header */}
                        <div className="flex justify-between items-center gap-2">
                            <div className={cn(
                                "font-bold text-sm text-gray-900",
                                isSelected && "text-emerald-600"
                            )}>
                                {getDisplayName(room)}
                            </div>
                            <div className="text-xs text-gray-500 flex items-center gap-1.5">
                                {roomLessons.length}개 수업
                                {roomConflicts > 0 && (
                                    <span className="text-[10px] text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                                        충돌 {roomConflicts}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Mini Timetable */}
                        <div className="border rounded-xl overflow-hidden bg-white">
                            {/* Mini Header */}
                            <div
                                className="grid text-[11px] font-semibold text-gray-800 bg-gray-50 border-b border-gray-200"
                                style={{ gridTemplateColumns: `repeat(${visibleDays.length}, 1fr)` }}
                            >
                                {visibleDays.map(day => (
                                    <div key={day.index} className="text-center py-1">{day.label}</div>
                                ))}
                            </div>

                            {/* Mini Body */}
                            <div
                                className="relative bg-white"
                                style={{
                                    height: `${SLOT_COUNT * MINI_SLOT_HEIGHT}px`,
                                    background: `
                                        repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0, rgba(0,0,0,0.03) 1px, transparent 1px, transparent ${MINI_SLOT_HEIGHT}px),
                                        repeating-linear-gradient(90deg, rgba(0,0,0,0.03) 0, rgba(0,0,0,0.03) 1px, transparent 1px, transparent calc(100%/${visibleDays.length}))
                                    `
                                }}
                            >
                                {/* Mini Blocks */}
                                <div
                                    className="absolute inset-0 grid pointer-events-none"
                                    style={{
                                        gridTemplateColumns: `repeat(${visibleDays.length}, 1fr)`,
                                        gridTemplateRows: `repeat(${SLOT_COUNT}, ${MINI_SLOT_HEIGHT}px)`
                                    }}
                                >
                                    {roomLessons.map(lesson => {
                                        const dayIndex = visibleDays.findIndex(d => d.index === lesson.day);
                                        if (dayIndex === -1) return null;

                                        const hasConflict = !!conflicts[lesson.id];
                                        const duration = lesson.endSlot - lesson.startSlot;

                                        // Feature 3: 상태별 스타일
                                        const isCancelled = lesson.status === 'cancelled';
                                        const isMakeup = lesson.status === 'makeup';
                                        const hasSubstitute = !!lesson.substituteInstructorId;

                                        // 스타일 결정 - 공유 색상 사용
                                        const color = getLessonColor(lesson);
                                        let bgClass = color.bg;
                                        let textClass = color.text;

                                        if (isCancelled) {
                                            bgClass = "bg-gray-200/80";
                                            textClass = "text-gray-500";
                                        } else if (isMakeup) {
                                            bgClass = "bg-purple-100/80";
                                            textClass = "text-purple-900";
                                        } else if (hasConflict) {
                                            bgClass = "bg-red-100/80";
                                            textClass = "text-red-800";
                                        } else if (hasSubstitute) {
                                            bgClass = "bg-orange-100/80";
                                            textClass = "text-orange-900";
                                        }

                                        return (
                                            <div
                                                key={lesson.id}
                                                className={cn(
                                                    "m-[1px] rounded pointer-events-auto flex items-center justify-center px-1 text-[9px] overflow-hidden select-none",
                                                    bgClass,
                                                    textClass,
                                                    isMakeup && "ring-1 ring-inset ring-purple-300",
                                                    hasSubstitute && !isCancelled && "ring-1 ring-inset ring-orange-300"
                                                )}
                                                style={{
                                                    gridColumn: `${dayIndex + 1} / ${dayIndex + 2}`,
                                                    gridRow: `${lesson.startSlot + 1} / ${lesson.endSlot + 1}`
                                                }}
                                                title={
                                                    hasSubstitute && lesson.substituteInstructorName
                                                        ? `${lesson.instructor} → (대타) ${lesson.substituteInstructorName} · ${lesson.title}`
                                                        : lesson.instructor ? `${lesson.instructor} · ${lesson.title}` : lesson.title
                                                }
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onLessonClick(lesson);
                                                }}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    onLessonClick(lesson);
                                                }}
                                            >
                                                {duration >= 2 && (
                                                    <span className={cn("whitespace-nowrap overflow-hidden text-ellipsis font-medium", isCancelled && "line-through")}>
                                                        {hasSubstitute && lesson.substituteInstructorName
                                                            ? `(대타) ${lesson.substituteInstructorName}`
                                                            : lesson.instructor || lesson.title || '수업'}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

MultiView.displayName = 'MultiView';

