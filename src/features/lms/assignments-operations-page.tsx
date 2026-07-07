'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BarChart3,
    CheckCircle2,
    ClipboardList,
    FileText,
    Plus,
    RefreshCw,
    Search,
    Upload,
    UserMinus,
    UserPlus,
    Users,
    X,
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
import { FormField, FormSection } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    addAssignmentRecipients,
    addLmsInvalidationListener,
    createLearningAssignment,
    importWorksheetAssignment,
    loadAssignmentDetail,
    loadAssignmentManagementData,
    removeAssignmentRecipient,
} from './service';
import type {
    AssignmentBookSummary,
    AssignmentClassProgressSummary,
    AssignmentManagementData,
    AssignmentProblemSummary,
    AssignmentRecipientProgress,
    CreateLearningAssignmentInput,
    LearningAssignmentDetail,
    LearningAssignmentSummary,
    StudentSummary,
} from './types';

type SourceType = 'content_scope' | 'worksheet';
type AssignmentPageLoadOptions = { force?: boolean; background?: boolean };
type AssignmentViewMode = 'all' | 'by_class';
type AssignmentStatusFilter = 'all' | 'open' | 'due_soon' | 'overdue' | 'completed';

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
    if (status === 'overdue') return '기한 지남';
    if (status === 'due_soon') return '기한 임박';
    return '진행중';
}

function dueTone(status: AssignmentStatusFilter): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' {
    if (status === 'completed') return 'success';
    if (status === 'overdue') return 'danger';
    if (status === 'due_soon') return 'warning';
    return 'primary';
}

function problemLabel(problem: AssignmentProblemSummary): string {
    return `p.${problem.pagePrinted} · ${problem.number}${problem.typeName ? ` · ${problem.typeName}` : ''}`;
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
        <SelectableCard selected={selected} onClick={onSelect} className="space-y-3">
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
                <StatusBadge tone={dueTone(status)} label={dueLabel(status)} />
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
            <div className="flex flex-wrap gap-1.5">
                {assignment.classProgress.slice(0, 3).map((row) => (
                    <StatusBadge key={row.classId || row.className} tone="neutral" label={`${classLabel(row)} ${row.completedCount}/${row.targetStudentCount}`} />
                ))}
                {assignment.classProgress.length > 3 && <StatusBadge tone="neutral" label={`+${assignment.classProgress.length - 3}`} />}
            </div>
        </SelectableCard>
    );
}

