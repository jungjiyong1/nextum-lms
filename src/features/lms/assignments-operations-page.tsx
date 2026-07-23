'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    ArchiveX,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ClipboardList,
    FileText,
    Folder,
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
    peekAssignmentManagementData,
    recallAssignment,
    removeAssignmentRecipient,
} from './service';
import {
    AssignmentCatalogTree,
    type AssignmentCatalogLeaf,
} from './assignment-catalog-tree';
import { loadAssignmentProblemCatalog } from './problem-catalog-client';
import {
    assignmentListGroup,
    assignmentListDueLabel,
    assignmentListGroupLabels,
    assignmentListGroupOrder,
    buildAssignmentPerformanceComparison,
    buildAssignmentTypeInsights,
    type AssignmentTypeInsight,
} from './assignment-status-view';
import type {
    AssignmentClassProgressSummary,
    AssignmentManagementData,
    AssignmentProblemProgress,
    AssignmentProblemScope,
    AssignmentProblemSummary,
    AssignmentProblemTypeSummary,
    AssignmentProgressSummary,
    AssignmentRecipientProgress,
    AssignmentUnitSummary,
    CreateLearningAssignmentInput,
    LearningAssignmentDetail,
    LearningAssignmentSummary,
    StudentSummary,
} from './types';

type AssignmentPageLoadOptions = { force?: boolean; background?: boolean; silent?: boolean };
type AssignmentStatusFilter = 'all' | 'open' | 'due_soon' | 'overdue' | 'completed' | 'recalled';
type ProgressStatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed';
type AssignmentManageTab = 'manage' | 'deploy';

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

type ProgressTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const progressToneClasses: Record<ProgressTone, string> = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-destructive',
    neutral: 'bg-muted-foreground',
};

function ProgressLine({ value, tone = 'primary' }: { value: number; tone?: ProgressTone }) {
    return (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
                className={cn('h-full rounded-full', progressToneClasses[tone])}
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
        </div>
    );
}

function metricText(value: number | null): string {
    return value === null ? '-' : `${value}%`;
}

function comparisonDelta(
    current: number | null,
    baseline: number | null,
): { label: string; tone: 'success' | 'danger' | 'neutral' } {
    if (current === null || baseline === null) {
        return { label: '비교 불가', tone: 'neutral' };
    }
    const delta = current - baseline;
    if (delta === 0) return { label: '같음', tone: 'neutral' };
    return {
        label: `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%p`,
        tone: delta > 0 ? 'success' : 'danger',
    };
}

function AssignmentCard({
    assignment,
    selected,
    progress,
    className,
    onSelect,
}: {
    assignment: LearningAssignmentSummary;
    selected: boolean;
    progress: AssignmentProgressSummary;
    className?: string;
    onSelect: () => void;
}) {
    const status = dueStatus(assignment);
    const targetLabel = className
        || assignment.targetLabels.slice(0, 2).join(', ')
        || '개별 배정';
    return (
        <Button
            type="button"
            variant="ghost"
            onClick={onSelect}
            className={cn(
                'h-auto w-full justify-start gap-3 rounded-lg border border-transparent px-3.5 py-2.5 text-left text-sm font-normal',
                selected ? 'bg-primary-soft' : 'bg-transparent hover:bg-muted',
            )}
            aria-pressed={selected}
        >
            <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-foreground">{assignment.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {targetLabel} · {assignmentListDueLabel(assignment)} · {progress.completedCount}/{progress.targetStudentCount}명
                </span>
            </span>
            <StatusBadge
                className="shrink-0 whitespace-nowrap"
                tone={dueTone(status)}
                label={`${progress.completionRate}%`}
            />
        </Button>
    );
}


