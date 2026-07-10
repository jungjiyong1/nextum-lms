'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    ArchiveX,
    BarChart3,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ClipboardList,
    FileText,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Trash2,
    UserMinus,
    UserPlus,
    Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DataTable,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/data-table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { FormField, FormSection } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { sortByProblemOrder } from '@/lib/lms/problem-order';
import {
    clearLearningAnalysisAssignmentDraft,
    readLearningAnalysisAssignmentDraft,
    type LearningAnalysisAssignmentDraft,
} from '@/lib/lms/learning-analysis-draft';
import { cn } from '@/lib/utils';
import {
    addAssignmentRecipients,
    addLmsInvalidationListener,
    createLearningAssignment,
    deleteAssignment,
    importWorksheetAssignment,
    loadAssignmentDetail,
    loadAssignmentManagementData,
    recallAssignment,
    removeAssignmentRecipient,
} from './service';
import { loadAssignmentProblemCatalog } from './problem-catalog-client';
import type {
    AssignmentClassProgressSummary,
    AssignmentManagementData,
    AssignmentProblemSummary,
    AssignmentProblemTypeSummary,
    AssignmentRecipientProgress,
    AssignmentUnitSummary,
    CreateLearningAssignmentInput,
    LearningAssignmentDetail,
    LearningAssignmentSummary,
    StudentSummary,
} from './types';

type AssignmentPageLoadOptions = { force?: boolean; background?: boolean };
type AssignmentStatusFilter = 'all' | 'open' | 'due_soon' | 'overdue' | 'completed' | 'recalled';
type ProgressStatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed';
type AssignmentManageTab = 'manage' | 'deploy';

const statusFilterOptions: Array<{ value: AssignmentStatusFilter; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'open', label: '진행중' },
    { value: 'due_soon', label: '기한 임박' },
    { value: 'overdue', label: '기한 지남' },
    { value: 'completed', label: '완료' },
    { value: 'recalled', label: '회수됨' },
];

const progressStatusOptions: Array<{ value: ProgressStatusFilter; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'not_started', label: '미시작' },
    { value: 'in_progress', label: '진행중' },
    { value: 'completed', label: '완료' },
];

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function toDueIso(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}

function formatDate(value: string | null): string {
    if (!value) return '기한 없음';
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function shortDate(value: string | null): string {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'short',
        day: 'numeric',
    }).format(new Date(value));
}

function dueStatus(assignment: LearningAssignmentSummary): AssignmentStatusFilter {
    if (!assignment.active || assignment.status === 'archived') return 'recalled';
    if (assignment.progress.targetStudentCount > 0 && assignment.progress.completedCount === assignment.progress.targetStudentCount) {
        return 'completed';
    }
    if (!assignment.dueAt) return 'open';
    const due = new Date(assignment.dueAt).getTime();
    const now = Date.now();
    if (due < now) return 'overdue';
    if (due - now <= 3 * 24 * 60 * 60 * 1000) return 'due_soon';
    return 'open';
}

function dueLabel(status: AssignmentStatusFilter): string {
    if (status === 'completed') return '완료';
    if (status === 'recalled') return '회수됨';
    if (status === 'overdue') return '기한 지남';
    if (status === 'due_soon') return '기한 임박';
    return '진행중';
}

function dueTone(status: AssignmentStatusFilter): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' {
    if (status === 'completed') return 'success';
    if (status === 'recalled') return 'neutral';
    if (status === 'overdue') return 'danger';
    if (status === 'due_soon') return 'warning';
    return 'primary';
}

function problemLabel(problem: AssignmentProblemSummary): string {
    return [`p.${problem.pagePrinted}`, problem.number, problem.typeName || problem.conceptName]
        .filter(Boolean)
        .join(' · ');
}

function problemChipLabel(problem: AssignmentProblemSummary): string {
    return [problem.number, problem.typeName || problem.conceptName]
        .filter(Boolean)
        .join(' · ');
}

function normalizedProblemLabel(value: string | null): string {
    return (value || '').replace(/\s+/g, '');
}

function isConceptPracticeProblem(problem: AssignmentProblemSummary): boolean {
    return [problem.typeName, problem.conceptName]
        .map(normalizedProblemLabel)
        .some((label) => label.includes('쏙쏙개념익히기'));
}

function toggleSetValue(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
}

function ProgressLine({ value }: { value: number }) {
    return (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
    );
}

function metricText(value: number | null): string {
    return value === null ? '-' : `${value}%`;
}

function classLabel(classProgress: AssignmentClassProgressSummary): string {
    return classProgress.className || '개별 학생';
}



function AssignmentProgressSummary({ assignment }: { assignment: LearningAssignmentSummary }) {
    const progress = assignment.progress;
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{progress.completedCount}/{progress.targetStudentCount}명 완료</span>
                <span>{progress.completionRate}%</span>
            </div>
            <ProgressLine value={progress.completionRate} />
            <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-muted px-2 py-1.5">
                    <p className="text-muted-foreground">미시작</p>
                    <p className="font-semibold text-foreground">{progress.notStartedCount}</p>
                </div>
                <div className="rounded-lg bg-muted px-2 py-1.5">
                    <p className="text-muted-foreground">진행중</p>
                    <p className="font-semibold text-foreground">{progress.inProgressCount}</p>
                </div>
                <div className="rounded-lg bg-muted px-2 py-1.5">
                    <p className="text-muted-foreground">정답률</p>
                    <p className="font-semibold text-foreground">{metricText(progress.correctRate)}</p>
                </div>
            </div>
        </div>
    );
}

