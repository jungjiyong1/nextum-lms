import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ScheduleLesson, ViewMode } from '../core/types';
import { getWeekStart, formatDate, getWeekRange } from '../core/utils/date';
import * as api from '../core/api';

export interface LessonState {
    lessons: Record<number, ScheduleLesson>;
    conflicts: Record<number, boolean>;
    viewMode: ViewMode;
    includeWeekend: boolean;
    weekStart: string;
}

export interface LessonActions {
    setLessons: (list: ScheduleLesson[]) => void;
    addLesson: (lesson: ScheduleLesson) => void;
    updateLesson: (id: number, updates: Partial<ScheduleLesson>) => void;
    removeLesson: (id: number) => void;
    setViewMode: (mode: ViewMode) => void;
    setIncludeWeekend: (include: boolean) => void;
    setWeekStart: (start: string) => void;
    clear: () => void;
}

const initialState: LessonState = {
    lessons: {},
    conflicts: {},
    viewMode: 'multi',
    includeWeekend: true,
    weekStart: formatDate(getWeekStart()),
};

// Helper for conflict detection
function computeConflicts(lessonsMap: Record<number, ScheduleLesson>): Record<number, boolean> {
    const conflictRecord: Record<number, boolean> = {};
    const grouped: Record<string, ScheduleLesson[]> = {};

    Object.values(lessonsMap).forEach((lesson) => {
        const key = `${lesson.classroomId}-${lesson.day}`;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(lesson);
    });

    Object.values(grouped).forEach((list) => {
        list.sort((a, b) => a.startSlot - b.startSlot);
        let active: ScheduleLesson[] = [];
        list.forEach((lesson) => {
            active = active.filter((item) => item.endSlot > lesson.startSlot);
            active.forEach((item) => {
                if (item.startSlot < lesson.endSlot) {
                    conflictRecord[item.id] = true;
                    conflictRecord[lesson.id] = true;
                }
            });
            active.push(lesson);
        });
    });

    return conflictRecord;
}

export const useLessonStore = create<LessonState & LessonActions>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        setLessons: (list) => {
            const map: Record<number, ScheduleLesson> = {};
            list.forEach((lesson) => {
                map[lesson.id] = lesson;
            });
            const conflicts = computeConflicts(map);
            set({ lessons: map, conflicts });
        },

        addLesson: (lesson) => {
            const { lessons } = get();
            const newLessons = { ...lessons, [lesson.id]: lesson };
            const conflicts = computeConflicts(newLessons);
            set({ lessons: newLessons, conflicts });
        },

        updateLesson: (id, updates) => {
            const { lessons } = get();
            const lesson = lessons[id];
            if (lesson) {
                const newLessons = { ...lessons, [id]: { ...lesson, ...updates } };
                const conflicts = computeConflicts(newLessons);
                set({ lessons: newLessons, conflicts });
            }
        },

        removeLesson: (id) => {
            const { lessons } = get();
            const newLessons = { ...lessons };
            delete newLessons[id];
            const conflicts = computeConflicts(newLessons);
            set({ lessons: newLessons, conflicts });
        },

        setViewMode: (viewMode) => set({ viewMode }),
        setIncludeWeekend: (includeWeekend) => set({ includeWeekend }),
        setWeekStart: (weekStart) => set({ weekStart }),

        fetchLessons: async () => {
            const { weekStart } = get();
            const { startDate, endDate } = getWeekRange(weekStart);
            const result = await api.listScheduleLessons(startDate, endDate);
            if (result.success) {
                get().setLessons(result.data);
            } else {
                console.error("Failed to fetch lessons:", result.error);
            }
        },
        clear: () => set(initialState),
    }))
);

// Optional: specific selectors for optimization
export const selectLessonsForClassroom = (classroomId: number) => (state: LessonState) =>
    Object.values(state.lessons).filter(l => l.classroomId === classroomId);

export const selectHasConflict = (lessonId: number) => (state: LessonState) =>
    !!state.conflicts[lessonId];

