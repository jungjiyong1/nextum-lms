'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { StatusBadge } from '@/components/ui/status-badge';
import {
    addLmsInvalidationListener,
    createLearningAssignment,
    importWorksheetAssignment,
    loadAssignmentManagementData,
} from './service';
import type {
    AssignmentBookSummary,
    AssignmentManagementData,
    AssignmentProblemSummary,
    CreateLearningAssignmentInput,
} from './types';

type SourceType = 'content_scope' | 'worksheet';
type AssignmentPageLoadOptions = { force?: boolean; background?: boolean };

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
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

function toDueIso(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}

function toggleSetValue(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
}

function selectedProblemIds(
    book: AssignmentBookSummary | null,
    selectedUnitIds: Set<string>,
    selectedTypeIds: Set<string>,
    selectedProblemIdsSet: Set<string>,
): string[] {
    if (!book) return [];
    const hasScope = selectedUnitIds.size > 0 || selectedTypeIds.size > 0 || selectedProblemIdsSet.size > 0;
    const ids = new Set<string>();
    for (const problem of book.problems) {
        if (
            !hasScope
            || selectedUnitIds.has(problem.unitId)
            || (problem.problemTypeId && selectedTypeIds.has(problem.problemTypeId))
            || selectedProblemIdsSet.has(problem.id)
        ) {
            ids.add(problem.id);
        }
    }
    return [...ids];
}

function problemLabel(problem: AssignmentProblemSummary): string {
    return `p.${problem.pagePrinted} · ${problem.number}${problem.typeName ? ` · ${problem.typeName}` : ''}`;
}

