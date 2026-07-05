import { describe, it, expect, beforeEach } from 'vitest';
import { useLessonStore } from './lessonStore';

describe('lessonStore', () => {
    beforeEach(() => {
        // Reset store state before each test
        useLessonStore.setState({ lessons: {}, conflicts: {} });
    });

    describe('setLessons', () => {
        it('should set lessons from array', () => {
            const mockLessons = [
                { id: 1, classroomId: 1, day: 1, startSlot: 0, endSlot: 2, studentId: 1, instructorId: 1 },
                { id: 2, classroomId: 1, day: 2, startSlot: 2, endSlot: 4, studentId: 2, instructorId: 1 },
            ];

            useLessonStore.getState().setLessons(mockLessons as any);

            const state = useLessonStore.getState();
            expect(Object.keys(state.lessons)).toHaveLength(2);
            expect(state.lessons[1]).toBeDefined();
            expect(state.lessons[2]).toBeDefined();
        });
    });

    describe('addLesson', () => {
        it('should add a new lesson', () => {
            const mockLesson = { id: 1, classroomId: 1, day: 1, startSlot: 0, endSlot: 2, studentId: 1, instructorId: 1 };

            useLessonStore.getState().addLesson(mockLesson as any);

            const state = useLessonStore.getState();
            expect(state.lessons[1]).toEqual(mockLesson);
        });
    });

    describe('removeLesson', () => {
        it('should remove an existing lesson', () => {
            const mockLesson = { id: 1, classroomId: 1, day: 1, startSlot: 0, endSlot: 2, studentId: 1, instructorId: 1 };
            useLessonStore.getState().addLesson(mockLesson as any);

            useLessonStore.getState().removeLesson(1);

            const state = useLessonStore.getState();
            expect(state.lessons[1]).toBeUndefined();
        });
    });

    describe('conflict detection', () => {
        it('should detect overlapping lessons', () => {
            // Same classroom, same day, overlapping slots (0-2 and 1-3)
            const lesson1 = { id: 1, classroomId: 1, day: 1, startSlot: 0, endSlot: 2, studentId: 1, instructorId: 1 };
            const lesson2 = { id: 2, classroomId: 1, day: 1, startSlot: 1, endSlot: 3, studentId: 2, instructorId: 2 };

            useLessonStore.getState().setLessons([lesson1, lesson2] as any);

            const state = useLessonStore.getState();
            // Both lessons should be marked as conflicts (overlapping slots in same classroom on same day)
            expect(state.conflicts[1]).toBe(true);
            expect(state.conflicts[2]).toBe(true);
        });

        it('should not detect conflict for non-overlapping lessons', () => {
            // Same classroom, same day, non-overlapping slots (0-2 and 2-4)
            const lesson1 = { id: 1, classroomId: 1, day: 1, startSlot: 0, endSlot: 2, studentId: 1, instructorId: 1 };
            const lesson2 = { id: 2, classroomId: 1, day: 1, startSlot: 2, endSlot: 4, studentId: 2, instructorId: 2 };

            useLessonStore.getState().setLessons([lesson1, lesson2] as any);

            const state = useLessonStore.getState();
            expect(state.conflicts[1]).toBeFalsy();
            expect(state.conflicts[2]).toBeFalsy();
        });
    });
});

