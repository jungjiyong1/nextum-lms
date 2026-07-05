import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TimetableGrid } from './TimetableGrid';
import { useLessonStore } from '../../stores/lessonStore';
import { useClassroomStore } from '../../stores/classroomStore';
import type { ScheduleLesson } from '../../core/types';

// Mock the stores
vi.mock('../../stores/lessonStore', () => ({
    useLessonStore: vi.fn(),
}));

vi.mock('../../stores/classroomStore', () => ({
    useClassroomStore: vi.fn(),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

const mockLessons = {
    1: {
        id: 1,
        classroomId: 1,
        day: 1, // Monday
        startSlot: 2,
        endSlot: 4,
        title: '수학 기초',
        instructor: '김선생',
        color: '#3b82f6',
    },
    2: {
        id: 2,
        classroomId: 1,
        day: 3, // Wednesday
        startSlot: 5,
        endSlot: 7,
        title: '영어 회화',
        instructor: '박선생',
        color: '#10b981',
    },
} as unknown as Record<number, ScheduleLesson>;

describe('TimetableGrid', () => {
    const mockOnLessonClick = vi.fn();
    const mockOnSelectionComplete = vi.fn();

    beforeEach(() => {
        mockOnLessonClick.mockClear();
        mockOnSelectionComplete.mockClear();

        // Default mock implementation
        (useLessonStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: Function) => {
            const state = {
                lessons: mockLessons,
                conflicts: {},
                includeWeekend: false,
                viewMode: 'single',
            };
            return selector(state);
        });

        (useClassroomStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: Function) => {
            const state = {
                selectedId: 1,
                classrooms: { 1: { id: 1, name: '강의실 A', x: 0, y: 0, width: 0.2, height: 0.2, color: '#fff' } },
            };
            return selector(state);
        });
    });

    describe('rendering', () => {
        it('should render weekday headers', () => {
            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            expect(screen.getByText('월')).toBeInTheDocument();
            expect(screen.getByText('화')).toBeInTheDocument();
            expect(screen.getByText('수')).toBeInTheDocument();
            expect(screen.getByText('목')).toBeInTheDocument();
            expect(screen.getByText('금')).toBeInTheDocument();
        });

        it('should render time labels', () => {
            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            // Check for at least one time label
            expect(screen.getByText('09:00')).toBeInTheDocument();
        });

        it('should render lessons for selected classroom', () => {
            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            expect(screen.getByText('수학 기초')).toBeInTheDocument();
            expect(screen.getByText('영어 회화')).toBeInTheDocument();
        });

        it('should render instructor names', () => {
            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            expect(screen.getByText('김선생')).toBeInTheDocument();
            expect(screen.getByText('박선생')).toBeInTheDocument();
        });
    });

    describe('weekend toggle', () => {
        it('should show weekend days when includeWeekend is true', () => {
            (useLessonStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: Function) => {
                const state = {
                    lessons: mockLessons,
                    conflicts: {},
                    includeWeekend: true,
                    viewMode: 'single',
                };
                return selector(state);
            });

            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            expect(screen.getByText('토')).toBeInTheDocument();
            expect(screen.getByText('일')).toBeInTheDocument();
        });
    });

    describe('conflict highlighting', () => {
        it('should highlight conflicting lessons with red background', () => {
            (useLessonStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: Function) => {
                const state = {
                    lessons: mockLessons,
                    conflicts: { 1: true },
                    includeWeekend: false,
                    viewMode: 'single',
                };
                return selector(state);
            });

            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            const conflictLesson = screen.getByText('수학 기초').closest('.timetable-block');
            expect(conflictLesson).toHaveClass('bg-red-100/80');
        });
    });

    describe('empty state', () => {
        it('should render grid even with no lessons', () => {
            (useLessonStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: Function) => {
                const state = {
                    lessons: {},
                    conflicts: {},
                    includeWeekend: false,
                    viewMode: 'single',
                };
                return selector(state);
            });

            render(
                <TimetableGrid
                    onLessonClick={mockOnLessonClick}
                    onSelectionComplete={mockOnSelectionComplete}
                />
            );

            expect(screen.getByText('월')).toBeInTheDocument();
            expect(screen.queryByText('수학 기초')).not.toBeInTheDocument();
        });
    });
});
