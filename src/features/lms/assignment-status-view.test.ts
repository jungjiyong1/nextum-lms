import { describe, expect, it } from 'vitest';

import {
    assignmentListDueLabel,
    assignmentListGroup,
    buildAssignmentPerformanceComparison,
    buildAssignmentTypeInsights,
} from './assignment-status-view';
import type {
    AssignmentProblemProgress,
    LearningAssignmentSummary,
} from './types';

function assignment(
    overrides: Partial<LearningAssignmentSummary> = {},
): LearningAssignmentSummary {
    return {
        id: 'assignment-1',
        title: '함수 과제',
        description: null,
        dueAt: '2026-07-17T14:00:00+09:00',
        sourceType: 'content_scope',
        status: 'active',
        active: true,
        bookTitle: '수학',
        problemCount: 2,
        targetLabels: [],
        classIds: [],
        classProgress: [],
        studentProgress: [],
        progress: {
            targetStudentCount: 10,
            notStartedCount: 6,
            inProgressCount: 2,
            completedCount: 2,
            completionRate: 20,
            attemptCount: 4,
            correctAttemptCount: 3,
            correctRate: 75,
            lastActivityAt: null,
        },
        createdAt: '2026-07-10T00:00:00+09:00',
        ...overrides,
    };
}

describe('assignmentListGroup', () => {
    const now = new Date('2026-07-17T09:00:00+09:00');

    it('groups active assignments by actionable deadline', () => {
        expect(assignmentListGroup(assignment(), now)).toBe('today');
        expect(assignmentListGroup(assignment({ dueAt: '2026-07-16T18:00:00+09:00' }), now)).toBe('overdue');
        expect(assignmentListGroup(assignment({ dueAt: '2026-07-21T18:00:00+09:00' }), now)).toBe('this_week');
        expect(assignmentListGroup(assignment({ dueAt: '2026-08-01T18:00:00+09:00' }), now)).toBe('later');
    });

    it('keeps completed and recalled assignments in dedicated groups', () => {
        expect(assignmentListGroup(assignment({
            progress: {
                ...assignment().progress,
                completedCount: 10,
                completionRate: 100,
            },
        }), now)).toBe('completed');
        expect(assignmentListGroup(assignment({ active: false }), now)).toBe('recalled');
    });
});

describe('assignmentListDueLabel', () => {
    const now = new Date('2026-07-17T09:00:00+09:00');

    it('uses the compact deadline language from the assignment list design', () => {
        expect(assignmentListDueLabel(assignment(), now)).toBe('오늘 마감');
        expect(assignmentListDueLabel(assignment({ dueAt: '2026-07-18T18:00:00+09:00' }), now)).toBe('마감 7/18 토');
        expect(assignmentListDueLabel(assignment({ dueAt: null }), now)).toBe('기한 없음');
    });

    it('labels completed assignments without presenting them as still due', () => {
        expect(assignmentListDueLabel(assignment({
            progress: {
                ...assignment().progress,
                completedCount: 10,
                completionRate: 100,
            },
        }), now)).toBe('7/17 금 완료');
    });
});

describe('buildAssignmentTypeInsights', () => {
    it('aggregates attempts by type and orders weak types first', () => {
        const problems: AssignmentProblemProgress[] = [
            {
                problemId: 'p1',
                label: '1번',
                unitId: 'u1',
                unitName: '함수',
                typeName: '그래프',
                attemptCount: 10,
                correctAttemptCount: 8,
                correctRate: 80,
                attemptedStudentCount: 10,
            },
            {
                problemId: 'p2',
                label: '2번',
                unitId: 'u1',
                unitName: '함수',
                typeName: '활용',
                attemptCount: 10,
                correctAttemptCount: 3,
                correctRate: 30,
                attemptedStudentCount: 10,
            },
            {
                problemId: 'p3',
                label: '3번',
                unitId: 'u1',
                unitName: '함수',
                typeName: '그래프',
                attemptCount: 10,
                correctAttemptCount: 6,
                correctRate: 60,
                attemptedStudentCount: 10,
            },
        ];

        const result = buildAssignmentTypeInsights(problems);

        expect(result.map((row) => row.name)).toEqual(['활용', '그래프']);
        expect(result[1]).toMatchObject({
            problemCount: 2,
            attemptCount: 20,
            correctAttemptCount: 14,
            correctRate: 70,
        });
    });
});

