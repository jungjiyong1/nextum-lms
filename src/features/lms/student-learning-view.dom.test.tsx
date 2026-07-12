/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentLearningClassContext, StudentLearningOverview } from './types';
import { StudentLearningView } from './student-learning-view';

const serviceMocks = vi.hoisted(() => ({
    loadClass: vi.fn(),
    loadUnit: vi.fn(),
    loadEvidence: vi.fn(),
    loadAssignment: vi.fn(),
    loadConversation: vi.fn(),
    loadSummaries: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./service', () => ({
    loadStudentLearningClassContext: serviceMocks.loadClass,
    loadStudentLearningUnitDetail: serviceMocks.loadUnit,
    loadStudentLearningTypeEvidence: serviceMocks.loadEvidence,
    loadStudentAssignmentLearningDetail: serviceMocks.loadAssignment,
    loadStudentAiConversationDetail: serviceMocks.loadConversation,
    loadStudentAiConversationSummaries: serviceMocks.loadSummaries,
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

const overview: StudentLearningOverview = {
    subjects: [{
        subjectId: 'subject-math',
        subjectName: '수학',
        status: 'check_needed',
        sampleCount: 20,
        correctCount: 12,
        correctRate: 60,
        correctedProblemCount: 3,
        pendingAssignmentCount: 2,
        dueSoonAssignmentCount: 1,
        classes: [
            {
                classId: 'class-a', className: '중2 수학 A', color: '#2563eb', courseTitle: '중2 수학', subjectId: 'subject-math', subjectName: '수학',
                pathState: 'configured', primaryPathName: '중2 기본', activePathCount: 1, status: 'check_needed', sampleCount: 10, correctCount: 6,
                correctRate: 60, correctedProblemCount: 2, pendingAssignmentCount: 1, dueSoonAssignmentCount: 1, lastLearningAt: '2026-07-10T00:00:00Z',
            },
            {
                classId: 'class-b', className: '중2 수학 보충', color: '#16a34a', courseTitle: '중2 수학', subjectId: 'subject-math', subjectName: '수학',
                pathState: 'needs_setup', primaryPathName: null, activePathCount: 0, status: 'no_data', sampleCount: 0, correctCount: 0,
                correctRate: null, correctedProblemCount: 0, pendingAssignmentCount: 1, dueSoonAssignmentCount: 0, lastLearningAt: null,
            },
        ],
    }],
    personalAssignments: [],
    unclassifiedAttemptCount: 0,
};

function context(classId: string): StudentLearningClassContext {
    return { classId, pathState: 'needs_setup', paths: [], units: [], assignments: [] };
}

describe('StudentLearningView lazy loading', () => {
    it('does not request drill-down data until a class is opened and aborts stale class requests', async () => {
        const first = deferred<StudentLearningClassContext>();
        const second = deferred<StudentLearningClassContext>();
        serviceMocks.loadClass.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

        render(<StudentLearningView academyId="academy-1" studentId="student-1" overview={overview} />);

        expect(serviceMocks.loadClass).not.toHaveBeenCalled();
        expect(serviceMocks.loadUnit).not.toHaveBeenCalled();
        expect(serviceMocks.loadAssignment).not.toHaveBeenCalled();
        expect(serviceMocks.loadSummaries).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /수학.*최근 최초 시도/ }));
        expect(serviceMocks.loadClass).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /중2 수학 A/ }));
        await waitFor(() => expect(serviceMocks.loadClass).toHaveBeenCalledTimes(1));
        const firstSignal = serviceMocks.loadClass.mock.calls[0]?.[3]?.signal as AbortSignal;
        expect(firstSignal.aborted).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: /중2 수학 보충/ }));
        await waitFor(() => expect(serviceMocks.loadClass).toHaveBeenCalledTimes(2));
        const secondSignal = serviceMocks.loadClass.mock.calls[1]?.[3]?.signal as AbortSignal;
        expect(firstSignal.aborted).toBe(true);
        expect(secondSignal.aborted).toBe(false);

        await act(async () => second.resolve(context('class-b')));
        expect(await screen.findByText('학습 범위 설정이 필요합니다.')).toBeInTheDocument();
    });

    it('loads the legacy AI review bucket only when it is opened', async () => {
        serviceMocks.loadSummaries.mockResolvedValue([]);
        render(<StudentLearningView academyId="academy-1" studentId="student-1" overview={overview} />);

        expect(serviceMocks.loadSummaries).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /AI 연결 확인 필요/ }));

        await waitFor(() => expect(serviceMocks.loadSummaries).toHaveBeenCalledWith(
            'academy-1',
            'student-1',
            null,
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        ));
        expect(await screen.findByText('연결을 확인할 대화가 없습니다.')).toBeInTheDocument();
    });

    it('keeps an explicit personal assignment visible without inventing a class context', () => {
        const personalOverview: StudentLearningOverview = {
            subjects: [],
            unclassifiedAttemptCount: 0,
            personalAssignments: [{
                id: 'assignment-personal', classId: null, personal: true, title: '개인 보충 과제', dueAt: null,
                status: 'published', active: true, sourceType: 'content_scope', bookTitle: '개인 교재', progressStatus: 'not_started',
                requiredProblemCount: 5, attemptedProblemCount: 0, attemptCount: 0, correctAttemptCount: 0, correctRate: null,
                correctedProblemCount: 0, dueSoon: false, overdue: false, lastActivityAt: null,
            }],
        };

        render(<StudentLearningView academyId="academy-1" studentId="student-1" overview={personalOverview} />);

        expect(screen.getByRole('heading', { name: '개인 과제' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /개인 보충 과제/ })).toBeInTheDocument();
        expect(screen.queryByText('표시할 과목별 학습 기록이 없습니다.')).not.toBeInTheDocument();
        expect(serviceMocks.loadClass).not.toHaveBeenCalled();
    });
});