function AssignmentList({
    assignments,
    classes,
    selectedAssignmentId,
    viewMode,
    onSelect,
}: {
    assignments: LearningAssignmentSummary[];
    classes: AssignmentManagementData['classes'];
    selectedAssignmentId: string;
    viewMode: AssignmentViewMode;
    onSelect: (id: string) => void;
}) {
    if (assignments.length === 0) {
        return <EmptyState title="조건에 맞는 과제가 없습니다." />;
    }

    if (viewMode === 'by_class') {
        const classGroups = classes
            .map((classRow) => ({
                classRow,
                rows: assignments
                    .map((assignment) => ({
                        assignment,
                        progress: assignment.classProgress.find((row) => row.classId === classRow.id) || null,
                    }))
                    .filter((row) => row.progress),
            }))
            .filter((group) => group.rows.length > 0);
        const individualRows = assignments
            .map((assignment) => ({
                assignment,
                progress: assignment.classProgress.find((row) => row.classId === null) || null,
            }))
            .filter((row) => row.progress);

        return (
            <div className="space-y-4">
                {[...classGroups, individualRows.length > 0 ? { classRow: null, rows: individualRows } : null].filter(Boolean).map((group) => (
                    <div key={group!.classRow?.id || 'individual'} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                            <p className="text-sm font-semibold text-foreground">{group!.classRow?.name || '개별 학생'}</p>
                            <span className="text-xs text-muted-foreground">{group!.rows.length}개 과제</span>
                        </div>
                        <div className="space-y-2">
                            {group!.rows.map(({ assignment, progress }) => (
                                <AssignmentCard
                                    key={`${assignment.id}-${progress!.classId || 'individual'}`}
                                    assignment={assignment}
                                    selected={assignment.id === selectedAssignmentId}
                                    classContext={progress}
                                    onSelect={() => onSelect(assignment.id)}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {assignments.map((assignment) => (
                <AssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    selected={assignment.id === selectedAssignmentId}
                    onSelect={() => onSelect(assignment.id)}
                />
            ))}
        </div>
    );
}

function selectedProblemIds(
    book: AssignmentBookSummary | null,
    wholeBook: boolean,
    selectedUnitIds: Set<string>,
    selectedTypeIds: Set<string>,
    excludedProblemIds: Set<string>,
): string[] {
    if (!book) return [];
    if (wholeBook) return book.problems.filter((problem) => !excludedProblemIds.has(problem.id)).map((problem) => problem.id);
    if (selectedUnitIds.size === 0) return [];
    return book.problems
        .filter((problem) => (
            selectedUnitIds.has(problem.unitId)
            && (!problem.problemTypeId || selectedTypeIds.has(problem.problemTypeId))
            && !excludedProblemIds.has(problem.id)
        ))
        .map((problem) => problem.id);
}

function AssignmentComposer({
    data,
    submitting,
    onCancel,
    onSubmit,
}: {
    data: AssignmentManagementData;
    submitting: boolean;
    onCancel: () => void;
    onSubmit: (input: CreateLearningAssignmentInput, file: File | null) => Promise<void>;
}) {
    const [sourceType, setSourceType] = useState<SourceType>('content_scope');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [dueAt, setDueAt] = useState('');
    const [bookId, setBookId] = useState(data.books[0]?.id || '');
    const [wholeBook, setWholeBook] = useState(false);
    const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
    const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
    const [excludedProblemIds, setExcludedProblemIds] = useState<Set<string>>(new Set());
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
    const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
    const [excludedStudentIds, setExcludedStudentIds] = useState<Set<string>>(new Set());
    const [studentSearch, setStudentSearch] = useState('');
    const [worksheetFile, setWorksheetFile] = useState<File | null>(null);

    const selectedBook = data.books.find((book) => book.id === bookId) || null;
    const previewProblemIds = useMemo(
        () => selectedProblemIds(selectedBook, wholeBook, selectedUnitIds, selectedTypeIds, excludedProblemIds),
        [excludedProblemIds, selectedBook, selectedTypeIds, selectedUnitIds, wholeBook],
    );
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

    const toggleUnit = (unitId: string) => {
        if (!selectedBook) return;
        setWholeBook(false);
        setSelectedUnitIds((prev) => {
            const next = new Set(prev);
            const typeIds = selectedBook.problemTypes.filter((type) => type.unitId === unitId).map((type) => type.id);
            if (next.has(unitId)) {
                next.delete(unitId);
                setSelectedTypeIds((current) => {
                    const updated = new Set(current);
                    typeIds.forEach((id) => updated.delete(id));
                    return updated;
                });
            } else {
                next.add(unitId);
                setSelectedTypeIds((current) => new Set([...current, ...typeIds]));
            }
            setExcludedProblemIds(new Set());
            return next;
        });
    };

    const resetScope = () => {
        setWholeBook(false);
        setSelectedUnitIds(new Set());
        setSelectedTypeIds(new Set());
        setExcludedProblemIds(new Set());
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
        if (sourceType === 'content_scope' && !bookId) {
            toast.error('교재를 선택하세요.');
            return;
        }
        if (sourceType === 'content_scope' && previewProblemIds.length === 0) {
            toast.error('배정할 문제 범위를 선택하세요.');
            return;
        }
        if (sourceType === 'worksheet' && !worksheetFile) {
            toast.error('학습지 export 파일을 선택하세요.');
            return;
        }

        await onSubmit({
            title: title.trim(),
            description: description.trim() || null,
            dueAt: toDueIso(dueAt),
            context: 'homework',
            sourceType,
            bookId: sourceType === 'content_scope' ? bookId : null,
            unitIds: sourceType === 'content_scope' && !wholeBook ? [...selectedUnitIds] : [],
            problemTypeIds: sourceType === 'content_scope' && !wholeBook ? [...selectedTypeIds] : [],
            problemIds: sourceType === 'content_scope' && !wholeBook ? previewProblemIds : [],
            classIds: [...selectedClassIds],
            studentIds: [...selectedStudentIds],
            excludedStudentIds: [...excludedStudentIds],
        }, worksheetFile);
    };

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle>새 과제</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">범위와 대상을 확인한 뒤 배정합니다.</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel} aria-label="닫기">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-4">
                <form onSubmit={submit} className="space-y-4">
                    <FormSection title="기본 정보">
                        <div className="grid gap-3 md:grid-cols-2">
                            <FormField label="과제명">
                                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="2단원 유형 복습" />
                            </FormField>
                            <FormField label="기한">
                                <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                            </FormField>
                        </div>
                        <FormField label="설명">
                            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="학생에게 보일 간단한 안내" rows={3} />
                        </FormField>
                    </FormSection>

                    <FormSection title="출처">
                        <div className="grid gap-3 md:grid-cols-2">
                            <SelectableCard selected={sourceType === 'content_scope'} onClick={() => setSourceType('content_scope')}>
                                <FileText className="mb-2 h-4 w-4 text-primary" />
                                <div className="font-semibold">교재 범위</div>
                                <div className="mt-1 text-xs text-muted-foreground">단원, 세부유형, 문제를 선택합니다.</div>
                            </SelectableCard>
                            <SelectableCard selected={sourceType === 'worksheet'} onClick={() => setSourceType('worksheet')}>
                                <Upload className="mb-2 h-4 w-4 text-primary" />
                                <div className="font-semibold">학습지 export</div>
                                <div className="mt-1 text-xs text-muted-foreground">crop-trainer zip/json을 과제로 등록합니다.</div>
                            </SelectableCard>
                        </div>
                    </FormSection>

                    {sourceType === 'content_scope' ? (
                        <FormSection title="문제 범위" description={`${previewProblemIds.length}문항이 배정됩니다.`}>
                            <FormField label="교재">
                                <Select
                                    value={bookId}
                                    onValueChange={(value) => {
                                        setBookId(value);
                                        resetScope();
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="교재 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {data.books.map((book) => <SelectItem key={book.id} value={book.id}>{book.title}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </FormField>

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
                                            전체 교재
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" onClick={resetScope}>범위 초기화</Button>
                                    </div>
                                    {!wholeBook && (
                                        <div className="grid gap-4 lg:grid-cols-[0.8fr_0.8fr_1.2fr]">
                                            <div>
                                                <div className="mb-2 text-sm font-semibold">단원</div>
                                                <div className="max-h-72 space-y-1 overflow-auto rounded-lg border bg-card p-2">
                                                    {selectedBook.units.map((unit) => (
                                                        <label key={unit.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                                                            <Checkbox checked={selectedUnitIds.has(unit.id)} onCheckedChange={() => toggleUnit(unit.id)} />
                                                            <span>{unit.name} <span className="text-xs text-muted-foreground">({unit.problemCount})</span></span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-2 text-sm font-semibold">세부유형</div>
                                                <div className="max-h-72 space-y-1 overflow-auto rounded-lg border bg-card p-2">
                                                    {selectedBook.problemTypes
                                                        .filter((type) => !type.unitId || selectedUnitIds.has(type.unitId))
                                                        .map((type) => (
                                                            <label key={type.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                                                                <Checkbox checked={selectedTypeIds.has(type.id)} onCheckedChange={() => toggleSetValue(setSelectedTypeIds, type.id)} />
                                                                <span>{type.name} <span className="text-xs text-muted-foreground">({type.problemCount})</span></span>
                                                            </label>
                                                        ))}
                                                    {selectedUnitIds.size === 0 && <p className="p-2 text-xs text-muted-foreground">단원을 먼저 선택하세요.</p>}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-2 text-sm font-semibold">포함 문제</div>
                                                <div className="max-h-72 space-y-1 overflow-auto rounded-lg border bg-card p-2">
                                                    {selectedBook.problems
                                                        .filter((problem) => selectedUnitIds.has(problem.unitId))
                                                        .map((problem) => {
                                                            const included = previewProblemIds.includes(problem.id);
                                                            return (
                                                                <label key={problem.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                                                                    <Checkbox
                                                                        checked={included}
                                                                        onCheckedChange={() => {
                                                                            setExcludedProblemIds((prev) => {
                                                                                const next = new Set(prev);
                                                                                if (included) next.add(problem.id);
                                                                                else next.delete(problem.id);
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    />
                                                                    <span className={cn(!included && 'text-muted-foreground')}>{problemLabel(problem)}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    {selectedUnitIds.size === 0 && <p className="p-2 text-xs text-muted-foreground">선택한 단원의 문제가 여기에 표시됩니다.</p>}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </FormSection>
                    ) : (
                        <FormSection title="학습지 파일">
                            <FormField label="crop-trainer export zip/json">
                                <Input
                                    type="file"
                                    accept=".zip,.json,application/zip,application/json"
                                    onChange={(event) => setWorksheetFile(event.target.files?.[0] || null)}
                                />
                            </FormField>
                        </FormSection>
                    )}

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
                            <div className="font-semibold text-foreground">생성 후 대상 스냅샷</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                반 이동이 있어도 이 과제의 대상 수는 유지됩니다. 새 반원은 과제 상세에서 수동으로 추가할 수 있습니다.
                            </p>
                        </div>
                    </FormSection>

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={onCancel}>취소</Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? '생성 중' : '과제 생성'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function statusBadgeForRecipient(row: AssignmentRecipientProgress) {
    if (row.status === 'completed') return <StatusBadge tone="success" label="완료" />;
    if (row.status === 'in_progress') return <StatusBadge tone="warning" label="진행중" />;
    return <StatusBadge tone="neutral" label="미시작" />;
}

function AssignmentDetailPanel({
    detail,
    loading,
    error,
    canManageRecipients,
    addingRecipients,
    removingStudentId,
    onRetry,
    onAddRecipients,
    onRemoveRecipient,
}: {
    detail: LearningAssignmentDetail | null;
    loading: boolean;
    error: string | null;
    canManageRecipients: boolean;
    addingRecipients: boolean;
    removingStudentId: string;
    onRetry: () => void;
    onAddRecipients: (studentIds: string[]) => Promise<void>;
    onRemoveRecipient: (studentId: string) => Promise<void>;
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
    const candidates = detail.candidateStudents
        .filter((student) => {
            const query = candidateQuery.trim().toLowerCase();
            return !query || `${student.name} ${student.classNames.join(' ')}`.toLowerCase().includes(query);
        })
        .slice(0, 80);

    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <CardTitle>{assignment.title}</CardTitle>
                            <StatusBadge tone={dueTone(dueStatus(assignment))} label={dueLabel(dueStatus(assignment))} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {assignment.bookTitle || '외부 학습지'} · {assignment.problemCount}문항 · {formatDate(assignment.dueAt)}
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right text-xs">
                        <div className="rounded-lg bg-muted px-3 py-2">
                            <p className="text-muted-foreground">대상</p>
                            <p className="font-semibold text-foreground">{assignment.progress.targetStudentCount}명</p>
                        </div>
                        <div className="rounded-lg bg-muted px-3 py-2">
                            <p className="text-muted-foreground">완료</p>
                            <p className="font-semibold text-foreground">{assignment.progress.completedCount}명</p>
                        </div>
                        <div className="rounded-lg bg-muted px-3 py-2">
                            <p className="text-muted-foreground">정답률</p>
                            <p className="font-semibold text-foreground">{metricText(assignment.progress.correctRate)}</p>
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
                                {assignment.classProgress.map((row) => (
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
                            {canManageRecipients && (
                                <FormSection title="새 대상 추가" description="과제 생성 이후 반에 들어온 학생을 수동으로 추가합니다.">
                                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                                        <div className="relative">
                                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                            <Input className="pl-9" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="추가할 학생 검색" />
                                        </div>
                                        <Button
                                            type="button"
                                            disabled={candidateIds.size === 0 || addingRecipients}
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
                                            {canManageRecipients && <TableHead>관리</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {detail.recipients.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell className="font-medium">{row.studentName}</TableCell>
                                                <TableCell>{row.className || '-'}</TableCell>
                                                <TableCell>{statusBadgeForRecipient(row)}</TableCell>
                                                <TableCell>{row.attemptedProblemCount}/{row.requiredProblemCount}</TableCell>
                                                <TableCell>{metricText(row.correctRate)}</TableCell>
                                                <TableCell>{shortDate(row.lastActivityAt)}</TableCell>
                                                {canManageRecipients && (
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

export function AssignmentsOperationsPage() {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [data, setData] = useState<AssignmentManagementData | null>(null);
    const [detail, setDetail] = useState<LearningAssignmentDetail | null>(null);
    const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [addingRecipients, setAddingRecipients] = useState(false);
    const [removingStudentId, setRemovingStudentId] = useState('');
    const [composerOpen, setComposerOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [classFilter, setClassFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState<AssignmentStatusFilter>('all');
    const [viewMode, setViewMode] = useState<AssignmentViewMode>('by_class');

    const load = useCallback(async (options: AssignmentPageLoadOptions = {}) => {
        if (!academyId) return;
        if (options.background) setRefreshing(true);
        else setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId, { force: options.force });
            setData(next);
            setSelectedAssignmentId((current) => (
                current && next.assignments.some((assignment) => assignment.id === current)
                    ? current
                    : next.assignments[0]?.id || ''
            ));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 데이터를 불러오지 못했습니다.');
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

    const filteredAssignments = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return (data?.assignments || []).filter((assignment) => {
            if (query && !`${assignment.title} ${assignment.bookTitle || ''} ${assignment.targetLabels.join(' ')}`.toLowerCase().includes(query)) {
                return false;
            }
            if (classFilter !== 'all' && !assignment.classIds.includes(classFilter)) return false;
            if (statusFilter !== 'all' && dueStatus(assignment) !== statusFilter) return false;
            return true;
        });
    }, [classFilter, data?.assignments, searchQuery, statusFilter]);

    const selectedAssignment = data?.assignments.find((assignment) => assignment.id === selectedAssignmentId) || null;

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
            toast.success('과제를 생성했습니다.');
            setComposerOpen(false);
            await load({ force: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '과제 생성에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

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
            description="반별 과제 현황을 확인하고, 교재 범위나 학습지를 학생에게 배정합니다."
            icon={ClipboardList}
            actions={data?.permissions.canCreate ? (
                <Button type="button" onClick={() => setComposerOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    새 과제
                </Button>
            ) : undefined}
        >
            {!loading && refreshing && (
                <PageStatusBar tone="neutral" className="text-xs">
                    <span className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        최신 과제 데이터를 동기화하는 중
                    </span>
                </PageStatusBar>
            )}

            {loading && <SkeletonPanel className="min-h-[520px]" rows={8} />}
            {!loading && error && (
                <ErrorState title={error} retryLabel="다시 시도" onRetry={() => void load({ force: true })} />
            )}

            {!loading && !error && data && (
                <div className="grid min-h-[620px] gap-5 xl:grid-cols-[0.95fr_1.45fr]">
                    <Card className="overflow-hidden">
                        <CardHeader className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <CardTitle>과제 목록</CardTitle>
                                {data.permissions.scopedToAssignedClasses && (
                                    <StatusBadge tone="neutral" label="내 반만" />
                                )}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input className="pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="과제명, 교재, 대상 검색" />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <Select value={viewMode} onValueChange={(value) => setViewMode(value as AssignmentViewMode)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="by_class">반별 보기</SelectItem>
                                            <SelectItem value="all">전체 과제</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={classFilter} onValueChange={setClassFilter}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">전체 반</SelectItem>
                                            {data.classes.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as AssignmentStatusFilter)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">전체 상태</SelectItem>
                                            <SelectItem value="open">진행중</SelectItem>
                                            <SelectItem value="due_soon">기한 임박</SelectItem>
                                            <SelectItem value="overdue">기한 지남</SelectItem>
                                            <SelectItem value="completed">완료</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="max-h-[calc(100vh-18rem)] overflow-auto p-4 pt-0">
                            <AssignmentList
                                assignments={filteredAssignments}
                                classes={data.classes}
                                selectedAssignmentId={selectedAssignmentId}
                                viewMode={viewMode}
                                onSelect={(id) => {
                                    setComposerOpen(false);
                                    setSelectedAssignmentId(id);
                                }}
                            />
                        </CardContent>
                    </Card>

                    {composerOpen ? (
                        <AssignmentComposer
                            data={data}
                            submitting={submitting}
                            onCancel={() => setComposerOpen(false)}
                            onSubmit={submitAssignment}
                        />
                    ) : selectedAssignment ? (
                        <AssignmentDetailPanel
                            detail={detail}
                            loading={detailLoading}
                            error={detailError}
                            canManageRecipients={data.permissions.canManageRecipients}
                            addingRecipients={addingRecipients}
                            removingStudentId={removingStudentId}
                            onRetry={() => void loadDetail(selectedAssignment.id, { force: true })}
                            onAddRecipients={addRecipients}
                            onRemoveRecipient={removeRecipient}
                        />
                    ) : (
                        <Card>
                            <CardContent className="flex min-h-[520px] flex-col items-center justify-center gap-3 text-center">
                                <CheckCircle2 className="h-9 w-9 text-muted-foreground" />
                                <div>
                                    <p className="text-sm font-medium text-foreground">과제가 없습니다.</p>
                                    <p className="mt-1 text-xs text-muted-foreground">새 과제를 만들면 반별 현황이 이곳에 표시됩니다.</p>
                                </div>
                                {data.permissions.canCreate && (
                                    <Button type="button" variant="outline" size="sm" onClick={() => setComposerOpen(true)}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        새 과제
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </PageShell>
    );
}
