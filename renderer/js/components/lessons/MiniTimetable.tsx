import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { getLessonColor } from '../../core/lessonColors';
import { slotToTime } from '../../core/utils/time';
import type { Lesson } from '../../core/types';

interface MiniTimetableProps {
    lessons: Lesson[];
    className?: string;
}

interface ConflictInfo {
    lesson1Id: number;
    lesson2Id: number;
    day: number;
}

// Day labels
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_COUNT = 7;

// Time slot range (9:00 ~ 24:00 = slots 0~30)
const MIN_SLOT = 0;
const MAX_SLOT = 30;
const SLOT_COUNT = MAX_SLOT - MIN_SLOT;

function detectConflicts(lessons: Lesson[]): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    for (let i = 0; i < lessons.length; i++) {
        for (let j = i + 1; j < lessons.length; j++) {
            const a = lessons[i];
            const b = lessons[j];
            if (a.day === null || b.day === null) continue;
            if (a.startSlot === null || a.endSlot === null || b.startSlot === null || b.endSlot === null) continue;
            if (a.day === b.day) {
                // Check time overlap
                if (a.startSlot < b.endSlot && b.startSlot < a.endSlot) {
                    conflicts.push({
                        lesson1Id: a.id,
                        lesson2Id: b.id,
                        day: a.day,
                    });
                }
            }
        }
    }
    return conflicts;
}

export function MiniTimetable({ lessons, className }: MiniTimetableProps) {
    // Filter only lessons with valid schedule
    const scheduledLessons = useMemo(() =>
        lessons.filter(l => l.day !== null && l.startSlot !== null && l.endSlot !== null),
        [lessons]
    );

    const conflicts = useMemo(() => detectConflicts(scheduledLessons), [scheduledLessons]);

    const conflictingIds = useMemo(() => {
        const ids = new Set<number>();
        conflicts.forEach(c => {
            ids.add(c.lesson1Id);
            ids.add(c.lesson2Id);
        });
        return ids;
    }, [conflicts]);

    // Calculate slot range for display (with some padding)
    const slotRange = useMemo(() => {
        if (scheduledLessons.length === 0) return { min: 0, max: 20 };
        let minSlot = MAX_SLOT;
        let maxSlot = MIN_SLOT;
        scheduledLessons.forEach(l => {
            if (l.startSlot !== null && l.startSlot < minSlot) minSlot = l.startSlot;
            if (l.endSlot !== null && l.endSlot > maxSlot) maxSlot = l.endSlot;
        });
        // Add some padding
        minSlot = Math.max(MIN_SLOT, minSlot - 2);
        maxSlot = Math.min(MAX_SLOT, maxSlot + 2);
        return { min: minSlot, max: maxSlot };
    }, [scheduledLessons]);

    const displaySlots = slotRange.max - slotRange.min;

    // Calculate block position
    const getBlockStyle = (lesson: Lesson): React.CSSProperties => {
        if (lesson.day === null || lesson.startSlot === null || lesson.endSlot === null) return {};
        const dayWidth = 100 / DAY_COUNT;
        const top = ((lesson.startSlot - slotRange.min) / displaySlots) * 100;
        const height = ((lesson.endSlot - lesson.startSlot) / displaySlots) * 100;
        const left = lesson.day * dayWidth;
        return {
            position: 'absolute',
            top: `${top}%`,
            left: `${left}%`,
            width: `${dayWidth}%`,
            height: `${height}%`,
        };
    };

    // Generate time labels
    const timeLabels = useMemo(() => {
        const labels: { slot: number; label: string }[] = [];
        for (let slot = slotRange.min; slot <= slotRange.max; slot += 2) {
            labels.push({ slot, label: slotToTime(slot) });
        }
        return labels;
    }, [slotRange]);

    if (lessons.length === 0) {
        return (
            <div className={cn("flex items-center justify-center h-full text-muted-foreground text-sm", className)}>
                강의를 선택하면 시간표가 표시됩니다
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col h-full", className)}>
            {/* Conflict warning */}
            {conflicts.length > 0 && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-2 mb-2 text-sm text-destructive">
                    ⚠️ {conflicts.length}개의 시간 충돌이 있습니다
                </div>
            )}

            {/* Timetable grid */}
            <div className="flex-1 flex min-h-0">
                {/* Time axis */}
                <div className="w-10 flex flex-col text-xs text-muted-foreground pr-1">
                    <div className="h-6" /> {/* Header spacer */}
                    <div className="flex-1 relative">
                        {timeLabels.map(({ slot, label }) => (
                            <div
                                key={slot}
                                className="absolute right-0 -translate-y-1/2"
                                style={{ top: `${((slot - slotRange.min) / displaySlots) * 100}%` }}
                            >
                                {label}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Grid area */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Day headers */}
                    <div className="h-6 flex border-b">
                        {DAYS.map((day, idx) => (
                            <div
                                key={idx}
                                className="flex-1 text-center text-xs font-medium flex items-center justify-center"
                            >
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Time slots grid */}
                    <div className="flex-1 relative bg-muted/30 border rounded-b">
                        {/* Vertical day dividers */}
                        {Array.from({ length: DAY_COUNT - 1 }).map((_, i) => (
                            <div
                                key={`v-${i}`}
                                className="absolute top-0 bottom-0 border-l border-border/50"
                                style={{ left: `${((i + 1) / DAY_COUNT) * 100}%` }}
                            />
                        ))}

                        {/* Horizontal time dividers */}
                        {Array.from({ length: Math.floor(displaySlots / 2) }).map((_, i) => (
                            <div
                                key={`h-${i}`}
                                className="absolute left-0 right-0 border-t border-border/30"
                                style={{ top: `${(((i + 1) * 2) / displaySlots) * 100}%` }}
                            />
                        ))}

                        {/* Lesson blocks */}
                        {scheduledLessons.map(lesson => {
                            const isConflicting = conflictingIds.has(lesson.id);
                            const color = getLessonColor(lesson);
                            return (
                                <div
                                    key={lesson.id}
                                    style={getBlockStyle(lesson)}
                                    className={cn(
                                        "absolute p-0.5 overflow-hidden",
                                    )}
                                >
                                    <div
                                        className={cn(
                                            "w-full h-full rounded border-l-2 border-current px-1 py-0.5 text-[10px] overflow-hidden",
                                            color.bg,
                                            color.text,
                                            isConflicting && "ring-2 ring-destructive ring-offset-1 animate-pulse"
                                        )}
                                    >
                                        <div className="font-medium truncate leading-tight">
                                            {lesson.title}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