function selectedProblemIds(
    problems: AssignmentProblemSummary[],
    wholeBook: boolean,
    selectedUnitIds: Set<string>,
    selectedTypeIds: Set<string>,
    selectedCatalogLeaves: AssignmentCatalogLeaf[],
    excludedProblemIds: Set<string>,
): string[] {
    if (wholeBook) return problems.filter((problem) => !excludedProblemIds.has(problem.id)).map((problem) => problem.id);
    if (selectedCatalogLeaves.length > 0) {
        return problems
            .filter((problem) => (
                selectedCatalogLeaves.some((leaf) => catalogLeafMatchesProblem(leaf, problem))
                && !excludedProblemIds.has(problem.id)
            ))
            .map((problem) => problem.id);
    }
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

function catalogLeafMatchesProblem(leaf: AssignmentCatalogLeaf, problem: AssignmentProblemSummary): boolean {
    return leaf.bookId === problem.bookId
        && leaf.unitId === problem.unitId
        && (leaf.typeId === null || leaf.typeId === problem.problemTypeId)
        && (leaf.unassignedMiddleUnit
            ? problem.middleUnitName === null
            : leaf.middleUnitName === null || leaf.middleUnitName === problem.middleUnitName);
}

function problemScopesFromLeaves(leaves: AssignmentCatalogLeaf[]): AssignmentProblemScope[] {
    const scopes = new Map<string, AssignmentProblemScope>();
    for (const leaf of leaves) {
        const scope = {
            unitId: leaf.unitId,
            problemTypeId: leaf.typeId,
            middleUnitName: leaf.middleUnitName,
            unassignedMiddleUnit: leaf.unassignedMiddleUnit,
        } satisfies AssignmentProblemScope;
        scopes.set(
            `${scope.unitId}\u0000${scope.problemTypeId || ''}\u0000${scope.middleUnitName || ''}\u0000${scope.unassignedMiddleUnit ? 'unassigned' : ''}`,
            scope,
        );
    }
    return [...scopes.values()];
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

type AssignmentComposerStep = 1 | 2 | 3 | 4;

const assignmentComposerSteps = [
    { id: 1 as const, label: '문제 구성', description: '학년·과목·유형', icon: FileText },
    { id: 2 as const, label: '대상 선택', description: '반·학생', icon: Users },
    { id: 3 as const, label: '일정 설정', description: '제목·마감', icon: SlidersHorizontal },
    { id: 4 as const, label: '최종 확인', description: '검토·배포', icon: CheckCircle2 },
];

function duePresetValue(daysFromToday: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysFromToday);
    date.setHours(22, 0, 0, 0);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T22:00`;
}

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
    const [composerStep, setComposerStep] = useState<AssignmentComposerStep>(1);
    const [title, setTitle] = useState(initialDraft?.title ?? '');
    const [dueAt, setDueAt] = useState('');
    const [bookId, setBookId] = useState('');
    const [wholeBook, setWholeBook] = useState(false);
    const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
    const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
    const [selectedCatalogLeaves, setSelectedCatalogLeaves] = useState<Map<string, AssignmentCatalogLeaf>>(() => new Map());
    const [excludedProblemIds, setExcludedProblemIds] = useState<Set<string>>(new Set());
    const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(() => {
        return new Set();
    });
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
    const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
        () => new Set(initialDraft?.studentIds ?? []),
    );
    const [directContext, setDirectContext] = useState('');
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
    const directStudents = useMemo(
        () => data.students.filter((student) => selectedStudentIds.has(student.id) && !excludedStudentIds.has(student.id)),
        [data.students, excludedStudentIds, selectedStudentIds],
    );
    const directClassOptions = useMemo(() => data.classes.filter((classRow) => (
        classRow.active
        && directStudents.length > 0
        && directStudents.every((student) => student.classIds.includes(classRow.id))
    )), [data.classes, directStudents]);

    useEffect(() => {
        if (directStudents.length === 0) {
            setDirectContext('');
            return;
        }
        if (directContext && (directContext === 'personal' || directClassOptions.some((row) => row.id === directContext))) return;
        setDirectContext(directClassOptions.length === 1 ? directClassOptions[0].id : '');
    }, [directClassOptions, directContext, directStudents.length]);
    const loadUnitProblems = useCallback(async (
        unitId: string,
        cursor: string | null = null,
        requestedBookId: string | null = null,
    ) => {
        const activeBookId = requestedBookId || bookId;
        if (!academyId || !activeBookId) return;
        const key = unitCatalogKey(activeBookId, unitId);
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
                bookId: activeBookId,
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
    }, []);

    const orderedBookProblems = useMemo(
        () => selectedBook
            ? sortByProblemOrder(selectedBook.units.flatMap((unit) => (
                unitCatalogs.get(unitCatalogKey(selectedBook.id, unit.id))?.items || []
            )))
            : [],
        [selectedBook, unitCatalogs],
    );
    const selectedCatalogLeafList = useMemo(
        () => [...selectedCatalogLeaves.values()],
        [selectedCatalogLeaves],
    );
    const selectedProblemScopes = useMemo(
        () => problemScopesFromLeaves(selectedCatalogLeafList),
        [selectedCatalogLeafList],
    );
    const previewProblemIds = useMemo(
        () => selectedProblemIds(
            orderedBookProblems,
            wholeBook,
            selectedUnitIds,
            selectedTypeIds,
            selectedCatalogLeafList,
            excludedProblemIds,
        ),
        [excludedProblemIds, orderedBookProblems, selectedCatalogLeafList, selectedTypeIds, selectedUnitIds, wholeBook],
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
    const selectedUnits = selectedBook?.units.filter((unit) => selectedUnitIds.has(unit.id)) || [];
    const selectedMiddleCount = selectedCatalogLeafList.length > 0
        ? new Set(selectedCatalogLeafList.map((leaf) => `${leaf.unitId}\u0000${leaf.middleUnitName || leaf.middleLabel}`)).size
        : selectedUnitIds.size;
    const selectedScopeLoading = unitProblemRows.some((row) => selectedUnitIds.has(row.unit.id) && row.loading);
    const selectedScopeHasMore = unitProblemRows.some((row) => selectedUnitIds.has(row.unit.id) && row.hasMore);
    const problemSummary = wholeBook
        ? '전체 문제집'
        : selectedUnitIds.size > 0
            ? selectedScopeLoading && previewProblemIds.length === 0
                ? `${selectedMiddleCount}개 중단원 · 문항 계산 중`
                : `${selectedMiddleCount}개 중단원 · ${previewProblemIds.length}${selectedScopeHasMore ? '+' : ''}문항`
            : '범위 미선택';
    const dueSummary = dueAt ? formatDate(toDueIso(dueAt)) : '기한 없음';
    const targetReady = effectiveStudents.length > 0
        && ((initialDraft?.studentIds.length || selectedStudentIds.size) === 0 || Boolean(directContext));
    const contentReady = Boolean(bookId && (wholeBook || selectedUnitIds.size > 0));
    const detailsReady = Boolean(title.trim());
    const readyStepCount = [targetReady, contentReady, detailsReady].filter(Boolean).length;
    const suggestedTitle = selectedBook
        ? `${selectedBook.title} ${wholeBook
            ? '전체 복습'
            : selectedUnits.length > 0
                ? `${selectedUnits[0].name}${selectedUnits.length > 1 ? ` 외 ${selectedUnits.length - 1}개 단원` : ''}`
                : '복습'}`
        : '수학 복습 과제';

    const applyCatalogLeafSelection = (next: Map<string, AssignmentCatalogLeaf>) => {
        const leaves = [...next.values()];
        setSelectedCatalogLeaves(next);
        setSelectedUnitIds(new Set(leaves.map((leaf) => leaf.unitId)));
        setSelectedTypeIds(new Set(leaves.flatMap((leaf) => leaf.typeId ? [leaf.typeId] : [])));
    };

    const resetScope = () => {
        setWholeBook(false);
        setSelectedUnitIds(new Set());
        setSelectedTypeIds(new Set());
        setSelectedCatalogLeaves(new Map());
        setExcludedProblemIds(new Set());
    };

    const selectCatalogLeaf = (leaf: AssignmentCatalogLeaf) => {
        const sameBook = bookId === leaf.bookId;
        const selected = sameBook && selectedCatalogLeaves.has(leaf.key);
        const switchedBook = Boolean(bookId && !sameBook && contentReady);
        const next = sameBook
            ? new Map(selectedCatalogLeaves)
            : new Map<string, AssignmentCatalogLeaf>();

        setWholeBook(false);
        if (!sameBook) {
            for (const controller of catalogControllers.current.values()) controller.abort();
            catalogControllers.current.clear();
            setUnitCatalogs(new Map());
            setBookId(leaf.bookId);
            setExcludedProblemIds(new Set());
        }
        if (selected) next.delete(leaf.key);
        else next.set(leaf.key, leaf);
        applyCatalogLeafSelection(next);

        if (!selected) {
            setExpandedUnitIds((current) => new Set([...current, leaf.unitId]));
            void loadUnitProblems(leaf.unitId, null, leaf.bookId);
        }
        if (switchedBook) {
            toast.info(`선택 교재를 ‘${leaf.bookTitle}’(으)로 전환했습니다.`);
        }
    };

    const removeCatalogMiddle = (leaves: AssignmentCatalogLeaf[]) => {
        const currentBookLeaves = leaves.filter((leaf) => leaf.bookId === bookId);
        if (currentBookLeaves.length === 0) return;

        const removedLeafKeys = new Set(currentBookLeaves.map((leaf) => leaf.key));
        const next = new Map([...selectedCatalogLeaves].filter(([key]) => !removedLeafKeys.has(key)));
        applyCatalogLeafSelection(next);

        const removedUnitIds = new Set(currentBookLeaves.map((leaf) => leaf.unitId));
        const removedProblemIds = new Set([...removedUnitIds].flatMap((unitId) => (
            unitCatalogs.get(unitCatalogKey(bookId, unitId))?.items
                .filter((problem) => currentBookLeaves.some((leaf) => catalogLeafMatchesProblem(leaf, problem)))
                .map((problem) => problem.id) || []
        )));
        if (removedProblemIds.size > 0) {
            setExcludedProblemIds((current) => new Set([...current].filter((problemId) => !removedProblemIds.has(problemId))));
        }
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
        setSelectedCatalogLeaves(new Map());
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
        setSelectedCatalogLeaves(new Map());
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
        const withinCatalogScope = selectedCatalogLeafList.length > 0
            && problems.every((problem) => selectedCatalogLeafList.some((leaf) => catalogLeafMatchesProblem(leaf, problem)));
        if (!withinCatalogScope) {
            setSelectedCatalogLeaves(new Map());
            setSelectedUnitIds((current) => new Set([...current, ...problems.map((problem) => problem.unitId)]));
            setSelectedTypeIds((current) => {
                const next = new Set(current);
                problems.forEach((problem) => {
                    if (problem.problemTypeId) next.add(problem.problemTypeId);
                });
                return next;
            });
        }
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
        setSelectedCatalogLeaves(new Map());
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

    const validateComposerStep = (step: AssignmentComposerStep, showMessage = true): boolean => {
        if (step === 2 && effectiveStudents.length === 0) {
            if (showMessage) toast.error('과제를 받을 반 또는 학생을 선택하세요.');
            return false;
        }
        if (step === 2 && (initialDraft?.studentIds.length || selectedStudentIds.size) > 0 && !directContext) {
            if (showMessage) toast.error('개별 학생 과제가 기록될 반이나 개인 과제를 선택하세요.');
            return false;
        }
        if (step === 1 && !bookId) {
            if (showMessage) toast.error('문제집을 선택하세요.');
            return false;
        }
        if (step === 1 && !wholeBook && selectedUnitIds.size === 0) {
            if (showMessage) toast.error('배정할 단원 범위를 선택하세요.');
            return false;
        }
        if (step === 3 && !title.trim()) {
            if (showMessage) toast.error('과제명을 입력하세요.');
            return false;
        }
        return true;
    };

    const moveToComposerStep = (step: AssignmentComposerStep) => {
        if (step === 4) {
            const firstInvalidStep = ([1, 2, 3] as AssignmentComposerStep[])
                .find((candidate) => !validateComposerStep(candidate, false));
            if (firstInvalidStep) {
                setComposerStep(firstInvalidStep);
                validateComposerStep(firstInvalidStep);
                return;
            }
        }
        setComposerStep(step);
    };

    const advanceComposer = () => {
        if (!validateComposerStep(composerStep)) return;
        setComposerStep((current) => Math.min(4, current + 1) as AssignmentComposerStep);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (composerStep < 4) {
            advanceComposer();
            return;
        }
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
        if ((initialDraft?.studentIds.length || selectedStudentIds.size) > 0 && !directContext) {
            toast.error('개별 과제의 수강 반을 선택하거나 개인 과제로 지정하세요.');
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
            problemScopes: !wholeBook ? selectedProblemScopes : [],
            problemIds: [],
            excludedProblemIds: [...excludedProblemIds],
            classIds: initialDraft ? [] : [...selectedClassIds],
            studentIds: initialDraft ? initialDraft.studentIds : [...selectedStudentIds],
            directClassId: directContext && directContext !== 'personal' ? directContext : null,
            personal: directContext === 'personal',
            excludedStudentIds: initialDraft ? [] : [...excludedStudentIds],
            learningAnalysisActions: initialDraft?.actions.map((action) => ({
                actionId: action.id,
                studentId: action.studentId,
                skillId: action.skillId,
            })),
        }, null);
    };

    return (
        <form onSubmit={submit} className="space-y-5">
            <div className="space-y-4">
                    <section className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="border-b border-border bg-muted/35 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="font-semibold text-foreground">과제 배포 준비</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">한 단계씩 선택하고 마지막에 한 번만 배포합니다.</p>
                                </div>
                                <StatusBadge tone={readyStepCount === 3 ? 'success' : 'neutral'} label={`${readyStepCount}/3 준비 완료`} />
                            </div>
                        </div>
                        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
                            {assignmentComposerSteps.map((step) => {
                                const Icon = step.icon;
                                const completed = step.id === 1
                                    ? contentReady
                                    : step.id === 2
                                        ? targetReady
                                        : step.id === 3
                                            ? detailsReady
                                            : readyStepCount === 3;
                                const active = composerStep === step.id;
                                return (
                                    <Button
                                        key={step.id}
                                        type="button"
                                        variant="ghost"
                                        className={cn(
                                            'h-auto w-full justify-start gap-3 whitespace-normal rounded-none bg-card px-4 py-3 text-left hover:bg-muted/50',
                                            active && 'bg-primary-soft',
                                        )}
                                        aria-current={active ? 'step' : undefined}
                                        onClick={() => moveToComposerStep(step.id)}
                                    >
                                        <span className={cn(
                                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                                            active && 'border-primary bg-primary text-primary-foreground',
                                            !active && completed && 'border-success/40 bg-success-soft text-success-foreground',
                                            !active && !completed && 'border-border bg-muted text-muted-foreground',
                                        )}>
                                            {completed && !active ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                                        </span>
                                        <span className="min-w-0">
                                            <span className={cn('block text-sm font-semibold', active ? 'text-primary-strong' : 'text-foreground')}>
                                                {step.id}. {step.label}
                                            </span>
                                            <span className="block text-xs text-muted-foreground">{step.description}</span>
                                        </span>
                                    </Button>
                                );
                            })}
                        </div>
                    </section>
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
                    {composerStep === 3 && (
                        <FormSection
                            title="과제 이름과 마감일"
                            description="학생이 과제함에서 바로 알아볼 수 있는 이름을 사용하세요."
                            className="p-5"
                        >
                            <div className="grid gap-5 lg:grid-cols-2">
                                <FormField label="과제명" description="문제집과 선택 단원을 반영한 추천 제목을 쓸 수 있습니다.">
                                    <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 2단원 유형 복습" autoFocus />
                                    <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setTitle(suggestedTitle)}>
                                        추천 제목 사용
                                    </Button>
                                </FormField>
                                <FormField label="마감 일시" description="마감을 두지 않으면 언제든 풀 수 있습니다.">
                                    <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <Button type="button" variant="outline" size="xs" onClick={() => setDueAt(duePresetValue(0))}>오늘 22시</Button>
                                        <Button type="button" variant="outline" size="xs" onClick={() => setDueAt(duePresetValue(1))}>내일 22시</Button>
                                        <Button type="button" variant="outline" size="xs" onClick={() => setDueAt(duePresetValue(3))}>3일 후</Button>
                                        <Button type="button" variant="ghost" size="xs" onClick={() => setDueAt('')}>기한 없음</Button>
                                    </div>
                                </FormField>
                            </div>
                        </FormSection>
                    )}

                    {composerStep === 1 && (
                    <FormSection title="문제 구성" description="학년부터 자료 구분까지 선택한 뒤 필요한 세부 유형을 고르세요." className="p-5">
                            {data.books.length === 0 ? (
                                <div className="rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                                    등록된 문제집이 아직 없습니다. 문제집을 먼저 등록한 뒤 과제를 배포하세요.
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    <div className="space-y-2">
                                        <div>
                                            <p className="text-sm font-semibold text-foreground">문제 범위 찾기</p>
                                            <p className="mt-0.5 text-xs text-muted-foreground">학년 → 학기/과목 → 자료 구분 순서로 선택하세요.</p>
                                        </div>
                                        <AssignmentCatalogTree
                                            books={data.books}
                                            selectedBookId={bookId}
                                            selectedUnitIds={selectedUnitIds}
                                            selectedTypeIds={selectedTypeIds}
                                            selectedLeafKeys={new Set(selectedCatalogLeaves.keys())}
                                            onSelectLeaf={selectCatalogLeaf}
                                            onRemoveMiddle={removeCatalogMiddle}
                                        />
                                    </div>
                                    <div className="min-w-0 space-y-3">
                            {selectedBook ? (
                                <>
                                    <div className="rounded-lg border border-border bg-muted/35 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <p className="font-semibold text-foreground">{selectedBook.title}</p>
                                                <p className="mt-0.5 text-xs text-muted-foreground">
                                                    {selectedBook.grade || '학년 미분류'} · {selectedBook.units.length}개 단원 · {selectedBook.units[0]?.partName || '교재'}
                                                </p>
                                            </div>
                                            <Button type="button" variant="ghost" size="xs" onClick={resetScope}>선택 초기화</Button>
                                        </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <SelectableCard
                                            selected={!wholeBook}
                                            className="p-4"
                                            onClick={() => {
                                                if (!wholeBook) return;
                                                setWholeBook(false);
                                                setSelectedUnitIds(new Set());
                                                setSelectedTypeIds(new Set());
                                                setSelectedCatalogLeaves(new Map());
                                                setExcludedProblemIds(new Set());
                                            }}
                                        >
                                            <span className="flex items-start justify-between gap-3">
                                                <span>
                                                    <span className="block font-semibold text-foreground">필요한 단원만</span>
                                                    <span className="mt-1 block text-xs text-muted-foreground">단원을 고르고 필요하면 개별 문항을 조정합니다.</span>
                                                </span>
                                                {!wholeBook && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                                            </span>
                                        </SelectableCard>
                                        <SelectableCard
                                            selected={wholeBook}
                                            className="p-4"
                                            onClick={() => {
                                                setWholeBook(true);
                                                setSelectedUnitIds(new Set());
                                                setSelectedTypeIds(new Set());
                                                setSelectedCatalogLeaves(new Map());
                                                setExcludedProblemIds(new Set());
                                            }}
                                        >
                                            <span className="flex items-start justify-between gap-3">
                                                <span>
                                                    <span className="block font-semibold text-foreground">전체 문제집</span>
                                                    <span className="mt-1 block text-xs text-muted-foreground">이 교재의 모든 단원과 문항을 배포합니다.</span>
                                                </span>
                                                {wholeBook && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                                            </span>
                                        </SelectableCard>
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
                                                {unitProblemRows.map((row, index) => {
                                                    const expanded = expandedUnitIds.has(row.unit.id);
                                                    const selected = selectedUnitIds.has(row.unit.id);
                                                    const hasProblems = !row.loaded || row.totalCount === null || row.totalCount > 0;
                                                    const partName = row.unit.partName || '과정 미분류';
                                                    const showPartHeading = index === 0
                                                        || (unitProblemRows[index - 1]?.unit.partName || '과정 미분류') !== partName;

                                                    return (
                                                        <React.Fragment key={row.unit.id}>
                                                        {showPartHeading && (
                                                            <div className="sticky top-0 z-10 rounded-md border border-primary/20 bg-primary-soft px-3 py-2 text-xs font-semibold text-primary-strong">
                                                                {partName}
                                                            </div>
                                                        )}
                                                        <section className="rounded-lg border border-border bg-background">
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
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="rounded-xl border border-dashed border-border bg-muted/35 p-8 text-center">
                                    <Folder className="mx-auto h-8 w-8 text-warning" />
                                    <p className="mt-3 font-semibold text-foreground">위에서 세부 유형을 선택하세요.</p>
                                    <p className="mt-1 text-xs text-muted-foreground">선택한 유형의 교재와 문제 목록이 여기에 표시됩니다.</p>
                                </div>
                            )}
                                    </div>
                                </div>
                            )}
                    </FormSection>
                    )}

                    {composerStep === 2 && (
                    <FormSection title="배포 대상" description="반을 선택하면 재원 학생이 자동으로 포함됩니다." className="p-5">
                        <div className="space-y-5">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-semibold text-foreground">1. 반 선택</div>
                                    <StatusBadge tone={selectedClassIds.size > 0 ? 'primary' : 'neutral'} label={`${selectedClassIds.size}개 반`} />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {data.classes.filter((row) => row.active).map((row) => {
                                        const selected = selectedClassIds.has(row.id);
                                        const studentCount = data.students.filter((student) => (
                                            student.status === 'active' && student.classIds.includes(row.id)
                                        )).length;
                                        return (
                                            <SelectableCard
                                                key={row.id}
                                                selected={selected}
                                                className="flex items-center justify-between gap-3 p-3"
                                                onClick={() => {
                                                    toggleSetValue(setSelectedClassIds, row.id);
                                                    if (!selected) {
                                                        setExcludedStudentIds((current) => {
                                                            const next = new Set(current);
                                                            data.students
                                                                .filter((student) => student.classIds.includes(row.id))
                                                                .forEach((student) => next.delete(student.id));
                                                            return next;
                                                        });
                                                    }
                                                }}
                                            >
                                                <span>
                                                    <span className="block font-semibold text-foreground">{row.name}</span>
                                                    <span className="mt-0.5 block text-xs text-muted-foreground">재원 {studentCount}명</span>
                                                </span>
                                                {selected ? (
                                                    <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                                                ) : (
                                                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                )}
                                            </SelectableCard>
                                        );
                                    })}
                                    {data.classes.filter((row) => row.active).length === 0 && (
                                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                                            선택할 수 있는 반이 없습니다. 아래에서 개별 학생을 선택하세요.
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm font-semibold text-foreground">2. 학생 보정</div>
                                        <span className="text-xs text-muted-foreground">반 학생은 자동 포함</span>
                                    </div>
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input className="pl-9" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="이름이나 반으로 학생 검색" />
                                    </div>
                                    <div className="max-h-72 space-y-1 overflow-auto rounded-lg border bg-background p-2">
                                        {studentCandidates.map((student) => {
                                            const fromClass = selectedClassStudents.some((row) => row.id === student.id);
                                            const checked = (fromClass || selectedStudentIds.has(student.id)) && !excludedStudentIds.has(student.id);
                                            return (
                                                <label key={student.id} className={cn(
                                                    'flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted',
                                                    checked && 'bg-primary-soft/60',
                                                )}>
                                                    <Checkbox
                                                        checked={checked}
                                                        onCheckedChange={() => {
                                                            if (fromClass) {
                                                                toggleSetValue(setExcludedStudentIds, student.id);
                                                            } else if (excludedStudentIds.has(student.id)) {
                                                                setExcludedStudentIds((current) => {
                                                                    const next = new Set(current);
                                                                    next.delete(student.id);
                                                                    return next;
                                                                });
                                                                setSelectedStudentIds((current) => new Set([...current, student.id]));
                                                            } else {
                                                                toggleSetValue(setSelectedStudentIds, student.id);
                                                            }
                                                        }}
                                                    />
                                                    <span className="min-w-0">
                                                        <span className="block font-medium text-foreground">{student.name}</span>
                                                        <span className="block truncate text-xs text-muted-foreground">{student.classNames.join(', ') || '반 없음'}</span>
                                                    </span>
                                                    {fromClass && <span className="ml-auto shrink-0 text-[11px] text-primary-strong">반 자동</span>}
                                                </label>
                                            );
                                        })}
                                        {studentCandidates.length === 0 && (
                                            <p className="p-3 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</p>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-primary/25 bg-primary-soft/45 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="font-semibold text-foreground">최종 대상</div>
                                        <StatusBadge tone={effectiveStudents.length > 0 ? 'success' : 'warning'} label={`${effectiveStudents.length}명`} />
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">선택한 반과 개별 학생을 합친 실제 배포 명단입니다.</p>
                                    <div className="mt-3 flex max-h-48 flex-wrap content-start gap-1.5 overflow-auto">
                                        {effectiveStudents.slice(0, 24).map((student) => (
                                            <span key={student.id} className="rounded-full border border-primary/20 bg-card px-2.5 py-1 text-xs font-medium text-foreground">
                                                {student.name}
                                            </span>
                                        ))}
                                        {effectiveStudents.length > 24 && (
                                            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                                                +{effectiveStudents.length - 24}명
                                            </span>
                                        )}
                                        {effectiveStudents.length === 0 && (
                                            <p className="py-6 text-sm text-muted-foreground">아직 선택된 학생이 없습니다.</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                        {directStudents.length > 0 && (
                            <div className="rounded-lg border border-info/25 bg-info-soft p-4">
                                <div className="mb-2 text-sm font-semibold text-foreground">3. 개별 학생 기록 위치</div>
                                <Select value={directContext} onValueChange={setDirectContext}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="수강 반 또는 개인 과제를 선택하세요" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {directClassOptions.map((classRow) => (
                                            <SelectItem key={classRow.id} value={classRow.id}>{classRow.name}</SelectItem>
                                        ))}
                                        <SelectItem value="personal">개인 과제 · 반 진도에 포함하지 않음</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    선택한 학생 모두가 재원 중인 반만 표시됩니다. 개인 과제는 학생 상세의 개인 학습에만 기록됩니다.
                                </p>
                            </div>
                        )}
                        <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                            배포 시점의 학생 명단이 저장되므로, 이후 반 이동이 있어도 이 과제의 대상은 바뀌지 않습니다.
                        </div>
                        </div>
                    </FormSection>
                    )}

                    {composerStep === 4 && (
                        <FormSection
                            title="최종 배포 확인"
                            description="아래 내용이 학생에게 전송됩니다. 수정할 항목이 있으면 해당 단계로 돌아가세요."
                            className="p-5"
                        >
                            <div className="rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-success-foreground">
                                <div className="flex items-center gap-2 font-semibold">
                                    <CheckCircle2 className="h-4 w-4" />
                                    배포 준비가 완료됐습니다.
                                </div>
                                <p className="mt-1 text-xs">아래의 ‘이 내용으로 배포’를 누르기 전에는 학생에게 전송되지 않습니다.</p>
                            </div>
                            <div className="grid gap-3 lg:grid-cols-3">
                                <section className="rounded-xl border border-border bg-background p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">대상</p>
                                            <p className="mt-1 text-lg font-bold text-foreground">{effectiveStudents.length}명</p>
                                        </div>
                                        <Button type="button" variant="ghost" size="xs" onClick={() => setComposerStep(2)}>수정</Button>
                                    </div>
                                    <p className="mt-3 line-clamp-3 text-sm text-foreground">
                                        {selectedClassNames.length > 0 ? selectedClassNames.join(', ') : '개별 학생'}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {effectiveStudents.slice(0, 5).map((student) => student.name).join(', ')}
                                        {effectiveStudents.length > 5 ? ` 외 ${effectiveStudents.length - 5}명` : ''}
                                    </p>
                                </section>
                                <section className="rounded-xl border border-border bg-background p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">문제</p>
                                            <p className="mt-1 text-lg font-bold text-foreground">{problemSummary}</p>
                                        </div>
                                        <Button type="button" variant="ghost" size="xs" onClick={() => setComposerStep(1)}>수정</Button>
                                    </div>
                                    <p className="mt-3 line-clamp-2 text-sm font-medium text-foreground">{materialLabel}</p>
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                        {wholeBook ? '전체 문제집' : selectedUnits.map((unit) => unit.name).join(', ')}
                                    </p>
                                </section>
                                <section className="rounded-xl border border-border bg-background p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground">일정</p>
                                            <p className="mt-1 text-base font-bold text-foreground">{dueSummary}</p>
                                        </div>
                                        <Button type="button" variant="ghost" size="xs" onClick={() => setComposerStep(3)}>수정</Button>
                                    </div>
                                    <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
                                </section>
                            </div>
                        </FormSection>
                    )}

            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
                <Button type="button" variant="outline" onClick={onCancel}>
                    취소
                </Button>
                <div className="flex items-center gap-2">
                    {composerStep > 1 && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setComposerStep((current) => Math.max(1, current - 1) as AssignmentComposerStep)}
                        >
                            이전
                        </Button>
                    )}
                    {composerStep < 4 ? (
                        <Button
                            type="button"
                            className={cn('w-full', composerStep === 1 && 'col-span-2')}
                            onClick={advanceComposer}
                        >
                            다음: {assignmentComposerSteps[composerStep]?.label}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Button type="submit" className="w-full" disabled={submitting || readyStepCount < 3}>
                            {submitting ? '배포 중' : '이 내용으로 배포'}
                        </Button>
                    )}
                </div>
            </div>
        </form>
    );
}

function statusBadgeForRecipient(row: AssignmentRecipientProgress) {
    if (row.status === 'completed') return <StatusBadge tone="success" label="완료" />;
    if (row.status === 'in_progress') return <StatusBadge tone="warning" label="진행중" />;
    return <StatusBadge tone="neutral" label="미시작" />;
}

function accuracyTone(value: number | null): ProgressTone {
    if (value === null) return 'neutral';
    if (value >= 70) return 'success';
    if (value >= 50) return 'warning';
    return 'danger';
}

function typeInsightTone(insight: AssignmentTypeInsight): ProgressTone {
    return accuracyTone(insight.correctRate);
}

function problemInsightTone(problem: AssignmentProblemProgress): ProgressTone {
    return accuracyTone(problem.correctRate);
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
    assignments,
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
    onStudentProgressFilterChange,
}: {
    detail: LearningAssignmentDetail | null;
    assignments: LearningAssignmentSummary[];
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
    onStudentProgressFilterChange: (value: ProgressStatusFilter) => void;
}) {
    const [candidateIds, setCandidateIds] = useState<Set<string>>(new Set());
    const [candidateQuery, setCandidateQuery] = useState('');
    const [detailTab, setDetailTab] = useState('overview');
    const [expandedTypeKey, setExpandedTypeKey] = useState('');
    const [expandedStudentId, setExpandedStudentId] = useState('');

    useEffect(() => {
        setCandidateIds(new Set());
        setCandidateQuery('');
        setDetailTab('overview');
        setExpandedTypeKey('');
        setExpandedStudentId('');
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
    const typeInsights = buildAssignmentTypeInsights(detail.problems);
    const performanceComparison = buildAssignmentPerformanceComparison(
        assignment,
        assignments,
        classContextId,
    );
    const previousDelta = comparisonDelta(
        performanceComparison.currentCorrectRate,
        performanceComparison.previousAssignment?.correctRate ?? null,
    );
    const classAverageDelta = comparisonDelta(
        performanceComparison.currentCorrectRate,
        performanceComparison.recentClassAverage,
    );
    const weakTypeCount = typeInsights.filter((row) => row.correctRate !== null && row.correctRate < 50).length;
    const incompleteRecipients = scopedRecipients.filter((row) => row.status !== 'completed');
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
            <CardHeader className="border-b">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <CardTitle className="text-lg">{assignment.title}</CardTitle>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusBadge tone={dueTone(dueStatus(assignment))} label={dueLabel(dueStatus(assignment))} />
                            {classScoped && <StatusBadge tone="primary" label={classContextName || '선택 반'} />}
                            {!classScoped && assignment.targetLabels.slice(0, 2).map((label) => (
                                <StatusBadge key={label} tone="neutral" label={label} icon={false} />
                            ))}
                            <StatusBadge
                                tone="info"
                                label={assignment.sourceType === 'worksheet' ? 'PDF 과제' : '문제은행'}
                            />
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
                    </div>
                </div>
            </CardHeader>
            <div className="space-y-2 border-b px-5 py-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold text-foreground">제출률</span>
                    <span className="text-muted-foreground">
                        <strong className="text-foreground">{scopedProgress.completedCount}</strong>
                        /{scopedProgress.targetStudentCount}명 완료 · {scopedProgress.completionRate}%
                    </span>
                </div>
                <ProgressLine
                    value={scopedProgress.completionRate}
                    tone={accuracyTone(scopedProgress.completionRate)}
                />
            </div>
            <CardContent className="p-4">
                <Tabs
                    value={detailTab}
                    onValueChange={(value) => setDetailTab(value)}
                    variant="underline"
                >
                    <TabsList className="flex h-auto w-full flex-wrap justify-start overflow-x-auto">
                        <TabsTrigger value="overview">개요</TabsTrigger>
                        <TabsTrigger value="analysis">유형·문항 분석</TabsTrigger>
                        <TabsTrigger value="students">학생별 결과</TabsTrigger>
                    </TabsList>
                    <TabsContent value="overview">
                        <div className="space-y-5">
                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-lg border bg-muted p-3">
                                    <p className="text-xs text-muted-foreground">문항 수</p>
                                    <p className="mt-1 text-base font-bold text-foreground">{assignment.problemCount}문항</p>
                                </div>
                                <div className="rounded-lg border bg-muted p-3">
                                    <p className="text-xs text-muted-foreground">평균 정답률</p>
                                    <p className="mt-1 text-base font-bold text-foreground">{metricText(scopedProgress.correctRate)}</p>
                                </div>
                                <div className="rounded-lg border bg-muted p-3">
                                    <p className="text-xs text-muted-foreground">미완료</p>
                                    <p className="mt-1 text-base font-bold text-foreground">{incompleteRecipients.length}명</p>
                                </div>
                            </div>
                            {weakTypeCount > 0 && (
                                <PageStatusBar tone="warning">
                                    정답률 50% 미만 유형이 {weakTypeCount}개 있습니다. 분석 탭에서 보강할 문항을 확인하세요.
                                </PageStatusBar>
                            )}
                            <section className="space-y-3">
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">성취도 비교</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {classScoped ? classContextName || '개별 배정' : '같은 대상 반'}의 바로 이전 과제와 최근 과제 평균을 비교합니다.
                                    </p>
                                </div>
                                <div className="grid gap-3 md:grid-cols-3">
                                    <div className="rounded-lg border border-primary/20 bg-primary-soft p-3">
                                        <p className="text-xs font-medium text-primary-strong">현재 과제</p>
                                        <p className="mt-2 text-2xl font-bold text-foreground">
                                            {metricText(performanceComparison.currentCorrectRate)}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">평균 정답률</p>
                                    </div>
                                    <div className="rounded-lg border bg-card p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-xs font-medium text-muted-foreground">이전 과제</p>
                                            {performanceComparison.previousAssignment && (
                                                <StatusBadge
                                                    tone={previousDelta.tone}
                                                    label={previousDelta.label}
                                                    icon={false}
                                                />
                                            )}
                                        </div>
                                        <p className="mt-2 text-2xl font-bold text-foreground">
                                            {metricText(performanceComparison.previousAssignment?.correctRate ?? null)}
                                        </p>
                                        <p className="mt-1 truncate text-xs text-muted-foreground">
                                            {performanceComparison.previousAssignment?.title || '비교할 풀이 기록 없음'}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border bg-card p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-xs font-medium text-muted-foreground">최근 반 평균</p>
                                            {performanceComparison.recentClassAverage !== null && (
                                                <StatusBadge
                                                    tone={classAverageDelta.tone}
                                                    label={classAverageDelta.label}
                                                    icon={false}
                                                />
                                            )}
                                        </div>
                                        <p className="mt-2 text-2xl font-bold text-foreground">
                                            {metricText(performanceComparison.recentClassAverage)}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            최근 {performanceComparison.recentAssignmentCount || 0}개 과제 기준
                                        </p>
                                    </div>
                                </div>
                            </section>
                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-sm font-bold text-foreground">유형별 정답률</h3>
                                    {classScoped && <span className="text-xs text-muted-foreground">과제 전체 대상 기준</span>}
                                </div>
                                {typeInsights.slice(0, 4).map((row) => (
                                    <div key={row.key} className="grid gap-2 sm:grid-cols-[minmax(120px,0.7fr)_minmax(160px,1fr)_48px] sm:items-center">
                                        <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                                        <ProgressLine value={row.correctRate || 0} tone={typeInsightTone(row)} />
                                        <strong className={cn(
                                            'text-right text-sm',
                                            row.correctRate !== null && row.correctRate < 50 ? 'text-destructive' : 'text-foreground',
                                        )}>
                                            {metricText(row.correctRate)}
                                        </strong>
                                    </div>
                                ))}
                                {typeInsights.length === 0 && (
                                    <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                                        아직 유형별 분석에 사용할 풀이 기록이 없습니다.
                                    </p>
                                )}
                            </section>
                            <section className="space-y-3">
                                <h3 className="text-sm font-bold text-foreground">미완료 학생 · {incompleteRecipients.length}명</h3>
                                <div className="flex flex-wrap gap-2">
                                    {incompleteRecipients.slice(0, 12).map((row) => (
                                        <StatusBadge key={row.id} tone={row.status === 'in_progress' ? 'warning' : 'neutral'} label={row.studentName} />
                                    ))}
                                    {incompleteRecipients.length > 12 && (
                                        <StatusBadge tone="neutral" label={`+${incompleteRecipients.length - 12}명`} />
                                    )}
                                    {incompleteRecipients.length === 0 && (
                                        <span className="flex items-center gap-2 text-sm text-success-foreground">
                                            <CheckCircle2 className="h-4 w-4" />
                                            모든 학생이 완료했습니다.
                                        </span>
                                    )}
                                </div>
                            </section>
                        </div>
                    </TabsContent>
                    <TabsContent value="students">
                        <div className="space-y-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">학생별 진행 결과</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">학생을 누르면 풀이 요약과 상세 이동이 펼쳐집니다.</p>
                                </div>
                                <Select
                                    value={studentProgressFilter}
                                    onValueChange={(value) => onStudentProgressFilterChange(value as ProgressStatusFilter)}
                                >
                                    <SelectTrigger className="w-full sm:w-40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {progressStatusOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
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

                            <div className="space-y-2">
                                {displayedRecipients.map((row) => {
                                    const expanded = expandedStudentId === row.id;
                                    return (
                                        <div key={row.id} className="overflow-hidden rounded-lg border border-border bg-card">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="h-auto w-full justify-start rounded-none px-4 py-3 text-left"
                                                aria-expanded={expanded}
                                                onClick={() => setExpandedStudentId(expanded ? '' : row.id)}
                                            >
                                                <span className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                                                    <strong className="min-w-24 truncate text-sm text-foreground">{row.studentName}</strong>
                                                    {statusBadgeForRecipient(row)}
                                                    <span className="text-xs text-muted-foreground">{row.className || '반 미지정'}</span>
                                                    <span className="flex-1" />
                                                    <span className="text-xs text-muted-foreground">
                                                        정답률 <strong className={cn(
                                                            row.correctRate !== null && row.correctRate < 50 ? 'text-destructive' : 'text-foreground',
                                                        )}>{metricText(row.correctRate)}</strong>
                                                    </span>
                                                    {expanded
                                                        ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                        : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                                </span>
                                            </Button>
                                            {expanded && (
                                                <div className="border-t border-border bg-muted/35 p-4">
                                                    <div className="grid gap-2 text-sm sm:grid-cols-3">
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">풀이 문항</p>
                                                            <p className="mt-1 font-semibold text-foreground">{row.attemptedProblemCount}/{row.requiredProblemCount}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">총 시도</p>
                                                            <p className="mt-1 font-semibold text-foreground">{row.attemptCount}회</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">최근 활동</p>
                                                            <p className="mt-1 font-semibold text-foreground">{shortDate(row.lastActivityAt)}</p>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        <Button asChild variant="outline" size="sm">
                                                            <Link href={`/students/${encodeURIComponent(row.studentId)}`}>
                                                                학생 상세
                                                            </Link>
                                                        </Button>
                                                        {canManageRecipients && !recalled && (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={removingStudentId === row.studentId}
                                                                onClick={() => void onRemoveRecipient(row.studentId)}
                                                            >
                                                                <UserMinus className="mr-2 h-4 w-4" />
                                                                대상에서 제외
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {displayedRecipients.length === 0 && (
                                <EmptyState title="조건에 맞는 학생 현황이 없습니다." className="min-h-[140px]" />
                            )}
                        </div>
                    </TabsContent>
                    <TabsContent value="analysis">
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-sm font-bold text-foreground">유형·문항별 정답률</h3>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    유형을 누르면 어려웠던 문항부터 펼쳐집니다.
                                    {classScoped && ' 문항 통계는 과제 전체 대상 기준입니다.'}
                                </p>
                            </div>
                            {typeInsights.map((insight) => {
                                const expanded = expandedTypeKey === insight.key;
                                return (
                                    <div key={insight.key} className="overflow-hidden rounded-lg border border-border bg-card">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-auto w-full justify-start rounded-none px-4 py-3 text-left"
                                            aria-expanded={expanded}
                                            onClick={() => setExpandedTypeKey(expanded ? '' : insight.key)}
                                        >
                                            <span className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-center">
                                                <span className="min-w-0 md:w-44">
                                                    <strong className="block truncate text-sm text-foreground">{insight.name}</strong>
                                                    <span className="text-xs text-muted-foreground">{insight.problemCount}문항</span>
                                                </span>
                                                <span className="min-w-28 flex-1">
                                                    <ProgressLine value={insight.correctRate || 0} tone={typeInsightTone(insight)} />
                                                </span>
                                                <strong className={cn(
                                                    'w-12 text-right text-sm',
                                                    insight.correctRate !== null && insight.correctRate < 50 ? 'text-destructive' : 'text-foreground',
                                                )}>
                                                    {metricText(insight.correctRate)}
                                                </strong>
                                                {insight.correctRate !== null && insight.correctRate < 50 && (
                                                    <StatusBadge tone="danger" label="보강 필요" />
                                                )}
                                                {expanded
                                                    ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                            </span>
                                        </Button>
                                        {expanded && (
                                            <div className="space-y-2 border-t border-border bg-muted/35 p-3">
                                                {insight.problems.map((problem) => (
                                                    <div
                                                        key={problem.problemId}
                                                        className="grid gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm sm:grid-cols-[minmax(120px,0.8fr)_minmax(120px,1fr)_80px_48px] sm:items-center"
                                                    >
                                                        <span className="truncate font-medium text-foreground">{problem.label}</span>
                                                        <ProgressLine value={problem.correctRate || 0} tone={problemInsightTone(problem)} />
                                                        <span className="text-xs text-muted-foreground">{problem.attemptedStudentCount}명 풀이</span>
                                                        <strong className={cn(
                                                            'text-right',
                                                            problem.correctRate !== null && problem.correctRate < 50 ? 'text-destructive' : 'text-foreground',
                                                        )}>
                                                            {metricText(problem.correctRate)}
                                                        </strong>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {typeInsights.length === 0 && (
                                <EmptyState
                                    title="아직 분석할 풀이 기록이 없습니다."
                                    description="학생이 문제를 풀면 유형·문항별 정답률이 표시됩니다."
                                    className="min-h-[180px]"
                                />
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

const ALL_CLASS_KEY = '__all__';
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

function progressForAssignmentFilter(
    assignment: LearningAssignmentSummary,
    classId: string | null | undefined,
): AssignmentProgressSummary | null {
    return classId === undefined ? assignment.progress : progressForClass(assignment, classId);
}

function isClassAssignmentComplete(progress: AssignmentProgressSummary | null): boolean {
    return Boolean(progress && progress.targetStudentCount > 0 && progress.completedCount >= progress.targetStudentCount);
}

function classAssignmentSortScore(assignment: LearningAssignmentSummary, progress: AssignmentProgressSummary | null): number {
    const status = dueStatus(assignment);
    if (status === 'overdue') return 0;
    if (status === 'due_soon' && !isClassAssignmentComplete(progress)) return 1;
    if (!isClassAssignmentComplete(progress)) return 2;
    if (status === 'completed') return 4;
    if (status === 'recalled') return 5;
    return 3;
}

function sortClassAssignments(
    classId: string | null | undefined,
    assignments: LearningAssignmentSummary[],
): LearningAssignmentSummary[] {
    return [...assignments].sort((a, b) => {
        const aProgress = progressForAssignmentFilter(a, classId);
        const bProgress = progressForAssignmentFilter(b, classId);
        const scoreDiff = classAssignmentSortScore(a, aProgress) - classAssignmentSortScore(b, bProgress);
        if (scoreDiff !== 0) return scoreDiff;
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return a.title.localeCompare(b.title, 'ko');
    });
}

function assignmentMatchesStatus(
    assignment: LearningAssignmentSummary,
    progress: AssignmentProgressSummary | null,
    statusFilter: AssignmentStatusFilter,
): boolean {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'completed') return isClassAssignmentComplete(progress);
    return dueStatus(assignment) === statusFilter;
}

function visibleAssignmentsForClass(input: {
    assignments: LearningAssignmentSummary[];
    classId: string | null | undefined;
    searchQuery: string;
    statusFilter: AssignmentStatusFilter;
    includeCompleted: boolean;
}): LearningAssignmentSummary[] {
    const query = input.searchQuery.trim().toLowerCase();
    return sortClassAssignments(input.classId, input.assignments).filter((assignment) => {
        const progress = progressForAssignmentFilter(assignment, input.classId);
        if (!progress) return false;
        if (!input.includeCompleted && isClassAssignmentComplete(progress)) return false;
        if (
            !input.includeCompleted
            && input.statusFilter === 'all'
            && (!assignment.active || assignment.status === 'archived')
        ) {
            return false;
        }
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
    allAssignmentCount,
    selectedKey,
    onSelect,
}: {
    options: AssignmentClassOption[];
    allAssignmentCount: number;
    selectedKey: string;
    onSelect: (key: string) => void;
}) {
    return (
        <Select value={selectedKey} onValueChange={onSelect}>
            <SelectTrigger>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={ALL_CLASS_KEY}>전체 반 · {allAssignmentCount}개</SelectItem>
                {options.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                        {option.name} · {option.visibleAssignmentCount}개
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function ClassAssignmentList({
    assignments,
    classId,
    className,
    selectedAssignmentId,
    onSelect,
}: {
    assignments: LearningAssignmentSummary[];
    classId: string | null | undefined;
    className?: string;
    selectedAssignmentId: string;
    onSelect: (assignmentId: string) => void;
}) {
    if (assignments.length === 0) {
        return (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                검색 결과가 없어요
            </p>
        );
    }

    const groups = assignmentListGroupOrder
        .map((group) => ({
            group,
            assignments: assignments.filter((assignment) => assignmentListGroup(assignment) === group),
        }))
        .filter((row) => row.assignments.length > 0);

    return (
        <div className="flex flex-col gap-0.5">
            {groups.map((row) => (
                <React.Fragment key={row.group}>
                    <div className="mx-0.5 mb-0.5 mt-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {assignmentListGroupLabels[row.group]} · {row.assignments.length}
                    </div>
                    {row.assignments.map((assignment) => {
                        const progress = progressForAssignmentFilter(assignment, classId);
                        if (!progress) return null;
                        return (
                            <AssignmentCard
                                key={`${assignment.id}-${classId === undefined ? ALL_CLASS_KEY : assignmentClassKey(classId)}`}
                                assignment={assignment}
                                selected={assignment.id === selectedAssignmentId}
                                progress={progress}
                                className={className}
                                onSelect={() => onSelect(assignment.id)}
                            />
                        );
                    })}
                </React.Fragment>
            ))}
        </div>
    );
}

export function AssignmentsStatusPage({ initialAssignmentId = '' }: { initialAssignmentId?: string }) {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [data, setData] = useState<AssignmentManagementData | null>(() => (
        academyId ? peekAssignmentManagementData(academyId) : null
    ));
    const [detail, setDetail] = useState<LearningAssignmentDetail | null>(null);
    const [selectedClassKey, setSelectedClassKey] = useState(ALL_CLASS_KEY);
    const [selectedAssignmentId, setSelectedAssignmentId] = useState(initialAssignmentId);
    const initialSelectionApplied = useRef(false);
    const [filtersHydrated, setFiltersHydrated] = useState(false);
    const [loading, setLoading] = useState(data === null);
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
        const showRefreshing = options.background && !options.silent;
        if (showRefreshing) setRefreshing(true);
        else if (!options.background) setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId, { force: options.force });
            setData(next);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 현황을 불러오지 못했습니다.');
        } finally {
            if (showRefreshing) setRefreshing(false);
            else if (!options.background) setLoading(false);
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
        const params = new URLSearchParams(window.location.search);
        const requestedStatus = (params.get('status') as AssignmentStatusFilter | null) || 'all';
        const completedView = params.get('completed') === '1' || requestedStatus === 'completed';
        if (!initialAssignmentId) setSelectedAssignmentId(params.get('assignmentId') || '');
        setSearchQuery(params.get('q') || '');
        setStatusFilter(completedView ? 'completed' : requestedStatus);
        setIncludeCompleted(completedView);
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
        setSelectedClassKey((current) => (
            current === ALL_CLASS_KEY || classOptions.some((option) => option.key === current)
                ? current
                : ALL_CLASS_KEY
        ));
    }, [classOptions]);

    const selectedClass = useMemo(() => (
        selectedClassKey === ALL_CLASS_KEY
            ? null
            : classOptions.find((option) => option.key === selectedClassKey) || null
    ), [classOptions, selectedClassKey]);

    const selectedClassId = selectedClassKey === ALL_CLASS_KEY
        ? undefined
        : selectedClass
            ? assignmentClassIdFromKey(selectedClass.key)
            : undefined;

    const allVisibleAssignments = useMemo(() => (
        data
            ? visibleAssignmentsForClass({
                assignments: data.assignments,
                classId: undefined,
                searchQuery,
                statusFilter,
                includeCompleted,
            })
            : []
    ), [data, includeCompleted, searchQuery, statusFilter]);

    const visibleAssignments = useMemo(() => {
        if (!data) return [];
        if (selectedClassId === undefined) return allVisibleAssignments;
        const classAssignments = data.assignments.filter((assignment) => progressForClass(assignment, selectedClassId));
        return visibleAssignmentsForClass({
            assignments: classAssignments,
            classId: selectedClassId,
            searchQuery,
            statusFilter,
            includeCompleted,
        });
    }, [allVisibleAssignments, data, includeCompleted, searchQuery, selectedClassId, statusFilter]);

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

    const assignmentCounts = useMemo(() => {
        const assignments = data?.assignments || [];
        return {
            ongoing: assignments.filter((assignment) => {
                const group = assignmentListGroup(assignment);
                return group !== 'completed' && group !== 'recalled';
            }).length,
            completed: assignments.filter((assignment) => assignmentListGroup(assignment) === 'completed').length,
            today: assignments.filter((assignment) => assignmentListGroup(assignment) === 'today').length,
        };
    }, [data]);

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
            title="과제"
            subtitle={`진행 중 ${assignmentCounts.ongoing}건 · 오늘 마감 ${assignmentCounts.today}건`}
            icon={ClipboardList}
            actions={data?.permissions.canCreate ? (
                <>
                    <Button asChild variant="outline">
                        <Link href="/assignments/pdf-match">
                            <FileText className="mr-2 h-4 w-4" />
                            PDF 과제 배정
                        </Link>
                    </Button>
                    <Button asChild>
                        <Link href="/assignments/new">
                            <Plus className="mr-2 h-4 w-4" />
                            과제 만들기
                        </Link>
                    </Button>
                </>
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
                    <div className="grid min-h-[640px] items-start gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <section className="flex flex-col gap-3 self-start">
                            <div className="flex items-center justify-between gap-3 px-1">
                                <div className="flex min-w-0 items-center gap-2">
                                    <ClipboardList className="h-5 w-5 shrink-0 text-primary" />
                                    <h2 className="truncate text-base font-bold text-foreground">과제 목록</h2>
                                </div>
                                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                                    {visibleAssignments.length}건 표시
                                </span>
                            </div>
                            <Tabs
                                value={includeCompleted ? 'completed' : 'ongoing'}
                                onValueChange={(value) => {
                                    const completed = value === 'completed';
                                    setIncludeCompleted(completed);
                                    setStatusFilter(completed ? 'completed' : 'all');
                                    setSelectedAssignmentId('');
                                }}
                            >
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="ongoing">진행 중 {assignmentCounts.ongoing}</TabsTrigger>
                                    <TabsTrigger value="completed">완료 {assignmentCounts.completed}</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <AssignmentClassSelector
                                options={classOptions}
                                allAssignmentCount={allVisibleAssignments.length}
                                selectedKey={selectedClassKey}
                                onSelect={(key) => {
                                    setSelectedClassKey(key);
                                    setSelectedAssignmentId('');
                                }}
                            />
                            <div className="rounded-2xl border border-border bg-card p-2.5 shadow-card">
                                <div className="relative mb-2">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        className="h-10 pl-9"
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                        placeholder="과제명·반 검색"
                                    />
                                </div>
                                <div className="max-h-[480px] overflow-y-auto">
                                    <ClassAssignmentList
                                        assignments={visibleAssignments}
                                        classId={selectedClassId}
                                        className={selectedClass?.name}
                                        selectedAssignmentId={selectedAssignmentId}
                                        onSelect={setSelectedAssignmentId}
                                    />
                                </div>
                            </div>
                        </section>

                        {selectedAssignment ? (
                            <AssignmentDetailPanel
                                detail={detail}
                                assignments={data.assignments}
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
                                onStudentProgressFilterChange={setStudentProgressFilter}
                            />
                        ) : (
                            <Card>
                                <CardContent className="flex min-h-[520px] flex-col items-center justify-center gap-3 text-center">
                                    <CheckCircle2 className="h-9 w-9 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">과제를 선택하세요.</p>
                                        <p className="mt-1 text-xs text-muted-foreground">왼쪽 목록에서 과제를 선택하면 분석과 학생별 결과가 표시됩니다.</p>
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
    const [data, setData] = useState<AssignmentManagementData | null>(() => (
        academyId ? peekAssignmentManagementData(academyId) : null
    ));
    const [loading, setLoading] = useState(data === null);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [tab, setTab] = useState<AssignmentManageTab>('deploy');
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
        const showRefreshing = options.background && !options.silent;
        if (showRefreshing) setRefreshing(true);
        else if (!options.background) setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId, { force: options.force });
            setData(next);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 관리 데이터를 불러오지 못했습니다.');
        } finally {
            if (showRefreshing) setRefreshing(false);
            else if (!options.background) setLoading(false);
        }
    }, [academyId]);

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
