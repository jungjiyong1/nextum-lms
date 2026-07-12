/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningAnalysisData, LearningPathSummary } from './learning-analysis-types';
import { LearningAnalysisView } from './learning-analysis-view';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function path(
  id: string,
  name: string,
  role: LearningPathSummary['role'],
  status: LearningPathSummary['status'],
): LearningPathSummary {
  return {
    id,
    kind: 'current',
    role,
    purpose: 'current',
    status,
    classId: 'class-1',
    className: '중2 수학 A',
    name,
    targetBand: 2,
    maintenanceIntervalDays: 21,
    scopeSkillCount: 1,
    materialCount: 0,
    dueStudentCount: 0,
    actionCount: 0,
    units: [{
      name: '일차함수',
      skillCount: 1,
      needsCheckCount: 0,
      supportCandidateCount: 0,
      contentGapCount: 0,
    }],
    lastEvidenceAt: null,
  };
}

const data: LearningAnalysisData = {
  catalog: { classes: [], students: [], skills: [], materials: [] },
  paths: [
    path('active-primary', '현재 대표 경로', 'primary', 'active'),
    path('draft-primary', '다음 대표 경로', 'primary', 'draft'),
    path('draft-supplemental', '준비 중 보조 경로', 'supplemental', 'draft'),
    path('completed-primary', '완료 대표 경로', 'primary', 'completed'),
    path('archived-supplemental', '보관 보조 경로', 'supplemental', 'archived'),
  ],
  actionQueue: [],
  examPlans: [],
  examStudents: [],
};

describe('LearningAnalysisView path lifecycle', () => {
  it('shows lifecycle state and only lets a draft primary path start', async () => {
    const onStartPath = vi.fn().mockResolvedValue(undefined);

    render(
      <LearningAnalysisView
        data={data}
        loading={false}
        error={null}
        selectedExamPlanId={null}
        onSelectedExamPlanChange={vi.fn()}
        onSubmitPlan={vi.fn()}
        onStartPath={onStartPath}
      />,
    );

    expect(screen.getByText('진행 중')).toBeInTheDocument();
    expect(screen.getAllByText('준비 중')).toHaveLength(2);
    expect(screen.getByText('완료')).toBeInTheDocument();
    expect(screen.getByText('보관')).toBeInTheDocument();
    expect(screen.getAllByText('대표 경로')).toHaveLength(3);
    expect(screen.getAllByText('보조 경로')).toHaveLength(2);

    const startButtons = screen.getAllByRole('button', { name: '다음 경로 시작' });
    expect(startButtons).toHaveLength(1);
    fireEvent.click(startButtons[0]);

    await waitFor(() => expect(onStartPath).toHaveBeenCalledWith('draft-primary'));
    expect(onStartPath).toHaveBeenCalledTimes(1);
  });
});
