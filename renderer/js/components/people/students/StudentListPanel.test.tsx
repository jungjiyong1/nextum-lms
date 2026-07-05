import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StudentListPanel } from './StudentListPanel';
import type { Student } from '../../../core/types';

// Mock @tanstack/react-virtual
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: vi.fn(({ count, estimateSize }) => ({
        getTotalSize: () => count * estimateSize(),
        getVirtualItems: () =>
            Array.from({ length: count }, (_, i) => ({
                index: i,
                key: i,
                start: i * estimateSize(),
                size: estimateSize(),
            })),
    })),
}));

// Complete mock students matching Student type
const mockStudents: Student[] = [
    {
        id: 1,
        name: '김철수',
        email: 'chulsoo@test.com',
        phone: '010-1234-5678',
        date_of_birth: '2010-01-01',
        enrollment_date: '2024-01-01',
        status: 'active',
        school_type: 'middle',
        grade: 2,
        monthly_tuition: 300000,
        payment_cycle_day: 1,
        last_payment_date: null,
        parent_name: null,
        parent_phone: null,
        notes: '',
    },
    {
        id: 2,
        name: '박영희',
        email: 'younghee@test.com',
        phone: '010-2345-6789',
        date_of_birth: '2008-05-15',
        enrollment_date: '2024-02-01',
        status: 'on_leave',
        school_type: 'high',
        grade: 1,
        monthly_tuition: 350000,
        payment_cycle_day: 1,
        last_payment_date: null,
        parent_name: null,
        parent_phone: null,
        notes: '',
    },
    {
        id: 3,
        name: '이민수',
        email: 'minsoo@test.com',
        phone: '010-3456-7890',
        date_of_birth: '2012-08-20',
        enrollment_date: '2023-03-01',
        status: 'dropped',
        school_type: 'elementary',
        grade: 6,
        monthly_tuition: 280000,
        payment_cycle_day: 1,
        last_payment_date: null,
        parent_name: null,
        parent_phone: null,
        notes: '',
    },
];

describe('StudentListPanel', () => {
    const mockOnSelect = vi.fn();

    beforeEach(() => {
        mockOnSelect.mockClear();
    });

    describe('rendering', () => {
        it('should render empty state when no students', () => {
            render(
                <StudentListPanel
                    students={[]}
                    selectedId={null}
                    onSelect={mockOnSelect}
                    loading={false}
                />
            );

            expect(screen.getByText('학생이 없습니다.')).toBeInTheDocument();
        });

        it('should render student list', () => {
            render(
                <StudentListPanel
                    students={mockStudents}
                    selectedId={null}
                    onSelect={mockOnSelect}
                    loading={false}
                />
            );

            expect(screen.getByText('김철수')).toBeInTheDocument();
            expect(screen.getByText('박영희')).toBeInTheDocument();
            expect(screen.getByText('이민수')).toBeInTheDocument();
        });

        it('should display student status badges', () => {
            render(
                <StudentListPanel
                    students={mockStudents}
                    selectedId={null}
                    onSelect={mockOnSelect}
                    loading={false}
                />
            );

            expect(screen.getByText('재원')).toBeInTheDocument();
            expect(screen.getByText('휴원')).toBeInTheDocument();
            expect(screen.getByText('퇴원')).toBeInTheDocument();
        });
    });

    describe('selection', () => {
        it('should call onSelect when clicking a student', () => {
            render(
                <StudentListPanel
                    students={mockStudents}
                    selectedId={null}
                    onSelect={mockOnSelect}
                    loading={false}
                />
            );

            fireEvent.click(screen.getByText('김철수'));

            expect(mockOnSelect).toHaveBeenCalledWith(mockStudents[0]);
        });
    });
});