export function AssignmentsOperationsPage() {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [data, setData] = useState<AssignmentManagementData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [sourceType, setSourceType] = useState<SourceType>('content_scope');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [dueAt, setDueAt] = useState('');
    const [bookId, setBookId] = useState('');
    const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
    const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
    const [selectedProblemIdsSet, setSelectedProblemIdsSet] = useState<Set<string>>(new Set());
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
    const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
    const [worksheetFile, setWorksheetFile] = useState<File | null>(null);

    const load = useCallback(async (options: AssignmentPageLoadOptions = {}) => {
        if (!academyId) return;
        if (options.background) setRefreshing(true);
        else setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId, { force: options.force });
            setData(next);
            setBookId((current) => current || next.books[0]?.id || '');
            setError(null);
            setHasExternalUpdate(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 데이터를 불러오지 못했습니다.');
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
            if (submitting) {
                setHasExternalUpdate(true);
                return;
            }
            void load({ force: true, background: true });
        });
    }, [academyId, load, submitting]);

    const selectedBook = useMemo(
        () => data?.books.find((book) => book.id === bookId) || null,
        [bookId, data?.books],
    );
    const previewProblemIds = useMemo(
        () => selectedProblemIds(selectedBook, selectedUnitIds, selectedTypeIds, selectedProblemIdsSet),
        [selectedBook, selectedProblemIdsSet, selectedTypeIds, selectedUnitIds],
    );

    const resetScope = () => {
        setSelectedUnitIds(new Set());
        setSelectedTypeIds(new Set());
        setSelectedProblemIdsSet(new Set());
    };

    const resetForm = () => {
        setTitle('');
        setDescription('');
        setDueAt('');
        resetScope();
        setSelectedClassIds(new Set());
        setSelectedStudentIds(new Set());
        setWorksheetFile(null);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!academyId) return;
        if (!title.trim()) {
            toast.error('과제명을 입력하세요.');
            return;
        }
        const classIds = [...selectedClassIds];
        const studentIds = [...selectedStudentIds];
        if (classIds.length === 0 && studentIds.length === 0) {
            toast.error('반 또는 학생 대상을 선택하세요.');
            return;
        }

        const input: CreateLearningAssignmentInput = {
            title: title.trim(),
            description: description.trim() || null,
            dueAt: toDueIso(dueAt),
            context: 'homework',
            classIds,
            studentIds,
            sourceType,
        };

        setSubmitting(true);
        try {
            if (sourceType === 'worksheet') {
                if (!worksheetFile) throw new Error('학습지 export zip/json 파일을 선택하세요.');
                await importWorksheetAssignment(academyId, input, worksheetFile);
            } else {
                if (!bookId) throw new Error('교재를 선택하세요.');
                await createLearningAssignment(academyId, {
                    ...input,
                    bookId,
                    unitIds: [...selectedUnitIds],
                    problemTypeIds: [...selectedTypeIds],
                    problemIds: [...selectedProblemIdsSet],
                });
            }
            toast.success('과제를 생성했습니다.');
            resetForm();
            await load({ force: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '과제 생성에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!academyId) {
        return (
            <div className="mx-auto flex h-full max-w-xl items-center justify-center p-8">
                <Card>
                    <CardHeader><CardTitle>학원 연결이 필요합니다</CardTitle></CardHeader>
                    <CardContent className="text-sm text-muted-foreground">현재 계정에 연결된 academy가 없습니다.</CardContent>
                </Card>
            </div>
        );
    }

    return (
        <PageShell
            title="과제 관리"
            description="교재 범위 또는 crop-trainer 학습지를 학생 과제로 배정합니다."
            icon={ClipboardList}
            actions={(
                <Button type="button" variant="outline" onClick={() => void load({ force: true })} disabled={loading}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    새로고침
                </Button>
            )}
        >

            {!loading && refreshing && (
                <PageStatusBar tone="neutral" className="text-xs">
                    <span className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        최신 데이터 동기화 중
                    </span>
                </PageStatusBar>
            )}
            {!loading && hasExternalUpdate && (
                <PageStatusBar
                    tone="warning"
                    className="text-xs"
                    action={(
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setHasExternalUpdate(false);
                                void load({ force: true });
                            }}
                        >
                            새로고침
                        </Button>
                    )}
                >
                    작업 중 새 데이터가 들어왔습니다.
                </PageStatusBar>
            )}

            {loading && <SkeletonPanel className="min-h-[360px]" rows={7} />}
            {error && (
                <ErrorState title={error} retryLabel="다시 시도" onRetry={() => void load({ force: true })} />
            )}

            {data && (
                <div className="grid min-h-0 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                    <Card>
                        <CardHeader><CardTitle>새 과제</CardTitle></CardHeader>
                        <CardContent>
                            <form onSubmit={submit} className="space-y-5">
                                <div className="grid gap-3 md:grid-cols-2">
                                    <SelectableCard
                                        selected={sourceType === 'content_scope'}
                                        onClick={() => setSourceType('content_scope')}
                                    >
                                        <div className="font-semibold">교재 범위</div>
                                        <div className="mt-1 text-xs text-muted-foreground">단원, 세부유형, 문항을 선택합니다.</div>
                                    </SelectableCard>
                                    <SelectableCard
                                        selected={sourceType === 'worksheet'}
                                        onClick={() => setSourceType('worksheet')}
                                    >
                                        <div className="font-semibold">학습지 export</div>
                                        <div className="mt-1 text-xs text-muted-foreground">crop-trainer zip/json을 과제로 등록합니다.</div>
                                    </SelectableCard>
                                </div>

                                <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                        <Label>과제명</Label>
                                        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 2단원 유형 복습" />
                                    </div>
                                    <div>
                                        <Label>기한</Label>
                                        <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                                    </div>
                                </div>
                                <div>
                                    <Label>설명</Label>
                                    <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="학생에게 보일 간단한 안내" rows={3} />
                                </div>

                                {sourceType === 'content_scope' ? (
                                    <div className="space-y-4 rounded-xl border bg-muted/50 p-4">
                                        <div>
                                            <Label>교재</Label>
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
                                                    {data.books.map((book) => (
                                                        <SelectItem key={book.id} value={book.id}>{book.title}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {selectedBook && (
                                            <div className="grid gap-4 lg:grid-cols-3">
                                                <div>
                                                    <div className="mb-2 text-sm font-semibold">단원</div>
                                                    <div className="max-h-72 space-y-2 overflow-auto rounded-xl border bg-card p-2">
                                                        {selectedBook.units.map((unit) => (
                                                            <label key={unit.id} className="flex items-start gap-2 rounded-xl p-2 text-sm hover:bg-muted">
                                                                <Checkbox checked={selectedUnitIds.has(unit.id)} onCheckedChange={() => toggleSetValue(setSelectedUnitIds, unit.id)} />
                                                                <span>{unit.name} <span className="text-xs text-muted-foreground">({unit.problemCount})</span></span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="mb-2 text-sm font-semibold">세부유형</div>
                                                    <div className="max-h-72 space-y-2 overflow-auto rounded-xl border bg-card p-2">
                                                        {selectedBook.problemTypes.map((type) => (
                                                            <label key={type.id} className="flex items-start gap-2 rounded-xl p-2 text-sm hover:bg-muted">
                                                                <Checkbox checked={selectedTypeIds.has(type.id)} onCheckedChange={() => toggleSetValue(setSelectedTypeIds, type.id)} />
                                                                <span>{type.name} <span className="text-xs text-muted-foreground">({type.problemCount})</span></span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="mb-2 text-sm font-semibold">개별 문항</div>
                                                    <div className="max-h-72 space-y-2 overflow-auto rounded-xl border bg-card p-2">
                                                        {selectedBook.problems.map((problem) => (
                                                            <label key={problem.id} className="flex items-start gap-2 rounded-xl p-2 text-sm hover:bg-muted">
                                                                <Checkbox checked={selectedProblemIdsSet.has(problem.id)} onCheckedChange={() => toggleSetValue(setSelectedProblemIdsSet, problem.id)} />
                                                                <span>{problemLabel(problem)}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="text-sm font-medium text-muted-foreground">
                                            선택 문제 수: {previewProblemIds.length}문제
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border bg-muted/50 p-4">
                                        <Label>crop-trainer export zip/json</Label>
                                        <Input
                                            type="file"
                                            accept=".zip,.json,application/zip,application/json"
                                            onChange={(event) => setWorksheetFile(event.target.files?.[0] || null)}
                                        />
                                        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                                            <Upload className="h-3.5 w-3.5" />
                                            LMS에서 crop하지 않고, 검수 완료된 export 산출물만 등록합니다.
                                        </p>
                                    </div>
                                )}

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <div className="mb-2 text-sm font-semibold">대상 반</div>
                                        <div className="max-h-52 space-y-2 overflow-auto rounded-xl border bg-card p-2">
                                            {data.classes.filter((row) => row.active).map((row) => (
                                                <label key={row.id} className="flex items-center gap-2 rounded-xl p-2 text-sm hover:bg-muted">
                                                    <Checkbox checked={selectedClassIds.has(row.id)} onCheckedChange={() => toggleSetValue(setSelectedClassIds, row.id)} />
                                                    <span>{row.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="mb-2 text-sm font-semibold">개별 학생</div>
                                        <div className="max-h-52 space-y-2 overflow-auto rounded-xl border bg-card p-2">
                                            {data.students.filter((row) => row.status === 'active').map((row) => (
                                                <label key={row.id} className="flex items-center gap-2 rounded-xl p-2 text-sm hover:bg-muted">
                                                    <Checkbox checked={selectedStudentIds.has(row.id)} onCheckedChange={() => toggleSetValue(setSelectedStudentIds, row.id)} />
                                                    <span>{row.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <Button type="submit" className="w-full" disabled={submitting}>
                                    {submitting ? '생성 중' : '과제 생성'}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>최근 과제</CardTitle></CardHeader>
                        <CardContent>
                            {data.assignments.length === 0 ? (
                                <EmptyState title="아직 생성된 과제가 없습니다." />
                            ) : (
                                <div className="space-y-3">
                                    {data.assignments.map((assignment) => (
                                        <div key={assignment.id} className="rounded-xl border bg-card p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="font-semibold text-foreground">{assignment.title}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {assignment.bookTitle || '외부 학습지'} · {assignment.problemCount}문제 · {formatDate(assignment.dueAt)}
                                                    </div>
                                                </div>
                                                <StatusBadge
                                                    tone={assignment.sourceType === 'worksheet' ? 'info' : 'primary'}
                                                    label={assignment.sourceType === 'worksheet' ? '학습지' : '교재'}
                                                />
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {assignment.targetLabels.length === 0 ? (
                                                    <span className="text-xs text-muted-foreground">대상 없음</span>
                                                ) : assignment.targetLabels.map((label) => (
                                                    <StatusBadge key={label} tone="primary" label={label} />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </PageShell>
    );
}
