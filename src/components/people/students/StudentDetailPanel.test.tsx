import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { StudentDetailPanel } from './StudentDetailPanel';
import type { Student } from '../../../core/types';

const student: Student = {
  id: 1,
  name: '김테스트',
  email: 'student@example.com',
  phone: '010-1111-2222',
  date_of_birth: '2010-01-01',
  enrollment_date: '2024-03-01',
  status: 'active',
  parent_name: '학부모',
  parent_phone: '010-3333-4444',
  monthly_tuition: 300000,
  payment_cycle_day: 5,
  last_payment_date: null,
  notes: null,
  school_type: 'middle',
  grade: 2,
};

const noop = vi.fn();

describe('StudentDetailPanel', () => {
  it('can rerender from empty selection to a selected student without changing hook order', () => {
    const { rerender } = render(
      <StudentDetailPanel
        student={null}
        enrollments={[]}
        payments={[]}
        irregularLessons={[]}
        loadingExtras={false}
        onEdit={noop}
        onDelete={noop}
        onAssign={noop}
        onUnassign={noop}
      />,
    );

    expect(screen.getByText('학생을 선택하여 상세 정보를 확인하세요.')).toBeInTheDocument();

    rerender(
      <StudentDetailPanel
        student={student}
        enrollments={[]}
        payments={[]}
        irregularLessons={[]}
        loadingExtras={false}
        onEdit={noop}
        onDelete={noop}
        onAssign={noop}
        onUnassign={noop}
      />,
    );

    expect(screen.getByRole('heading', { name: '김테스트' })).toBeInTheDocument();
  });
});
