// LessonBlock.tsx - Memoized lesson block component for performance optimization
import React from 'react';
import { cn } from '../../lib/utils';
import { getLessonColor } from '../../core/lessonColors';
import type { ScheduleLesson } from '../../core/types';

interface LessonBlockProps {
    lesson: ScheduleLesson;
    dayIdx: number;
    conflict: boolean;
    onPointerDown: (e: React.PointerEvent, lesson: ScheduleLesson) => void;
    onContextMenu: (e: React.MouseEvent, lesson: ScheduleLesson) => void;
    onResizeStart: (e: React.PointerEvent, lesson: ScheduleLesson, edge: 'start' | 'end') => void;
}

function LessonBlockComponent({
    lesson,
    dayIdx,
    conflict,
    onPointerDown,
    onContextMenu,
    onResizeStart
}: LessonBlockProps) {
    const color = getLessonColor(lesson);
    const isCancelled = lesson.status === 'cancelled';
    const isMakeup = lesson.status === 'makeup';
    const hasSubstitute = !!lesson.substituteInstructorId;

    return (
        <div
            className={cn(
                "timetable-block relative m-1 rounded-lg px-3 py-2 overflow-hidden cursor-pointer",
                "transition-all duration-150 hover:brightness-95 hover:scale-[1.01]",
                isCancelled
                    ? "bg-gray-200/80 text-gray-500 opacity-60"
                    : isMakeup
                        ? "bg-purple-100/80 text-purple-900 ring-2 ring-purple-300"
                        : conflict
                            ? "bg-red-100/80 text-red-800"
                            : hasSubstitute
                                ? "bg-orange-100/80 text-orange-900 ring-2 ring-orange-300"
                                : `${color.bg} ${color.text}`
            )}
            style={{
                gridColumn: `${dayIdx + 2} / ${dayIdx + 3}`,
                gridRow: `${lesson.startSlot + 2} / ${lesson.endSlot + 2}`,
                zIndex: 10
            }}
            onPointerDown={(e) => onPointerDown(e, lesson)}
            onContextMenu={(e) => onContextMenu(e, lesson)}
        >
            {/* 상태 태그 */}
            {isCancelled && (
                <span className="absolute top-1 right-1 text-xs font-semibold bg-gray-400 text-white px-1.5 py-0.5 rounded">휴강</span>
            )}
            {isMakeup && (
                <span className="absolute top-1 right-1 text-xs font-semibold bg-purple-500 text-white px-1.5 py-0.5 rounded">보강</span>
            )}
            {hasSubstitute && !isCancelled && (
                <span className="absolute top-1 right-1 text-xs font-semibold bg-orange-500 text-white px-1.5 py-0.5 rounded">대타</span>
            )}

            <div className={cn("text-base font-bold truncate leading-tight", isCancelled && "line-through")}>{lesson.title || '수업'}</div>
            <div className="text-sm opacity-75 mt-1">
                {hasSubstitute && lesson.substituteInstructorName ? (
                    <>
                        <span className="line-through opacity-60">{lesson.instructor}</span>
                        <span className="block truncate">(대타) {lesson.substituteInstructorName}</span>
                    </>
                ) : (
                    <span className="truncate">{lesson.instructor}</span>
                )}
            </div>

            {/* Resize handles */}
            <div
                className="absolute top-0 left-0 w-full h-2 cursor-ns-resize z-20 hover:bg-black/5 rounded-t-md"
                onPointerDown={(e) => onResizeStart(e, lesson, 'start')}
            />
            <div
                className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize z-20 hover:bg-black/5 rounded-b-md"
                onPointerDown={(e) => onResizeStart(e, lesson, 'end')}
            />
        </div>
    );
}

// React.memo with custom comparison for performance
export const LessonBlock = React.memo(LessonBlockComponent, (prev, next) => {
    return (
        prev.lesson.id === next.lesson.id &&
        prev.lesson.status === next.lesson.status &&
        prev.lesson.startSlot === next.lesson.startSlot &&
        prev.lesson.endSlot === next.lesson.endSlot &&
        prev.lesson.day === next.lesson.day &&
        prev.lesson.title === next.lesson.title &&
        prev.lesson.instructor === next.lesson.instructor &&
        prev.lesson.substituteInstructorId === next.lesson.substituteInstructorId &&
        prev.lesson.substituteInstructorName === next.lesson.substituteInstructorName &&
        prev.dayIdx === next.dayIdx &&
        prev.conflict === next.conflict
    );
});