function AssignmentCard({
    assignment,
    selected,
    classContext,
    onSelect,
}: {
    assignment: LearningAssignmentSummary;
    selected: boolean;
    classContext?: AssignmentClassProgressSummary | null;
    onSelect: () => void;
}) {
    const status = dueStatus(assignment);
    const progress = classContext || assignment.progress;
    return (
        <SelectableCard
            selected={selected}
            onClick={onSelect}
            className={cn(
                'space-y-3 border-l-4 p-3',
                selected ? 'border-l-primary' : 'border-l-transparent',
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{assignment.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{assignment.bookTitle || '외부 학습지'}</span>
                        <span>·</span>
                        <span>{assignment.problemCount}문항</span>
                        <span>·</span>
                        <span>{formatDate(assignment.dueAt)}</span>
                    </div>
                </div>
                <StatusBadge className="shrink-0 whitespace-nowrap" tone={dueTone(status)} label={dueLabel(status)} />
            </div>
            {classContext && (
                <StatusBadge tone="primary" label={classLabel(classContext)} />
            )}
            <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{progress.completedCount}/{progress.targetStudentCount}명 완료</span>
                    <span>{progress.completionRate}%</span>
                </div>
                <ProgressLine value={progress.completionRate} />
            </div>
            {!classContext && assignment.classProgress.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {assignment.classProgress.slice(0, 3).map((row) => (
                        <StatusBadge key={row.classId || row.className} tone="neutral" label={`${classLabel(row)} ${row.completedCount}/${row.targetStudentCount}`} />
                    ))}
                    {assignment.classProgress.length > 3 && <StatusBadge tone="neutral" label={`+${assignment.classProgress.length - 3}`} />}
                </div>
            )}
        </SelectableCard>
    );
}


function selectedProblemIds(
    problems: AssignmentProblemSummary[],
    wholeBook: boolean,
    selectedUnitIds: Set<string>,
    selectedTypeIds: Set<string>,
    excludedProblemIds: Set<string>,
): string[] {
    if (wholeBook) return problems.filter((problem) => !excludedProblemIds.has(problem.id)).map((problem) => problem.id);
    if (selectedUnitIds.size === 0) return [];
    return problems
        .filter((problem) => (
            selectedUnitIds.has(problem.unitId)
            && (
                selectedTypeIds.size === 0
                || !problem.problemTypeId
                || selectedTypeIds.has(problem.problemTypeId)
            )
            && !excludedProblemIds.has(problem.id)
        ))
        .map((problem) => problem.id);
}

function groupProblemsByPage(problems: AssignmentProblemSummary[]): Array<{ pagePrinted: number; problems: AssignmentProblemSummary[] }> {
    const groups = new Map<number, AssignmentProblemSummary[]>();
    for (const problem of problems) {
        const pageProblems = groups.get(problem.pagePrinted) ?? [];
        pageProblems.push(problem);
        groups.set(problem.pagePrinted, pageProblems);
    }
    return [...groups.entries()].map(([pagePrinted, pageProblems]) => ({
        pagePrinted,
        problems: pageProblems,
    }));
}

type AssignmentUnitProblemRow = {
    unit: AssignmentUnitSummary;
    problems: AssignmentProblemSummary[];
    types: AssignmentProblemTypeSummary[];
    pageGroups: Array<{ pagePrinted: number; problems: AssignmentProblemSummary[] }>;
    selectedCount: number;
    conceptPracticeCount: number;
    totalCount: number | null;
    nextCursor: string | null;
    hasMore: boolean;
    loading: boolean;
    loaded: boolean;
    error: string | null;
};

type UnitProblemCatalogState = {
    items: AssignmentProblemSummary[];
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number | null;
    loading: boolean;
    loaded: boolean;
    error: string | null;
};

function unitCatalogKey(bookId: string, unitId: string): string {
    return `${bookId}\u0000${unitId}`;
}

function AssignmentComposer({
    data,
    submitting,
    initialDraft,
    onCancel,
    onSubmit,
}: {
    data: AssignmentManagementData;
    submitting: boolean;
    initialDraft?: LearningAnalysisAssignmentDraft | null;
    onCancel: () => void;
    onSubmit: (input: CreateLearningAssignmentInput, file: File | null) => Promise<void>;
}) {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [title, setTitle] = useState(initialDraft?.title ?? '');
    const [dueAt, setDueAt] = useState('');
    const [bookId, setBookId] = useState(data.books[0]?.id || '');
    const [wholeBook, setWholeBook] = useState(false);
    const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
    const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
    const [excludedProblemIds, setExcludedProblemIds] = useState<Set<string>>(new Set());
    const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(() => {
        const firstUnitId = data.books[0]?.units[0]?.id;
        return firstUnitId ? new Set([firstUnitId]) : new Set();
    });
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
    const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
        () => new Set(initialDraft?.studentIds ?? []),
    );
    const [excludedStudentIds, setExcludedStudentIds] = useState<Set<string>>(new Set());
    const [studentSearch, setStudentSearch] = useState('');
    const [unitCatalogs, setUnitCatalogs] = useState<Map<string, UnitProblemCatalogState>>(() => new Map());
    const catalogRequestSequence = useRef(new Map<string, number>());
    const catalogControllers = useRef(new Map<string, AbortController>());

    useEffect(() => {
        if (!initialDraft) return;
        const activeStudentIds = new Set(
            data.students
                .filter((student) => student.status === 'active')
                .map((student) => student.id),
        );
        setTitle(initialDraft.title);
        setSelectedStudentIds(new Set(
            initialDraft.studentIds.filter((studentId) => activeStudentIds.has(studentId)),
        ));
    }, [data.students, initialDraft]);

    const selectedBook = data.books.find((book) => book.id === bookId) || null;
    const loadUnitProblems = useCallback(async (unitId: string, cursor: string | null = null) => {
        if (!academyId || !bookId) return;
        const key = unitCatalogKey(bookId, unitId);
        catalogControllers.current.get(key)?.abort();
        const controller = new AbortController();
        catalogControllers.current.set(key, controller);
        const sequence = (catalogRequestSequence.current.get(key) || 0) + 1;
        catalogRequestSequence.current.set(key, sequence);
        setUnitCatalogs((current) => {
            const next = new Map(current);
            const previous = next.get(key);
            next.set(key, {
                items: previous?.items || [],
                nextCursor: previous?.nextCursor || null,
                hasMore: previous?.hasMore || false,
                totalCount: previous?.totalCount ?? null,
                loading: true,
                loaded: previous?.loaded || false,
                error: null,
            });
            return next;
        });

        try {
            const page = await loadAssignmentProblemCatalog({
                academyId,
                bookId,
                unitId,
                cursor,
                limit: 50,
                signal: controller.signal,
            });
            if (catalogRequestSequence.current.get(key) !== sequence) return;
            setUnitCatalogs((current) => {
                const next = new Map(current);
                const previous = next.get(key);
                const items = cursor
                    ? [...new Map([...(previous?.items || []), ...page.items].map((item) => [item.id, item])).values()]
                    : page.items;
                next.set(key, {
                    items: sortByProblemOrder(items),
                    nextCursor: page.nextCursor,
                    hasMore: page.hasMore,
                    totalCount: page.totalCount ?? previous?.totalCount ?? null,
                    loading: false,
                    loaded: true,
                    error: null,
                });
                return next;
            });
        } catch (error) {
            if (controller.signal.aborted || catalogRequestSequence.current.get(key) !== sequence) return;
            setUnitCatalogs((current) => {
                const next = new Map(current);
                const previous = next.get(key);
                next.set(key, {
                    items: previous?.items || [],
                    nextCursor: previous?.nextCursor || null,
                    hasMore: previous?.hasMore || false,
                    totalCount: previous?.totalCount ?? null,
                    loading: false,
                    loaded: previous?.loaded || false,
                    error: error instanceof Error ? error.message : '문제 목록을 불러오지 못했습니다.',
                });
                return next;
            });
        } finally {
            if (catalogControllers.current.get(key) === controller) catalogControllers.current.delete(key);
        }
    }, [academyId, bookId]);

    useEffect(() => () => {
        for (const controller of catalogControllers.current.values()) controller.abort();
        catalogControllers.current.clear();
    }, [bookId]);

    const firstSelectedUnitId = selectedBook?.units[0]?.id;
    useEffect(() => {
        if (firstSelectedUnitId) void loadUnitProblems(firstSelectedUnitId);
    }, [firstSelectedUnitId, loadUnitProblems]);

    const orderedBookProblems = useMemo(
        () => selectedBook
            ? sortByProblemOrder(selectedBook.units.flatMap((unit) => (
                unitCatalogs.get(unitCatalogKey(selectedBook.id, unit.id))?.items || []
            )))
            : [],
        [selectedBook, unitCatalogs],
    );
    const previewProblemIds = useMemo(
        () => selectedProblemIds(orderedBookProblems, wholeBook, selectedUnitIds, selectedTypeIds, excludedProblemIds),
        [excludedProblemIds, orderedBookProblems, selectedTypeIds, selectedUnitIds, wholeBook],
    );
    const previewProblemIdSet = useMemo(() => new Set(previewProblemIds), [previewProblemIds]);
    const problemTypesByUnit = useMemo(() => {
        const grouped = new Map<string, AssignmentProblemTypeSummary[]>();
        for (const type of selectedBook?.problemTypes || []) {
            if (!type.unitId) continue;
            const types = grouped.get(type.unitId) || [];
            types.push(type);
            grouped.set(type.unitId, types);
        }
        return grouped;
    }, [selectedBook]);
    const unitProblemRows = useMemo<AssignmentUnitProblemRow[]>(() => {
        if (!selectedBook) return [];
        return selectedBook.units.map((unit) => {
            const catalog = unitCatalogs.get(unitCatalogKey(selectedBook.id, unit.id));
            const problems = catalog?.items || [];
            const types = problemTypesByUnit.get(unit.id) || [];
            return {
                unit,
                problems,
                types,
                pageGroups: groupProblemsByPage(problems),
                selectedCount: problems.filter((problem) => previewProblemIdSet.has(problem.id)).length,
                conceptPracticeCount: problems.filter(isConceptPracticeProblem).length,
                totalCount: catalog?.totalCount ?? null,
                nextCursor: catalog?.nextCursor || null,
                hasMore: catalog?.hasMore || false,
                loading: catalog?.loading || false,
                loaded: catalog?.loaded || false,
                error: catalog?.error || null,
            };
        });
    }, [previewProblemIdSet, problemTypesByUnit, selectedBook, unitCatalogs]);
    const selectedClassStudents = useMemo(() => {
        const classIds = selectedClassIds;
        return data.students.filter((student) => student.status === 'active' && student.classIds.some((classId) => classIds.has(classId)));
    }, [data.students, selectedClassIds]);
    const effectiveStudents = useMemo(() => {
        const map = new Map<string, StudentSummary>();
        for (const student of selectedClassStudents) {
            if (!excludedStudentIds.has(student.id)) map.set(student.id, student);
        }
        for (const student of data.students) {
            if (selectedStudentIds.has(student.id) && !excludedStudentIds.has(student.id)) map.set(student.id, student);
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }, [data.students, excludedStudentIds, selectedClassStudents, selectedStudentIds]);
    const studentCandidates = useMemo(() => {
        const query = studentSearch.trim().toLowerCase();
        return data.students
            .filter((student) => student.status === 'active')
            .filter((student) => !query || `${student.name} ${student.classNames.join(' ')}`.toLowerCase().includes(query))
            .slice(0, 80);
    }, [data.students, studentSearch]);
    const selectedClassNames = useMemo(
        () => data.classes
            .filter((row) => selectedClassIds.has(row.id))
            .map((row) => row.name),
        [data.classes, selectedClassIds],
    );
    const materialLabel = selectedBook?.title || '문제집 미선택';
    const problemSummary = wholeBook ? '전체 문제집' : `${selectedUnitIds.size}개 단원 범위`;
    const dueSummary = dueAt ? formatDate(toDueIso(dueAt)) : '기한 없음';

    const resetScope = () => {
        setWholeBook(false);
        setSelectedUnitIds(new Set());
        setSelectedTypeIds(new Set());
        setExcludedProblemIds(new Set());
    };

    const setExpandedUnit = (unitId: string, expanded: boolean) => {
        setExpandedUnitIds((current) => {
            const next = new Set(current);
            if (expanded) next.add(unitId);
            else next.delete(unitId);
            return next;
        });
        if (expanded) {
            const catalog = unitCatalogs.get(unitCatalogKey(bookId, unitId));
            if (!catalog?.loaded && !catalog?.loading) void loadUnitProblems(unitId);
        }
    };

    const selectUnitProblems = (
        unitId: string,
        problems: AssignmentProblemSummary[],
        types: AssignmentProblemTypeSummary[],
    ) => {
        setWholeBook(false);
        setExpandedUnit(unitId, true);
        setSelectedUnitIds((current) => new Set([...current, unitId]));
        setSelectedTypeIds((current) => new Set([...current, ...types.map((type) => type.id)]));
        setExcludedProblemIds((current) => {
            const next = new Set(current);
            problems.forEach((problem) => next.delete(problem.id));
            return next;
        });
    };

    const clearUnitProblems = (
        unitId: string,
        problems: AssignmentProblemSummary[],
        types: AssignmentProblemTypeSummary[],
    ) => {
        setWholeBook(false);
        setSelectedUnitIds((current) => {
            const next = new Set(current);
            next.delete(unitId);
            return next;
        });
        setSelectedTypeIds((current) => {
            const next = new Set(current);
            types.forEach((type) => next.delete(type.id));
            return next;
        });
        setExcludedProblemIds((current) => {
            const next = new Set(current);
            problems.forEach((problem) => next.delete(problem.id));
            return next;
        });
    };

    const toggleUnitSelection = (row: AssignmentUnitProblemRow) => {
        if (selectedUnitIds.has(row.unit.id)) clearUnitProblems(row.unit.id, row.problems, row.types);
        else selectUnitProblems(row.unit.id, row.problems, row.types);
    };

    const includeProblems = (problems: AssignmentProblemSummary[]) => {
        if (problems.length === 0) return;
        setWholeBook(false);
        setSelectedUnitIds((current) => new Set([...current, ...problems.map((problem) => problem.unitId)]));
        setSelectedTypeIds((current) => {
            const next = new Set(current);
            problems.forEach((problem) => {
                if (problem.problemTypeId) next.add(problem.problemTypeId);
            });
            return next;
        });
        setExcludedProblemIds((current) => {
            const next = new Set(current);
            problems.forEach((problem) => next.delete(problem.id));
            return next;
        });
    };

    const excludeProblems = (problems: AssignmentProblemSummary[]) => {
        if (problems.length === 0) return;
        setWholeBook(false);
        setExcludedProblemIds((current) => {
            const next = new Set(current);
            problems.forEach((problem) => next.add(problem.id));
            return next;
        });
    };

    const toggleProblem = (problem: AssignmentProblemSummary) => {
        if (!selectedUnitIds.has(problem.unitId)) {
            toast.info('먼저 단원 범위를 선택한 뒤 제외할 문항을 조정하세요.');
            return;
        }
        if (previewProblemIdSet.has(problem.id)) excludeProblems([problem]);
        else includeProblems([problem]);
    };

    const selectConceptPracticeProblemsOnly = (row: AssignmentUnitProblemRow) => {
        const conceptProblems = row.problems.filter(isConceptPracticeProblem);
        if (conceptProblems.length === 0) {
            toast.error(`${row.unit.name}에는 쏙쏙개념익히기 문제가 없습니다.`);
            return;
        }

        const conceptProblemIds = new Set(conceptProblems.map((problem) => problem.id));
        setWholeBook(false);
        setExpandedUnit(row.unit.id, true);
        setSelectedUnitIds((current) => new Set([...current, row.unit.id]));
        setSelectedTypeIds((current) => {
            const next = new Set(current);
            row.types.forEach((type) => next.delete(type.id));
            conceptProblems.forEach((problem) => {
                if (problem.problemTypeId) next.add(problem.problemTypeId);
            });
            return next;
        });
        setExcludedProblemIds((current) => {
            const next = new Set(current);
            row.problems.forEach((problem) => next.delete(problem.id));
            row.problems
                .filter((problem) => !conceptProblemIds.has(problem.id))
                .forEach((problem) => next.add(problem.id));
            return next;
        });
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!title.trim()) {
            toast.error('과제명을 입력하세요.');
            return;
        }
        if (effectiveStudents.length === 0) {
            toast.error('대상 반 또는 학생을 선택하세요.');
            return;
        }
        if (initialDraft) {
            const expectedStudentIds = new Set(initialDraft.studentIds);
            const selectedStudentIds = new Set(effectiveStudents.map((student) => student.id));
            if (
                selectedStudentIds.size !== expectedStudentIds.size
                || [...expectedStudentIds].some((studentId) => !selectedStudentIds.has(studentId))
            ) {
                toast.error('학습 분석 초안은 조치 항목의 학생 구성을 유지해야 합니다. 대상 변경은 새 초안에서 해 주세요.');
                return;
            }
        }
        if (!bookId) {
            toast.error('문제집을 선택하세요.');
            return;
        }
        if (!wholeBook && selectedUnitIds.size === 0 && selectedTypeIds.size === 0) {
            toast.error('배정할 문제 범위를 선택하세요.');
            return;
        }

        await onSubmit({
            title: title.trim(),
            description: initialDraft
                ? `학습 분석 확인: ${initialDraft.skillNames.join(', ')}`
                : null,
            dueAt: toDueIso(dueAt),
            context: initialDraft ? 'diagnostic' : 'homework',
            sourceType: 'content_scope',
            bookId,
            unitIds: !wholeBook ? [...selectedUnitIds] : [],
            problemTypeIds: !wholeBook ? [...selectedTypeIds] : [],
            problemIds: [],
            excludedProblemIds: [...excludedProblemIds],
            classIds: initialDraft ? [] : [...selectedClassIds],
            studentIds: initialDraft ? initialDraft.studentIds : [...selectedStudentIds],
            excludedStudentIds: initialDraft ? [] : [...excludedStudentIds],
            learningAnalysisActions: initialDraft?.actions.map((action) => ({
                actionId: action.id,
                studentId: action.studentId,
                skillId: action.skillId,
            })),
        }, null);
    };

    return (
        <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
                    {initialDraft && (
                        <div className="rounded-lg border border-primary/25 bg-primary-soft p-4 text-sm" role="status">
                            <p className="font-medium text-foreground">학습 분석에서 과제 초안을 불러왔습니다.</p>
                            <p className="mt-1 text-muted-foreground">
                                {initialDraft.studentIds.length}명 · {initialDraft.skillNames.join(' · ')}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                학생만 미리 선택했습니다. 문제집과 문제 범위는 근거를 확인한 뒤 직접 선택해야 하며,
                                아래 배포 버튼을 누르기 전에는 학생에게 전송되지 않습니다.
                            </p>
                        </div>
                    )}
                    <FormSection title="기본 정보">
                        <div className="grid gap-3 md:grid-cols-2">
                            <FormField label="과제명">
                                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="2단원 유형 복습" />
                            </FormField>
                            <FormField label="기한">
                                <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                            </FormField>
                        </div>
                    </FormSection>

                    <FormSection title="문제 범위" description="선택 범위는 서버에서 계산하며, 문항 목록은 50개씩 불러옵니다.">
                            {data.books.length === 0 ? (
                                <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                                    등록된 문제집이 아직 없습니다. 문제집을 먼저 등록한 뒤 과제를 배포하세요.
                                </div>
                            ) : (
                                <FormField label="문제집">
                                    <Select
                                        value={bookId}
                                        onValueChange={(value) => {
                                            setBookId(value);
                                            const nextBook = data.books.find((book) => book.id === value);
                                            setExpandedUnitIds(new Set(nextBook?.units[0]?.id ? [nextBook.units[0].id] : []));
                                            resetScope();
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="문제집 선택" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {data.books.map((book) => <SelectItem key={book.id} value={book.id}>{book.title}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormField>
                            )}

                            {selectedBook && (
                                <>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant={wholeBook ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => {
                                                setWholeBook((value) => !value);
                                                setSelectedUnitIds(new Set());
                                                setSelectedTypeIds(new Set());
                                                setExcludedProblemIds(new Set());
                                            }}
                                        >
                                                전체 문제집
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" onClick={resetScope}>범위 초기화</Button>
                                    </div>
                                    {!wholeBook && (
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div>
                                                    <div className="text-sm font-semibold text-foreground">단원별 문제 선택</div>
                                                     <div className="text-xs text-muted-foreground">단원 전체 범위를 선택한 뒤 펼친 목록에서 예외 문항을 제외합니다.</div>
                                                </div>
                                                <StatusBadge tone="primary" label={`${selectedUnitIds.size}개 단원 선택`} />
                                            </div>
                                            <div className="max-h-[38rem] space-y-2 overflow-auto rounded-lg border bg-card p-2">
                                                {unitProblemRows.map((row) => {
                                                    const expanded = expandedUnitIds.has(row.unit.id);
                                                    const selected = selectedUnitIds.has(row.unit.id);
                                                    const hasProblems = !row.loaded || row.totalCount === null || row.totalCount > 0;

                                                    return (
                                                        <section key={row.unit.id} className="rounded-lg border border-border bg-background">
                                                            <div className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                                                                <div className="flex min-w-0 items-start gap-2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon-sm"
                                                                        className="mt-0.5 shrink-0"
                                                                        aria-label={expanded ? `${row.unit.name} 접기` : `${row.unit.name} 펼치기`}
                                                                        aria-expanded={expanded}
                                                                        onClick={() => setExpandedUnit(row.unit.id, !expanded)}
                                                                    >
                                                                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                                    </Button>
                                                                    <Checkbox
                                                                        className="mt-1"
                                                                        checked={selected}
                                                                        disabled={!hasProblems && row.loaded}
                                                                        onCheckedChange={() => toggleUnitSelection(row)}
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        className="h-auto min-w-0 flex-1 flex-col items-start gap-0 whitespace-normal p-0 text-left hover:bg-transparent"
                                                                        onClick={() => setExpandedUnit(row.unit.id, !expanded)}
                                                                    >
                                                                        <span className="block truncate text-sm font-semibold text-foreground">{row.unit.name}</span>
                                                                        <span className="mt-0.5 block text-xs text-muted-foreground">
                                                                            {row.loaded
                                                                                ? `${row.selectedCount}/${row.totalCount ?? row.problems.length}문항 선택`
                                                                                : '펼치면 문제를 불러옵니다'}
                                                                        </span>
                                                                    </Button>
                                                                </div>
                                                                <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="xs"
                                                                        disabled={!hasProblems && row.loaded}
                                                                        onClick={() => selectUnitProblems(row.unit.id, row.problems, row.types)}
                                                                    >
                                                                        전체
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="xs"
                                                                        disabled={row.conceptPracticeCount === 0}
                                                                        onClick={() => selectConceptPracticeProblemsOnly(row)}
                                                                    >
                                                                        쏙쏙개념익히기
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="xs"
                                                                        disabled={!selected}
                                                                        onClick={() => clearUnitProblems(row.unit.id, row.problems, row.types)}
                                                                    >
                                                                        해제
                                                                    </Button>
                                                                    <StatusBadge
                                                                        tone={selected ? 'primary' : 'neutral'}
                                                                        label={selected ? '단원 선택' : `${row.problems.length}개 불러옴`}
                                                                    />
                                                                </div>
                                                            </div>

                                                            {expanded && (
                                                                <div className="border-t border-border p-3">
                                                                    {row.loading && row.problems.length === 0 ? (
                                                                        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">문제 목록을 불러오는 중입니다.</p>
                                                                    ) : row.error && row.problems.length === 0 ? (
                                                                        <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                                                                            <span>{row.error}</span>
                                                                            <Button type="button" variant="outline" size="xs" onClick={() => void loadUnitProblems(row.unit.id)}>
                                                                                다시 시도
                                                                            </Button>
                                                                        </div>
                                                                    ) : row.problems.length === 0 ? (
                                                                        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">이 단원에 선택 가능한 문제가 없습니다.</p>
                                                                    ) : (
                                                                        <div className="space-y-3">
                                                                                {row.pageGroups.map((group) => {
                                                                                    const selectedInPage = group.problems.filter((problem) => previewProblemIdSet.has(problem.id)).length;
                                                                                    return (
                                                                                        <div key={`${row.unit.id}-${group.pagePrinted}`} className="rounded-lg border border-border bg-card p-2">
                                                                                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <span className="text-sm font-semibold text-foreground">p.{group.pagePrinted}</span>
                                                                                                    <span className="text-xs text-muted-foreground">{selectedInPage}/{group.problems.length}</span>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <Button type="button" variant="outline" size="xs" onClick={() => includeProblems(group.problems)}>
                                                                                                        전체 선택
                                                                                                    </Button>
                                                                                                    <Button type="button" variant="ghost" size="xs" onClick={() => excludeProblems(group.problems)}>
                                                                                                        전체 제외
                                                                                                    </Button>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5">
                                                                                                {group.problems.map((problem) => {
                                                                                                    const included = previewProblemIdSet.has(problem.id);
                                                                                                    return (
                                                                                                        <Button
                                                                                                            key={problem.id}
                                                                                                            type="button"
                                                                                                            variant={included ? 'secondary' : 'outline'}
                                                                                                            size="xs"
                                                                                                            title={problemLabel(problem)}
                                                                                                            aria-pressed={included}
                                                                                                            onClick={() => toggleProblem(problem)}
                                                                                                            className={cn(
                                                                                                                'h-auto min-h-12 justify-start whitespace-normal px-2 py-2 text-left',
                                                                                                                included && 'border-primary/35 bg-primary-soft text-primary-strong hover:bg-primary-soft',
                                                                                                                !included && 'text-muted-foreground',
                                                                                                            )}
                                                                                                        >
                                                                                                            <span className="min-w-0">
                                                                                                                <span className="line-clamp-2 block text-xs font-semibold leading-snug">{problemChipLabel(problem)}</span>
                                                                                                            </span>
                                                                                                        </Button>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                                {row.hasMore && row.nextCursor && (
                                                                                    <div className="flex justify-center pt-1">
                                                                                        <Button
                                                                                            type="button"
                                                                                            variant="outline"
                                                                                            size="sm"
                                                                                            disabled={row.loading}
                                                                                            onClick={() => void loadUnitProblems(row.unit.id, row.nextCursor)}
                                                                                        >
                                                                                            {row.loading ? '불러오는 중' : '문제 더 불러오기'}
                                                                                        </Button>
                                                                                    </div>
                                                                                )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </section>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                    </FormSection>

                    <FormSection title="대상" description={`${[...selectedClassIds].length}개 반, ${effectiveStudents.length}명 대상`}>
                        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                            <div>
                                <div className="mb-2 text-sm font-semibold">반</div>
                                <div className="max-h-60 space-y-1 overflow-auto rounded-lg border bg-card p-2">
                                    {data.classes.filter((row) => row.active).map((row) => (
                                        <label key={row.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted">
                                            <Checkbox checked={selectedClassIds.has(row.id)} onCheckedChange={() => toggleSetValue(setSelectedClassIds, row.id)} />
                                            <span>{row.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-sm font-semibold">학생</span>
                                    <span className="text-xs text-muted-foreground">반 학생은 자동 포함, 필요 시 제외</span>
                                </div>
                                <div className="relative mb-2">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input className="pl-9" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="개별 학생 검색" />
                                </div>
                                <div className="max-h-60 space-y-1 overflow-auto rounded-lg border bg-card p-2">
                                    {studentCandidates.map((student) => {
                                        const fromClass = selectedClassStudents.some((row) => row.id === student.id);
                                        const checked = (fromClass || selectedStudentIds.has(student.id)) && !excludedStudentIds.has(student.id);
                                        return (
                                            <label key={student.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                                                <Checkbox
                                                    checked={checked}
                                                    onCheckedChange={() => {
                                                        if (fromClass) toggleSetValue(setExcludedStudentIds, student.id);
                                                        else toggleSetValue(setSelectedStudentIds, student.id);
                                                    }}
                                                />
                                                <span>
                                                    {student.name}
                                                    <span className="ml-1 text-xs text-muted-foreground">{student.classNames.join(', ') || '반 없음'}</span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg bg-muted p-3 text-sm">
                            <div className="font-semibold text-foreground">배포 후 대상 스냅샷</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                반 이동이 있어도 이 과제의 대상 수는 유지됩니다. 새 반원은 과제 상세에서 수동으로 추가할 수 있습니다.
                            </p>
                        </div>
                    </FormSection>

            </div>

            <aside className="self-start rounded-xl border border-border bg-card p-4 xl:sticky xl:top-6">
                <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">배정 요약</h2>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                    <div className="rounded-lg bg-muted/60 p-3">
                        <p className="text-xs font-medium text-muted-foreground">문제집</p>
                        <p className="mt-1 truncate font-semibold text-foreground">{materialLabel}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-border p-3">
                            <p className="text-xs text-muted-foreground">문항</p>
                            <p className="mt-1 font-semibold text-foreground">{problemSummary}</p>
                        </div>
                        <div className="rounded-lg border border-border p-3">
                            <p className="text-xs text-muted-foreground">대상</p>
                            <p className="mt-1 font-semibold text-foreground">{effectiveStudents.length}명</p>
                        </div>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">기한</p>
                        <p className="mt-1 font-semibold text-foreground">{dueSummary}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">반</p>
                        <p className="mt-1 line-clamp-2 text-sm text-foreground">
                            {selectedClassNames.length ? selectedClassNames.join(', ') : '개별 학생만 선택'}
                        </p>
                    </div>
                </div>
                <div className="mt-4 space-y-2">
                    <Button type="submit" className="w-full" disabled={submitting}>
                        {submitting ? '배포 중' : '과제 배포'}
                    </Button>
                    <Button type="button" variant="outline" className="w-full" onClick={onCancel}>
                        취소
                    </Button>
                </div>
            </aside>
        </form>
    );
}

function statusBadgeForRecipient(row: AssignmentRecipientProgress) {
    if (row.status === 'completed') return <StatusBadge tone="success" label="완료" />;
    if (row.status === 'in_progress') return <StatusBadge tone="warning" label="진행중" />;
    return <StatusBadge tone="neutral" label="미시작" />;
}



function AssignmentManagementList({
    assignments,
    permissions,
    recallingAssignmentId,
    deletingAssignmentId,
    onRecall,
    onDelete,
}: {
    assignments: LearningAssignmentSummary[];
    permissions: AssignmentManagementData['permissions'];
    recallingAssignmentId: string;
    deletingAssignmentId: string;
    onRecall: (assignmentId: string) => void;
    onDelete: (assignmentId: string) => void;
}) {
    if (assignments.length === 0) {
        return <EmptyState title="배포된 과제가 없습니다." description="새 과제 배포에서 학생에게 보낼 과제를 만드세요." />;
    }

    return (
        <DataTable>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>과제</TableHead>
                        <TableHead>대상</TableHead>
                        <TableHead>진행</TableHead>
                        <TableHead>기한</TableHead>
                        <TableHead>상태</TableHead>
                        <TableHead>관리</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {assignments.map((assignment) => {
                        const status = dueStatus(assignment);
                        const recalled = status === 'recalled';
                        const targetText = recalled
                            ? '회수됨'
                            : assignment.targetLabels.slice(0, 2).join(', ') || `${assignment.progress.targetStudentCount}명`;
                        const targetMore = assignment.targetLabels.length > 2 ? ` 외 ${assignment.targetLabels.length - 2}` : '';
                        return (
                            <TableRow key={assignment.id}>
                                <TableCell className="min-w-[220px]">
                                    <p className="font-medium text-foreground">{assignment.title}</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        {assignment.bookTitle || '외부 학습지'} · {assignment.problemCount}문항
                                    </p>
                                </TableCell>
                                <TableCell className="max-w-[220px]">
                                    <span className="line-clamp-2 text-sm text-foreground">{targetText}{targetMore}</span>
                                </TableCell>
                                <TableCell className="min-w-[150px]">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                            <span>{assignment.progress.completedCount}/{assignment.progress.targetStudentCount}명</span>
                                            <span>{assignment.progress.completionRate}%</span>
                                        </div>
                                        <ProgressLine value={assignment.progress.completionRate} />
                                    </div>
                                </TableCell>
                                <TableCell>{formatDate(assignment.dueAt)}</TableCell>
                                <TableCell><StatusBadge tone={dueTone(status)} label={dueLabel(status)} /></TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {permissions.canRecall && !recalled && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={recallingAssignmentId === assignment.id || deletingAssignmentId === assignment.id}
                                                onClick={() => onRecall(assignment.id)}
                                            >
                                                <ArchiveX className="h-4 w-4" />
                                                회수
                                            </Button>
                                        )}
                                        {permissions.canDelete && (
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="sm"
                                                disabled={recallingAssignmentId === assignment.id || deletingAssignmentId === assignment.id}
                                                onClick={() => onDelete(assignment.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                삭제
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </DataTable>
    );
}

function AssignmentDetailPanel({
    detail,
    loading,
    error,
    classContextId,
    classContextName,
    studentProgressFilter = 'all',
    canManageRecipients,
    canRecall,
    recalling,
    addingRecipients,
    removingStudentId,
    onRetry,
    onAddRecipients,
    onRemoveRecipient,
    onRecall,
}: {
    detail: LearningAssignmentDetail | null;
    loading: boolean;
    error: string | null;
    classContextId?: string | null;
    classContextName?: string;
    studentProgressFilter?: ProgressStatusFilter;
    canManageRecipients: boolean;
    canRecall: boolean;
    recalling: boolean;
    addingRecipients: boolean;
    removingStudentId: string;
    onRetry: () => void;
    onAddRecipients: (studentIds: string[]) => Promise<void>;
    onRemoveRecipient: (studentId: string) => Promise<void>;
    onRecall: () => void;
}) {
    const [candidateIds, setCandidateIds] = useState<Set<string>>(new Set());
    const [candidateQuery, setCandidateQuery] = useState('');

    useEffect(() => {
        setCandidateIds(new Set());
        setCandidateQuery('');
    }, [detail?.assignment.id]);

    if (loading) return <SkeletonPanel rows={6} />;
    if (error) return <ErrorState title={error} retryLabel="다시 시도" onRetry={onRetry} />;
    if (!detail) return <EmptyState title="과제를 선택하세요." />;

    const assignment = detail.assignment;
    const recalled = dueStatus(assignment) === 'recalled';
    const classScoped = classContextId !== undefined;
    const classProgressRows = classScoped
        ? assignment.classProgress.filter((row) => (row.classId || null) === (classContextId || null))
        : assignment.classProgress;
    const scopedProgress = classScoped
        ? classProgressRows[0] || assignment.progress
        : assignment.progress;
    const scopedRecipients = classScoped
        ? detail.recipients.filter((row) => (row.classId || null) === (classContextId || null))
        : detail.recipients;
    const displayedRecipients = studentProgressFilter === 'all'
        ? scopedRecipients
        : scopedRecipients.filter((row) => row.status === studentProgressFilter);
    const candidates = detail.candidateStudents
        .filter((student) => {
            const query = candidateQuery.trim().toLowerCase();
            const classMatches = !classScoped || !classContextId || student.classIds.includes(classContextId);
            const queryMatches = !query || `${student.name} ${student.classNames.join(' ')}`.toLowerCase().includes(query);
            return classMatches && queryMatches;
        })
        .slice(0, 80);

    return (
        <Card className="self-start overflow-hidden">
            <CardHeader className="border-b bg-muted/25">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <CardTitle>{assignment.title}</CardTitle>
                            <StatusBadge tone={dueTone(dueStatus(assignment))} label={dueLabel(dueStatus(assignment))} />
                            {classScoped && <StatusBadge tone="primary" label={classContextName || '선택 반'} />}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {assignment.bookTitle || '외부 학습지'} · {assignment.problemCount}문항 · {formatDate(assignment.dueAt)}
                        </p>
                        {assignment.description && (
                            <p className="mt-2 max-w-2xl text-sm text-foreground">{assignment.description}</p>
                        )}
                    </div>
                    <div className="flex flex-col gap-2">
                        {canRecall && !recalled && (
                            <Button type="button" variant="outline" size="sm" onClick={onRecall} disabled={recalling}>
                                <ArchiveX className="mr-2 h-4 w-4" />
                                {recalling ? '회수 중' : '과제 회수'}
                            </Button>
                        )}
                        <div className="grid min-w-[260px] grid-cols-3 gap-2 text-xs">
                            <div className="rounded-lg bg-muted px-3 py-2">
                                <p className="text-muted-foreground">대상</p>
                                <p className="font-semibold text-foreground">{scopedProgress.targetStudentCount}명</p>
                            </div>
                            <div className="rounded-lg bg-muted px-3 py-2">
                                <p className="text-muted-foreground">완료</p>
                                <p className="font-semibold text-foreground">{scopedProgress.completedCount}명</p>
                            </div>
                            <div className="rounded-lg bg-muted px-3 py-2">
                                <p className="text-muted-foreground">정답률</p>
                                <p className="font-semibold text-foreground">{metricText(scopedProgress.correctRate)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-4">
                <Tabs defaultValue="overview" variant="underline">
                    <TabsList className="flex h-auto w-full flex-wrap justify-start overflow-x-auto">
                        <TabsTrigger value="overview"><BarChart3 className="mr-2 h-4 w-4" />개요</TabsTrigger>
                        <TabsTrigger value="students"><Users className="mr-2 h-4 w-4" />대상 학생</TabsTrigger>
                        <TabsTrigger value="problems"><FileText className="mr-2 h-4 w-4" />문제</TabsTrigger>
                    </TabsList>
                    <TabsContent value="overview">
                        <div className="space-y-4">
                            <AssignmentProgressSummary assignment={assignment} />
                            <div className="grid gap-3 md:grid-cols-2">
                                {classProgressRows.map((row) => (
                                    <div key={row.classId || row.className} className="rounded-lg border bg-card p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <p className="font-semibold text-foreground">{classLabel(row)}</p>
                                            <span className="text-xs text-muted-foreground">{row.completedCount}/{row.targetStudentCount}</span>
                                        </div>
                                        <ProgressLine value={row.completionRate} />
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            <StatusBadge tone="neutral" label={`미시작 ${row.notStartedCount}`} />
                                            <StatusBadge tone="warning" label={`진행 ${row.inProgressCount}`} />
                                            <StatusBadge tone="success" label={`완료 ${row.completedCount}`} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent value="students">
                        <div className="space-y-4">
                            {canManageRecipients && !recalled && (
                                <FormSection title="새 대상 추가" description="과제 생성 이후 반에 들어온 학생을 수동으로 추가합니다.">
                                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                                        <div className="relative">
                                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                            <Input className="pl-9" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="추가할 학생 검색" />
                                        </div>
                                        <Button
                                            type="button"
                                            disabled={candidateIds.size === 0 || addingRecipients || recalled}
                                            onClick={() => void onAddRecipients([...candidateIds]).then(() => setCandidateIds(new Set()))}
                                        >
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            추가
                                        </Button>
                                    </div>
                                    <div className="max-h-40 space-y-1 overflow-auto rounded-lg border bg-card p-2">
                                        {candidates.map((student) => (
                                            <label key={student.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                                                <Checkbox checked={candidateIds.has(student.id)} onCheckedChange={() => toggleSetValue(setCandidateIds, student.id)} />
                                                <span>{student.name} <span className="text-xs text-muted-foreground">{student.classNames.join(', ') || '반 없음'}</span></span>
                                            </label>
                                        ))}
                                        {candidates.length === 0 && <p className="p-2 text-xs text-muted-foreground">추가할 수 있는 학생이 없습니다.</p>}
                                    </div>
                                </FormSection>
                            )}

                            <DataTable>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>학생</TableHead>
                                            <TableHead>반</TableHead>
                                            <TableHead>상태</TableHead>
                                            <TableHead>풀이</TableHead>
                                            <TableHead>정답률</TableHead>
                                            <TableHead>최근</TableHead>
                                            <TableHead>상세</TableHead>
                                            {canManageRecipients && !recalled && <TableHead>관리</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {displayedRecipients.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="font-medium">{row.studentName}</TableCell>
                                                <TableCell>{row.className || '-'}</TableCell>
                                                <TableCell>{statusBadgeForRecipient(row)}</TableCell>
                                                <TableCell>{row.attemptedProblemCount}/{row.requiredProblemCount}</TableCell>
                                                <TableCell>{metricText(row.correctRate)}</TableCell>
                                                <TableCell>{shortDate(row.lastActivityAt)}</TableCell>
                                                <TableCell>
                                                    <Button asChild variant="ghost" size="sm">
                                                        <Link href={`/students/${encodeURIComponent(row.studentId)}`}>
                                                            학생 상세
                                                        </Link>
                                                    </Button>
                                                </TableCell>
                                                {canManageRecipients && !recalled && (
                                                    <TableCell>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={removingStudentId === row.studentId}
                                                            onClick={() => void onRemoveRecipient(row.studentId)}
                                                        >
                                                            <UserMinus className="mr-2 h-4 w-4" />
                                                            제외
                                                        </Button>
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </DataTable>
                            {displayedRecipients.length === 0 && (
                                <EmptyState title="조건에 맞는 학생 현황이 없습니다." className="min-h-[140px]" />
                            )}
                        </div>
                    </TabsContent>
                    <TabsContent value="problems">
                        <DataTable>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>문제</TableHead>
                                        <TableHead>단원</TableHead>
                                        <TableHead>유형</TableHead>
                                        <TableHead>시도</TableHead>
                                        <TableHead>푼 학생</TableHead>
                                        <TableHead>정답률</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {detail.problems.map((row) => (
                                        <TableRow key={row.problemId}>
                                            <TableCell className="font-medium">{row.label}</TableCell>
                                            <TableCell>{row.unitName || '-'}</TableCell>
                                            <TableCell>{row.typeName || '-'}</TableCell>
                                            <TableCell>{row.attemptCount}</TableCell>
                                            <TableCell>{row.attemptedStudentCount}</TableCell>
                                            <TableCell>{metricText(row.correctRate)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </DataTable>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

const INDIVIDUAL_CLASS_KEY = '__individual__';

type AssignmentClassOption = {
    key: string;
    classId: string | null;
    name: string;
    studentCount: number;
    assignmentCount: number;
    visibleAssignmentCount: number;
    incompleteStudentCount: number;
    overdueCount: number;
    dueSoonCount: number;
    completionRate: number;
};

function assignmentClassKey(classId: string | null): string {
    return classId || INDIVIDUAL_CLASS_KEY;
}

function assignmentClassIdFromKey(key: string): string | null {
    return key === INDIVIDUAL_CLASS_KEY ? null : key;
}

function progressForClass(assignment: LearningAssignmentSummary, classId: string | null): AssignmentClassProgressSummary | null {
    return assignment.classProgress.find((row) => (row.classId || null) === (classId || null)) || null;
}

function isClassAssignmentComplete(progress: AssignmentClassProgressSummary | null): boolean {
    return Boolean(progress && progress.targetStudentCount > 0 && progress.completedCount >= progress.targetStudentCount);
}

function classAssignmentSortScore(assignment: LearningAssignmentSummary, progress: AssignmentClassProgressSummary | null): number {
    const status = dueStatus(assignment);
    if (status === 'overdue') return 0;
    if (status === 'due_soon' && !isClassAssignmentComplete(progress)) return 1;
    if (!isClassAssignmentComplete(progress)) return 2;
    if (status === 'completed') return 4;
    if (status === 'recalled') return 5;
    return 3;
}

function sortClassAssignments(classId: string | null, assignments: LearningAssignmentSummary[]): LearningAssignmentSummary[] {
    return [...assignments].sort((a, b) => {
        const aProgress = progressForClass(a, classId);
        const bProgress = progressForClass(b, classId);
        const scoreDiff = classAssignmentSortScore(a, aProgress) - classAssignmentSortScore(b, bProgress);
        if (scoreDiff !== 0) return scoreDiff;
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return a.title.localeCompare(b.title, 'ko');
    });
}

function assignmentMatchesStatus(assignment: LearningAssignmentSummary, progress: AssignmentClassProgressSummary | null, statusFilter: AssignmentStatusFilter): boolean {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'completed') return isClassAssignmentComplete(progress);
    return dueStatus(assignment) === statusFilter;
}

function visibleAssignmentsForClass(input: {
    assignments: LearningAssignmentSummary[];
    classId: string | null;
    searchQuery: string;
    statusFilter: AssignmentStatusFilter;
    includeCompleted: boolean;
}): LearningAssignmentSummary[] {
    const query = input.searchQuery.trim().toLowerCase();
    return sortClassAssignments(input.classId, input.assignments).filter((assignment) => {
        const progress = progressForClass(assignment, input.classId);
        if (!progress) return false;
        if (!input.includeCompleted && isClassAssignmentComplete(progress)) return false;
        if (!assignmentMatchesStatus(assignment, progress, input.statusFilter)) return false;
        if (!query) return true;
        return `${assignment.title} ${assignment.bookTitle || ''} ${assignment.targetLabels.join(' ')}`.toLowerCase().includes(query);
    });
}

function incompleteStudentIdsForClass(classId: string | null, assignments: LearningAssignmentSummary[]): Set<string> {
    const studentIds = new Set<string>();
    for (const assignment of assignments) {
        for (const recipient of assignment.studentProgress) {
            if ((recipient.classId || null) !== (classId || null)) continue;
            if (recipient.status !== 'completed') studentIds.add(recipient.studentId);
        }
    }
    return studentIds;
}

function buildAssignmentClassOptions(
    data: AssignmentManagementData,
    searchQuery: string,
    statusFilter: AssignmentStatusFilter,
    includeCompleted: boolean,
): AssignmentClassOption[] {
    const studentCountByClass = new Map<string, number>();
    for (const student of data.students.filter((row) => row.status === 'active')) {
        for (const classId of student.classIds) {
            studentCountByClass.set(classId, (studentCountByClass.get(classId) || 0) + 1);
        }
    }

    const baseOptions: AssignmentClassOption[] = data.classes.map((classRow) => {
        const classAssignments = data.assignments.filter((assignment) => progressForClass(assignment, classRow.id));
        const visibleAssignments = visibleAssignmentsForClass({
            assignments: classAssignments,
            classId: classRow.id,
            searchQuery,
            statusFilter,
            includeCompleted,
        });
        const targetCount = classAssignments.reduce((sum, assignment) => sum + (progressForClass(assignment, classRow.id)?.targetStudentCount || 0), 0);
        const completedCount = classAssignments.reduce((sum, assignment) => sum + (progressForClass(assignment, classRow.id)?.completedCount || 0), 0);
        return {
            key: assignmentClassKey(classRow.id),
            classId: classRow.id,
            name: classRow.name,
            studentCount: studentCountByClass.get(classRow.id) ?? classRow.studentCount,
            assignmentCount: classAssignments.length,
            visibleAssignmentCount: visibleAssignments.length,
            incompleteStudentCount: incompleteStudentIdsForClass(classRow.id, classAssignments).size,
            overdueCount: classAssignments.filter((assignment) => dueStatus(assignment) === 'overdue' && !isClassAssignmentComplete(progressForClass(assignment, classRow.id))).length,
            dueSoonCount: classAssignments.filter((assignment) => dueStatus(assignment) === 'due_soon' && !isClassAssignmentComplete(progressForClass(assignment, classRow.id))).length,
            completionRate: targetCount === 0 ? 0 : Math.round((completedCount / targetCount) * 100),
        };
    });

    const individualAssignments = data.assignments.filter((assignment) => progressForClass(assignment, null));
    if (individualAssignments.length === 0) return baseOptions;

    const visibleAssignments = visibleAssignmentsForClass({
        assignments: individualAssignments,
        classId: null,
        searchQuery,
        statusFilter,
        includeCompleted,
    });
    const targetCount = individualAssignments.reduce((sum, assignment) => sum + (progressForClass(assignment, null)?.targetStudentCount || 0), 0);
    const completedCount = individualAssignments.reduce((sum, assignment) => sum + (progressForClass(assignment, null)?.completedCount || 0), 0);
    return [
        ...baseOptions,
        {
            key: INDIVIDUAL_CLASS_KEY,
            classId: null,
            name: '개별/반 미지정',
            studentCount: 0,
            assignmentCount: individualAssignments.length,
            visibleAssignmentCount: visibleAssignments.length,
            incompleteStudentCount: incompleteStudentIdsForClass(null, individualAssignments).size,
            overdueCount: individualAssignments.filter((assignment) => dueStatus(assignment) === 'overdue' && !isClassAssignmentComplete(progressForClass(assignment, null))).length,
            dueSoonCount: individualAssignments.filter((assignment) => dueStatus(assignment) === 'due_soon' && !isClassAssignmentComplete(progressForClass(assignment, null))).length,
            completionRate: targetCount === 0 ? 0 : Math.round((completedCount / targetCount) * 100),
        },
    ];
}

function AssignmentClassSelector({
    options,
    selectedKey,
    onSelect,
}: {
    options: AssignmentClassOption[];
    selectedKey: string;
    onSelect: (key: string) => void;
}) {
    return (
        <div className="space-y-2">
            {options.map((option) => (
                <SelectableCard
                    key={option.key}
                    selected={selectedKey === option.key}
                    onClick={() => onSelect(option.key)}
                    className="p-3"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <p className="truncate font-semibold text-foreground">{option.name}</p>
                                {option.overdueCount > 0 && <StatusBadge tone="danger" label={`기한 지남 ${option.overdueCount}`} />}
                                {option.overdueCount === 0 && option.dueSoonCount > 0 && <StatusBadge tone="warning" label={`임박 ${option.dueSoonCount}`} />}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                학생 {option.studentCount}명 · 표시 {option.visibleAssignmentCount}/{option.assignmentCount}개 과제
                            </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>평균 완료율</span>
                            <span>{option.completionRate}%</span>
                        </div>
                        <ProgressLine value={option.completionRate} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        <StatusBadge tone={option.incompleteStudentCount > 0 ? 'warning' : 'success'} label={`미완료 ${option.incompleteStudentCount}명`} />
                        <StatusBadge tone="neutral" label={`진행 과제 ${option.assignmentCount}개`} />
                    </div>
                </SelectableCard>
            ))}
        </div>
    );
}

function ClassAssignmentList({
    assignments,
    classId,
    selectedAssignmentId,
    onSelect,
}: {
    assignments: LearningAssignmentSummary[];
    classId: string | null;
    selectedAssignmentId: string;
    onSelect: (assignmentId: string) => void;
}) {
    if (assignments.length === 0) {
        return <EmptyState title="조건에 맞는 과제가 없습니다." description="완료 포함을 켜거나 검색/상태 필터를 조정하세요." />;
    }

    return (
        <div className="space-y-2">
            {assignments.map((assignment) => {
                const progress = progressForClass(assignment, classId);
                if (!progress) return null;
                return (
                    <AssignmentCard
                        key={`${assignment.id}-${assignmentClassKey(classId)}`}
                        assignment={assignment}
                        selected={assignment.id === selectedAssignmentId}
                        classContext={progress}
                        onSelect={() => onSelect(assignment.id)}
                    />
                );
            })}
        </div>
    );
}

export function AssignmentsStatusPage({ initialAssignmentId = '' }: { initialAssignmentId?: string }) {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [data, setData] = useState<AssignmentManagementData | null>(null);
    const [detail, setDetail] = useState<LearningAssignmentDetail | null>(null);
    const [selectedClassKey, setSelectedClassKey] = useState('');
    const [selectedAssignmentId, setSelectedAssignmentId] = useState(initialAssignmentId);
    const initialSelectionApplied = useRef(false);
    const [filtersHydrated, setFiltersHydrated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<AssignmentStatusFilter>('all');
    const [studentProgressFilter, setStudentProgressFilter] = useState<ProgressStatusFilter>('all');
    const [includeCompleted, setIncludeCompleted] = useState(false);
    const [addingRecipients, setAddingRecipients] = useState(false);
    const [removingStudentId, setRemovingStudentId] = useState('');
    const [recallOpen, setRecallOpen] = useState(false);
    const [recalling, setRecalling] = useState(false);

    const load = useCallback(async (options: AssignmentPageLoadOptions = {}) => {
        if (!academyId) return;
        if (options.background) setRefreshing(true);
        else setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId, { force: options.force });
            setData(next);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 현황을 불러오지 못했습니다.');
        } finally {
            if (options.background) setRefreshing(false);
            else setLoading(false);
        }
    }, [academyId]);

    const loadDetail = useCallback(async (assignmentId: string, options: AssignmentPageLoadOptions = {}) => {
        if (!academyId || !assignmentId) {
            setDetail(null);
            return;
        }
        if (!options.background) setDetailLoading(true);
        try {
            const next = await loadAssignmentDetail(academyId, assignmentId, { force: options.force });
            setDetail(next);
            setDetailError(null);
        } catch (err) {
            setDetailError(err instanceof Error ? err.message : '과제 상세를 불러오지 못했습니다.');
        } finally {
            if (!options.background) setDetailLoading(false);
        }
    }, [academyId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (!initialAssignmentId) setSelectedAssignmentId(params.get('assignmentId') || '');
        setSearchQuery(params.get('q') || '');
        setStatusFilter((params.get('status') as AssignmentStatusFilter | null) || 'all');
        setIncludeCompleted(params.get('completed') === '1');
        setFiltersHydrated(true);
    }, [initialAssignmentId]);

    useEffect(() => {
        if (!data || !initialAssignmentId || initialSelectionApplied.current) return;
        const assignment = data.assignments.find((row) => row.id === initialAssignmentId);
        if (!assignment) return;
        initialSelectionApplied.current = true;
        setSearchQuery('');
        setStatusFilter('all');
        setIncludeCompleted(true);
        setSelectedAssignmentId(initialAssignmentId);
        const classId = assignment.classProgress[0]?.classId ?? null;
        setSelectedClassKey(assignmentClassKey(classId));
    }, [data, initialAssignmentId]);

    useEffect(() => {
        if (!filtersHydrated) return;
        const params = new URLSearchParams(window.location.search);
        if (selectedAssignmentId) params.set('assignmentId', selectedAssignmentId);
        else params.delete('assignmentId');
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        else params.delete('q');
        if (statusFilter !== 'all') params.set('status', statusFilter);
        else params.delete('status');
        if (includeCompleted) params.set('completed', '1');
        else params.delete('completed');
        const search = params.toString();
        window.history.replaceState(null, '', search ? `${window.location.pathname}?${search}` : window.location.pathname);
    }, [filtersHydrated, includeCompleted, searchQuery, selectedAssignmentId, statusFilter]);

    const classOptions = useMemo(() => (
        data ? buildAssignmentClassOptions(data, searchQuery, statusFilter, includeCompleted) : []
    ), [data, includeCompleted, searchQuery, statusFilter]);

    useEffect(() => {
        if (classOptions.length === 0) {
            setSelectedClassKey('');
            return;
        }
        setSelectedClassKey((current) => (
            current && classOptions.some((option) => option.key === current)
                ? current
                : classOptions.find((option) => option.visibleAssignmentCount > 0)?.key || classOptions[0].key
        ));
    }, [classOptions]);

    const selectedClass = useMemo(() => (
        classOptions.find((option) => option.key === selectedClassKey) || null
    ), [classOptions, selectedClassKey]);

    const selectedClassId = selectedClass ? assignmentClassIdFromKey(selectedClass.key) : null;

    const visibleAssignments = useMemo(() => {
        if (!data || !selectedClass) return [];
        const classAssignments = data.assignments.filter((assignment) => progressForClass(assignment, selectedClassId));
        return visibleAssignmentsForClass({
            assignments: classAssignments,
            classId: selectedClassId,
            searchQuery,
            statusFilter,
            includeCompleted,
        });
    }, [data, includeCompleted, searchQuery, selectedClass, selectedClassId, statusFilter]);

    useEffect(() => {
        setSelectedAssignmentId((current) => (
            current && visibleAssignments.some((assignment) => assignment.id === current)
                ? current
                : visibleAssignments[0]?.id || ''
        ));
    }, [visibleAssignments]);

    const selectedAssignment = useMemo(() => (
        visibleAssignments.find((assignment) => assignment.id === selectedAssignmentId) || null
    ), [selectedAssignmentId, visibleAssignments]);

    useEffect(() => {
        void loadDetail(selectedAssignmentId);
    }, [loadDetail, selectedAssignmentId]);

    useEffect(() => {
        if (!academyId) return undefined;
        return addLmsInvalidationListener((payload) => {
            if (payload.academyId && payload.academyId !== academyId) return;
            const domain = payload.domain || 'lms';
            if (!['assignments', 'students', 'classes', 'learning', 'lms', 'admin'].includes(domain)) return;
            void load({ force: true, background: true });
            if (selectedAssignmentId) void loadDetail(selectedAssignmentId, { force: true, background: true });
        });
    }, [academyId, load, loadDetail, selectedAssignmentId]);

    const addRecipients = async (studentIds: string[]) => {
        if (!academyId || !selectedAssignmentId || studentIds.length === 0) return;
        setAddingRecipients(true);
        try {
            await addAssignmentRecipients(academyId, selectedAssignmentId, studentIds);
            toast.success('대상 학생을 추가했습니다.');
            await Promise.all([
                load({ force: true, background: true }),
                loadDetail(selectedAssignmentId, { force: true }),
            ]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '대상 학생 추가에 실패했습니다.');
        } finally {
            setAddingRecipients(false);
        }
    };

    const removeRecipient = async (studentId: string) => {
        if (!academyId || !selectedAssignmentId) return;
        setRemovingStudentId(studentId);
        try {
            await removeAssignmentRecipient(academyId, selectedAssignmentId, studentId);
            toast.success('대상 학생을 제외했습니다.');
            await Promise.all([
                load({ force: true, background: true }),
                loadDetail(selectedAssignmentId, { force: true }),
            ]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '대상 학생 제외에 실패했습니다.');
        } finally {
            setRemovingStudentId('');
        }
    };

    const recallSelectedAssignment = async () => {
        if (!academyId || !selectedAssignmentId) return;
        setRecalling(true);
        try {
            await recallAssignment(academyId, selectedAssignmentId);
            toast.success('과제를 회수했습니다.');
            setRecallOpen(false);
            await Promise.all([
                load({ force: true, background: true }),
                loadDetail(selectedAssignmentId, { force: true }),
            ]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '과제 회수에 실패했습니다.');
        } finally {
            setRecalling(false);
        }
    };

    if (!academyId) {
        return (
            <div className="mx-auto flex h-full max-w-xl items-center justify-center p-8">
                <Card>
                    <CardHeader><CardTitle>학원 연결이 필요합니다.</CardTitle></CardHeader>
                    <CardContent className="text-sm text-muted-foreground">현재 계정에 연결된 academy가 없습니다.</CardContent>
                </Card>
            </div>
        );
    }

    return (
        <PageShell
            title="과제 현황"
            description="담당 반을 기준으로 과제를 선택하고, 해당 과제의 학생별 진행 상황을 확인합니다."
            icon={ClipboardList}
            actions={data?.permissions.canCreate ? (
                <Button asChild>
                    <Link href="/assignments/new">
                        <SlidersHorizontal className="mr-2 h-4 w-4" />
                        과제 관리
                    </Link>
                </Button>
            ) : undefined}
        >
            {!loading && refreshing && (
                <PageStatusBar tone="neutral" className="text-xs">
                    <span className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        과제 진행 데이터를 동기화하는 중
                    </span>
                </PageStatusBar>
            )}

            {loading && <SkeletonPanel className="min-h-[520px]" rows={8} />}
            {!loading && error && (
                <ErrorState title={error} retryLabel="다시 시도" onRetry={() => void load({ force: true })} />
            )}
            {!loading && !error && data && (
                <div className="space-y-4">
                    <section className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                                <h2 className="text-base font-semibold text-foreground">반별 과제 진행</h2>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    담당 반 {classOptions.length}개 · 완료 과제는 기본 숨김
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {data.permissions.scopedToAssignedClasses && <StatusBadge tone="neutral" label="내 반만" />}
                                <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                                    <Checkbox checked={includeCompleted} onCheckedChange={(checked) => setIncludeCompleted(Boolean(checked))} />
                                    완료 포함
                                </label>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(240px,1fr)_220px_220px]">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    className="pl-9"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="과제명, 교재, 대상 검색"
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as AssignmentStatusFilter)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {statusFilterOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={studentProgressFilter} onValueChange={(value) => setStudentProgressFilter(value as ProgressStatusFilter)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {progressStatusOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </section>
                    <div className="grid min-h-[640px] gap-5 xl:grid-cols-[minmax(260px,0.7fr)_minmax(320px,0.9fr)_minmax(560px,1.35fr)]">
                        <section className="overflow-hidden rounded-xl border border-border bg-card">
                            <div className="border-b p-4">
                                <h2 className="text-base font-semibold text-foreground">반</h2>
                                <p className="mt-1 text-xs text-muted-foreground">담당중인 전체 반</p>
                            </div>
                            <div className="max-h-[calc(100vh-20rem)] overflow-auto p-4">
                                <AssignmentClassSelector
                                    options={classOptions}
                                    selectedKey={selectedClassKey}
                                    onSelect={(key) => {
                                        setSelectedClassKey(key);
                                        setSelectedAssignmentId('');
                                    }}
                                />
                            </div>
                        </section>

                        <section className="overflow-hidden rounded-xl border border-border bg-card">
                            <div className="border-b p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-base font-semibold text-foreground">{selectedClass?.name || '반 선택'}</h2>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {visibleAssignments.length}개 과제 표시 · 기한 임박/미완료 우선
                                        </p>
                                    </div>
                                    {selectedClass && <StatusBadge tone="primary" label={`${selectedClass.completionRate}%`} />}
                                </div>
                            </div>
                            <div className="max-h-[calc(100vh-20rem)] overflow-auto p-4">
                                <ClassAssignmentList
                                    assignments={visibleAssignments}
                                    classId={selectedClassId}
                                    selectedAssignmentId={selectedAssignmentId}
                                    onSelect={setSelectedAssignmentId}
                                />
                            </div>
                        </section>

                        {selectedAssignment ? (
                            <AssignmentDetailPanel
                                detail={detail}
                                loading={detailLoading}
                                error={detailError}
                                classContextId={selectedClassId}
                                classContextName={selectedClass?.name}
                                studentProgressFilter={studentProgressFilter}
                                canManageRecipients={data.permissions.canManageRecipients}
                                canRecall={data.permissions.canRecall}
                                recalling={recalling}
                                addingRecipients={addingRecipients}
                                removingStudentId={removingStudentId}
                                onRetry={() => void loadDetail(selectedAssignment.id, { force: true })}
                                onAddRecipients={addRecipients}
                                onRemoveRecipient={removeRecipient}
                                onRecall={() => setRecallOpen(true)}
                            />
                        ) : (
                            <Card>
                                <CardContent className="flex min-h-[520px] flex-col items-center justify-center gap-3 text-center">
                                    <CheckCircle2 className="h-9 w-9 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">과제를 선택하세요.</p>
                                        <p className="mt-1 text-xs text-muted-foreground">반과 과제를 선택하면 학생별 진행 현황이 표시됩니다.</p>
                                    </div>
                                    {data.permissions.canCreate && (
                                        <Button asChild variant="outline" size="sm">
                                            <Link href="/assignments/new">
                                                <Plus className="mr-2 h-4 w-4" />
                                                과제 관리
                                            </Link>
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            )}
            <Dialog open={recallOpen} onOpenChange={setRecallOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>과제 회수</DialogTitle>
                        <DialogDescription>
                            {selectedAssignment?.title || '선택한 과제'}를 학생 과제함에서 숨깁니다. 풀이 기록과 통계는 LMS에 남습니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-foreground">
                        회수 후 학생은 이 과제를 새로 열거나 제출할 수 없습니다. 필요한 경우 새 과제로 다시 배포하세요.
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setRecallOpen(false)} disabled={recalling}>
                            취소
                        </Button>
                        <Button type="button" variant="destructive" onClick={() => void recallSelectedAssignment()} disabled={recalling}>
                            {recalling ? '회수 중' : '과제 회수'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}


export function AssignmentCreatePage() {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [data, setData] = useState<AssignmentManagementData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [tab, setTab] = useState<AssignmentManageTab>('manage');
    const [recallAssignmentId, setRecallAssignmentId] = useState('');
    const [deleteAssignmentId, setDeleteAssignmentId] = useState('');
    const [recallingAssignmentId, setRecallingAssignmentId] = useState('');
    const [deletingAssignmentId, setDeletingAssignmentId] = useState('');
    const [analysisDraft, setAnalysisDraft] = useState<LearningAnalysisAssignmentDraft | null>(null);

    useEffect(() => {
        const source = new URLSearchParams(window.location.search).get('source');
        if (source !== 'learning-analysis') return;
        const draft = readLearningAnalysisAssignmentDraft(window.sessionStorage);
        if (!draft) {
            toast.error('과제 초안이 만료되었거나 올바르지 않습니다. 학습 분석에서 다시 선택해 주세요.');
            return;
        }
        setAnalysisDraft(draft);
        setTab('deploy');
    }, []);

    const load = useCallback(async (options: AssignmentPageLoadOptions = {}) => {
        if (!academyId) return;
        if (options.background) setRefreshing(true);
        else setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId, { force: options.force });
            setData(next);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 관리 데이터를 불러오지 못했습니다.');
        } finally {
            if (options.background) setRefreshing(false);
            else setLoading(false);
        }
    }, [academyId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!academyId) return undefined;
        return addLmsInvalidationListener((payload) => {
            if (payload.academyId && payload.academyId !== academyId) return;
            const domain = payload.domain || 'lms';
            if (!['assignments', 'students', 'classes', 'learning', 'lms', 'admin'].includes(domain)) return;
            void load({ force: true, background: true });
        });
    }, [academyId, load]);

    const recallTarget = data?.assignments.find((assignment) => assignment.id === recallAssignmentId) || null;
    const deleteTarget = data?.assignments.find((assignment) => assignment.id === deleteAssignmentId) || null;

    const submitAssignment = async (input: CreateLearningAssignmentInput, file: File | null) => {
        if (!academyId) return;
        setSubmitting(true);
        try {
            if (input.sourceType === 'worksheet') {
                if (!file) throw new Error('학습지 export 파일을 선택하세요.');
                await importWorksheetAssignment(academyId, input, file);
            } else {
                await createLearningAssignment(academyId, input);
            }
            clearLearningAnalysisAssignmentDraft(window.sessionStorage);
            setAnalysisDraft(null);
            toast.success('과제를 배포했습니다.');
            await load({ force: true, background: true });
            setTab('manage');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '과제 배포에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const recallSelectedAssignment = async () => {
        if (!academyId || !recallAssignmentId) return;
        setRecallingAssignmentId(recallAssignmentId);
        try {
            await recallAssignment(academyId, recallAssignmentId);
            toast.success('과제를 회수했습니다.');
            setRecallAssignmentId('');
            await load({ force: true, background: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '과제 회수에 실패했습니다.');
        } finally {
            setRecallingAssignmentId('');
        }
    };

    const deleteSelectedAssignment = async () => {
        if (!academyId || !deleteAssignmentId) return;
        setDeletingAssignmentId(deleteAssignmentId);
        try {
            await deleteAssignment(academyId, deleteAssignmentId);
            toast.success('과제를 삭제했습니다.');
            setDeleteAssignmentId('');
            await load({ force: true, background: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '과제 삭제에 실패했습니다.');
        } finally {
            setDeletingAssignmentId('');
        }
    };

    if (!academyId) {
        return (
            <div className="mx-auto flex h-full max-w-xl items-center justify-center p-8">
                <Card>
                    <CardHeader><CardTitle>학원 연결이 필요합니다.</CardTitle></CardHeader>
                    <CardContent className="text-sm text-muted-foreground">현재 계정에 연결된 academy가 없습니다.</CardContent>
                </Card>
            </div>
        );
    }

    return (
        <PageShell
            title="과제 관리"
            description="과제 배포, 회수, 삭제만 관리합니다."
            icon={SlidersHorizontal}
            actions={(
                <Button asChild variant="outline">
                    <Link href="/assignments">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        현황으로
                    </Link>
                </Button>
            )}
        >
            {!loading && refreshing && (
                <PageStatusBar tone="neutral" className="text-xs">
                    <span className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        과제 관리 데이터를 동기화하는 중
                    </span>
                </PageStatusBar>
            )}

            {loading && <SkeletonPanel className="min-h-[560px]" rows={9} />}
            {!loading && error && (
                <ErrorState title={error} retryLabel="다시 시도" onRetry={() => void load({ force: true })} />
            )}
            {!loading && !error && data && (
                <>
                    <Tabs value={tab} onValueChange={(value) => setTab(value as AssignmentManageTab)} variant="underline">
                        <TabsList className="flex h-auto w-full flex-wrap justify-start overflow-x-auto">
                            <TabsTrigger value="manage">
                                <ClipboardList className="mr-2 h-4 w-4" />
                                배포된 과제
                            </TabsTrigger>
                            <TabsTrigger value="deploy" disabled={!data.permissions.canCreate}>
                                <Plus className="mr-2 h-4 w-4" />
                                새 과제 배포
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="manage">
                            <AssignmentManagementList
                                assignments={data.assignments}
                                permissions={data.permissions}
                                recallingAssignmentId={recallingAssignmentId}
                                deletingAssignmentId={deletingAssignmentId}
                                onRecall={setRecallAssignmentId}
                                onDelete={setDeleteAssignmentId}
                            />
                        </TabsContent>
                        <TabsContent value="deploy">
                            {data.permissions.canCreate ? (
                                <AssignmentComposer
                                    data={data}
                                    submitting={submitting}
                                    initialDraft={analysisDraft}
                                    onCancel={() => {
                                        clearLearningAnalysisAssignmentDraft(window.sessionStorage);
                                        setAnalysisDraft(null);
                                        setTab('manage');
                                    }}
                                    onSubmit={submitAssignment}
                                />
                            ) : (
                                <EmptyState title="과제 배포 권한이 없습니다." description="관리자에게 권한을 요청하세요." />
                            )}
                        </TabsContent>
                    </Tabs>

                    <Dialog open={Boolean(recallAssignmentId)} onOpenChange={(open) => !open && setRecallAssignmentId('')}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>과제 회수</DialogTitle>
                                <DialogDescription>
                                    {recallTarget?.title || '선택한 과제'}를 학생 과제함에서 숨깁니다. 풀이 기록과 통계는 LMS에 남습니다.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-foreground">
                                회수 후 학생은 이 과제를 새로 열거나 제출할 수 없습니다. 기록을 남기려면 삭제 대신 회수를 사용하세요.
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setRecallAssignmentId('')} disabled={Boolean(recallingAssignmentId)}>
                                    취소
                                </Button>
                                <Button type="button" variant="destructive" onClick={() => void recallSelectedAssignment()} disabled={Boolean(recallingAssignmentId)}>
                                    {recallingAssignmentId ? '회수 중' : '과제 회수'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={Boolean(deleteAssignmentId)} onOpenChange={(open) => !open && setDeleteAssignmentId('')}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>과제 삭제</DialogTitle>
                                <DialogDescription>
                                    {deleteTarget?.title || '선택한 과제'}를 과제 목록에서 완전히 삭제합니다.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                삭제하면 LMS 과제 목록과 학생 과제함에서 사라집니다. 기록을 보존해야 하면 삭제하지 말고 회수하세요.
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setDeleteAssignmentId('')} disabled={Boolean(deletingAssignmentId)}>
                                    취소
                                </Button>
                                <Button type="button" variant="destructive" onClick={() => void deleteSelectedAssignment()} disabled={Boolean(deletingAssignmentId)}>
                                    {deletingAssignmentId ? '삭제 중' : '과제 삭제'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
        </PageShell>
    );
}


export function AssignmentsOperationsPage() {
    return <AssignmentsStatusPage />;
}
