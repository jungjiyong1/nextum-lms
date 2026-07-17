import type {
    AssignmentProblemProgress,
    LearningAssignmentSummary,
} from './types';

export type AssignmentListGroup =
    | 'overdue'
    | 'today'
    | 'this_week'
    | 'later'
    | 'completed'
    | 'recalled';

export interface AssignmentTypeInsight {
    key: string;
    name: string;
    problemCount: number;
    attemptCount: number;
    correctAttemptCount: number;
    correctRate: number | null;
    problems: AssignmentProblemProgress[];
}

export interface AssignmentPerformanceBenchmark {
    assignmentId: string;
    title: string;
    correctRate: number;
    createdAt: string;
}

export interface AssignmentPerformanceComparison {
    currentCorrectRate: number | null;
    previousAssignment: AssignmentPerformanceBenchmark | null;
    recentClassAverage: number | null;
    recentAssignmentCount: number;
}

export const assignmentListGroupLabels: Record<AssignmentListGroup, string> = {
    overdue: '기한 지남',
    today: '오늘 마감',
    this_week: '이번 주',
    later: '다음 주 이후',
    completed: '완료',
    recalled: '회수됨',
};

export const assignmentListGroupOrder: AssignmentListGroup[] = [
    'overdue',
    'today',
    'this_week',
    'later',
    'completed',
    'recalled',
];

function isAssignmentComplete(assignment: LearningAssignmentSummary): boolean {
    return assignment.progress.targetStudentCount > 0
        && assignment.progress.completedCount >= assignment.progress.targetStudentCount;
}

function isSameLocalDate(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

export function assignmentListGroup(
    assignment: LearningAssignmentSummary,
    now = new Date(),
): AssignmentListGroup {
    if (!assignment.active || assignment.status === 'archived') return 'recalled';
    if (isAssignmentComplete(assignment)) return 'completed';
    if (!assignment.dueAt) return 'later';

    const due = new Date(assignment.dueAt);
    if (Number.isNaN(due.getTime())) return 'later';
    if (due.getTime() < now.getTime()) return 'overdue';
    if (isSameLocalDate(due, now)) return 'today';

    const weekBoundary = new Date(now);
    weekBoundary.setDate(weekBoundary.getDate() + 7);
    return due.getTime() <= weekBoundary.getTime() ? 'this_week' : 'later';
}

export function buildAssignmentTypeInsights(
    problems: AssignmentProblemProgress[],
): AssignmentTypeInsight[] {
    const grouped = new Map<string, AssignmentTypeInsight>();

    for (const problem of problems) {
        const name = problem.typeName || problem.unitName || '유형 미분류';
        const key = `${problem.typeName ? 'type' : problem.unitName ? 'unit' : 'other'}:${name}`;
        const current = grouped.get(key) || {
            key,
            name,
            problemCount: 0,
            attemptCount: 0,
            correctAttemptCount: 0,
            correctRate: null,
            problems: [],
        };
        current.problemCount += 1;
        current.attemptCount += problem.attemptCount;
        current.correctAttemptCount += problem.correctAttemptCount;
        current.problems.push(problem);
        grouped.set(key, current);
    }

    return [...grouped.values()]
        .map((row) => ({
            ...row,
            correctRate: row.attemptCount === 0
                ? null
                : Math.round((row.correctAttemptCount / row.attemptCount) * 100),
            problems: [...row.problems].sort((left, right) => {
                const leftRate = left.correctRate ?? Number.MAX_SAFE_INTEGER;
                const rightRate = right.correctRate ?? Number.MAX_SAFE_INTEGER;
                if (leftRate !== rightRate) return leftRate - rightRate;
                return left.label.localeCompare(right.label, 'ko');
            }),
        }))
        .sort((left, right) => {
            const leftRate = left.correctRate ?? Number.MAX_SAFE_INTEGER;
            const rightRate = right.correctRate ?? Number.MAX_SAFE_INTEGER;
            if (leftRate !== rightRate) return leftRate - rightRate;
            return left.name.localeCompare(right.name, 'ko');
        });
}

export function buildAssignmentPerformanceComparison(
    currentAssignment: LearningAssignmentSummary,
    assignments: LearningAssignmentSummary[],
    classId: string | null,
): AssignmentPerformanceComparison {
    const currentClassProgress = currentAssignment.classProgress.find(
        (row) => (row.classId || null) === classId,
    );
    const currentCorrectRate = (currentClassProgress || currentAssignment.progress).correctRate;
    const currentCreatedAt = Date.parse(currentAssignment.createdAt);
    const history = assignments
        .filter((assignment) => {
            if (assignment.id === currentAssignment.id) return false;
            if (!assignment.active || assignment.status === 'archived') return false;
            const createdAt = Date.parse(assignment.createdAt);
            return Number.isFinite(createdAt)
                && Number.isFinite(currentCreatedAt)
                && createdAt < currentCreatedAt;
        })
        .map((assignment) => {
            const classProgress = assignment.classProgress.find(
                (row) => (row.classId || null) === classId,
            );
            if (
                !classProgress
                || classProgress.correctRate === null
                || classProgress.attemptCount <= 0
            ) {
                return null;
            }
            return {
                assignmentId: assignment.id,
                title: assignment.title,
                correctRate: classProgress.correctRate,
                createdAt: assignment.createdAt,
            } satisfies AssignmentPerformanceBenchmark;
        })
        .filter((row): row is AssignmentPerformanceBenchmark => row !== null)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

    const recentAssignments = history.slice(0, 5);
    const recentClassAverage = recentAssignments.length > 0
        ? Math.round(
            recentAssignments.reduce((sum, assignment) => sum + assignment.correctRate, 0)
            / recentAssignments.length,
        )
        : null;

    return {
        currentCorrectRate,
        previousAssignment: history[0] || null,
        recentClassAverage,
        recentAssignmentCount: recentAssignments.length,
    };
}