describe('buildAssignmentPerformanceComparison', () => {
    function classAssignment(
        id: string,
        createdAt: string,
        correctRate: number | null,
        overrides: Partial<LearningAssignmentSummary> = {},
    ): LearningAssignmentSummary {
        return assignment({
            id,
            title: `과제 ${id}`,
            createdAt,
            classIds: ['class-1'],
            classProgress: [{
                classId: 'class-1',
                className: '중등 1반',
                targetStudentCount: 10,
                notStartedCount: 0,
                inProgressCount: 0,
                completedCount: 10,
                completionRate: 100,
                attemptCount: correctRate === null ? 0 : 10,
                correctAttemptCount: correctRate === null ? 0 : correctRate / 10,
                correctRate,
                lastActivityAt: createdAt,
            }],
            ...overrides,
        });
    }

    it('compares with the latest valid assignment and up to five recent class results', () => {
        const current = classAssignment('current', '2026-07-17T09:00:00+09:00', 80);
        const previous = classAssignment('previous', '2026-07-10T09:00:00+09:00', 70);
        const older = classAssignment('older', '2026-07-03T09:00:00+09:00', 60);

        expect(buildAssignmentPerformanceComparison(
            current,
            [older, current, previous],
            'class-1',
        )).toEqual({
            currentCorrectRate: 80,
            previousAssignment: {
                assignmentId: 'previous',
                title: '과제 previous',
                correctRate: 70,
                createdAt: '2026-07-10T09:00:00+09:00',
            },
            recentClassAverage: 65,
            recentAssignmentCount: 2,
        });
    });

    it('excludes recalled, future, other-class, and no-evidence assignments', () => {
        const current = classAssignment('current', '2026-07-17T09:00:00+09:00', 80);
        const recalled = classAssignment('recalled', '2026-07-10T09:00:00+09:00', 75, { active: false });
        const future = classAssignment('future', '2026-07-20T09:00:00+09:00', 75);
        const noEvidence = classAssignment('empty', '2026-07-08T09:00:00+09:00', null);
        const otherClass = classAssignment('other', '2026-07-06T09:00:00+09:00', 90, {
            classIds: ['class-2'],
            classProgress: [{
                ...classAssignment('source', '2026-07-01T09:00:00+09:00', 90).classProgress[0],
                classId: 'class-2',
                className: '중등 2반',
            }],
        });

        expect(buildAssignmentPerformanceComparison(
            current,
            [current, recalled, future, noEvidence, otherClass],
            'class-1',
        )).toMatchObject({
            previousAssignment: null,
            recentClassAverage: null,
            recentAssignmentCount: 0,
        });
    });

    it('uses overall progress while still matching prior assignments to the same target classes', () => {
        const current = classAssignment('current', '2026-07-17T09:00:00+09:00', 80, {
            progress: {
                ...assignment().progress,
                correctRate: 82,
            },
        });
        const previous = classAssignment('previous', '2026-07-10T09:00:00+09:00', 70, {
            progress: {
                ...assignment().progress,
                correctRate: 74,
            },
        });
        const otherClass = classAssignment('other', '2026-07-12T09:00:00+09:00', 90, {
            classIds: ['class-2'],
            classProgress: [{
                ...classAssignment('source', '2026-07-01T09:00:00+09:00', 90).classProgress[0],
                classId: 'class-2',
                className: '중등 2반',
            }],
            progress: {
                ...assignment().progress,
                correctRate: 95,
            },
        });

        expect(buildAssignmentPerformanceComparison(
            current,
            [current, previous, otherClass],
        )).toMatchObject({
            currentCorrectRate: 82,
            previousAssignment: {
                assignmentId: 'previous',
                correctRate: 74,
            },
            recentClassAverage: 74,
            recentAssignmentCount: 1,
        });
    });
});
