'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
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

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function SelectBox(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className={cn('h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring', props.className)}
        />
    );
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

    const load = useCallback(async () => {
        if (!academyId) return;
        setLoading(true);
        try {
            const next = await loadAssignmentManagementData(academyId);
            setData(next);
            setBookId((current) => current || next.books[0]?.id || '');
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '과제 데이터를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, [academyId]);

    useEffect(() => {
        void load();
    }, [load]);

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
            await load();
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
                    <CardContent className="text-sm text-slate-500">현재 계정에 연결된 academy가 없습니다.</CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 lg:p-8">
            <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                        <ClipboardList className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold text-slate-950">과제 관리</h1>
                        <p className="text-sm text-slate-500">교재 범위 또는 crop-trainer 학습지를 학생 과제로 배정합니다.</p>
                    </div>
                </div>
                <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    새로고침
                </Button>
            </div>

            {loading && <SkeletonPanel className="min-h-[360px]" rows={7} />}
            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <AlertTriangle className="h-4 w-4" />
                    {error}
                </div>
            )}

            {data && (
                <div className="grid min-h-0 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                    <Card>
                        <CardHeader><CardTitle>새 과제</CardTitle></CardHeader>
                        <CardContent>
                            <form onSubmit={submit} className="space-y-5">
                                <div className="grid gap-3 md:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={() => setSourceType('content_scope')}
                                        className={cn(
                                            'rounded-lg border p-3 text-left text-sm',
                                            sourceType === 'content_scope' ? 'border-emerald-500 bg-emerald-50' : 'bg-white',
                                        )}
                                    >
                                        <div className="font-semibold">교재 범위</div>
                                        <div className="mt-1 text-xs text-slate-500">단원, 세부유형, 문항을 선택합니다.</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSourceType('worksheet')}
                                        className={cn(
                                            'rounded-lg border p-3 text-left text-sm',
                                            sourceType === 'worksheet' ? 'border-emerald-500 bg-emerald-50' : 'bg-white',
                                        )}
                                    >
                                        <div className="font-semibold">학습지 export</div>
                                        <div className="mt-1 text-xs text-slate-500">crop-trainer zip/json을 과제로 등록합니다.</div>
                                    </button>
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
                                    <div className="space-y-4 rounded-lg border bg-slate-50/70 p-4">
                                        <div>
                                            <Label>교재</Label>
                                            <SelectBox
                                                value={bookId}
                                                onChange={(event) => {
                                                    setBookId(event.target.value);
                                                    resetScope();
                                                }}
                                            >
                                                {data.books.map((book) => (
                                                    <option key={book.id} value={book.id}>{book.title}</option>
                                                ))}
                                            </SelectBox>
                                        </div>

                                        {selectedBook && (
                                            <div className="grid gap-4 lg:grid-cols-3">
                                                <div>
                                                    <div className="mb-2 text-sm font-semibold">단원</div>
                                                    <div className="max-h-72 space-y-2 overflow-auto rounded-lg border bg-white p-2">
                                                        {selectedBook.units.map((unit) => (
                                                            <label key={unit.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                                                                <input type="checkbox" checked={selectedUnitIds.has(unit.id)} onChange={() => toggleSetValue(setSelectedUnitIds, unit.id)} />
                                                                <span>{unit.name} <span className="text-xs text-slate-400">({unit.problemCount})</span></span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="mb-2 text-sm font-semibold">세부유형</div>
                                                    <div className="max-h-72 space-y-2 overflow-auto rounded-lg border bg-white p-2">
                                                        {selectedBook.problemTypes.map((type) => (
                                                            <label key={type.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                                                                <input type="checkbox" checked={selectedTypeIds.has(type.id)} onChange={() => toggleSetValue(setSelectedTypeIds, type.id)} />
                                                                <span>{type.name} <span className="text-xs text-slate-400">({type.problemCount})</span></span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="mb-2 text-sm font-semibold">개별 문항</div>
                                                    <div className="max-h-72 space-y-2 overflow-auto rounded-lg border bg-white p-2">
                                                        {selectedBook.problems.map((problem) => (
                                                            <label key={problem.id} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                                                                <input type="checkbox" checked={selectedProblemIdsSet.has(problem.id)} onChange={() => toggleSetValue(setSelectedProblemIdsSet, problem.id)} />
                                                                <span>{problemLabel(problem)}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="text-sm font-medium text-slate-600">
                                            선택 문제 수: {previewProblemIds.length}문제
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-lg border bg-slate-50/70 p-4">
                                        <Label>crop-trainer export zip/json</Label>
                                        <Input
                                            type="file"
                                            accept=".zip,.json,application/zip,application/json"
                                            onChange={(event) => setWorksheetFile(event.target.files?.[0] || null)}
                                        />
                                        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                                            <Upload className="h-3.5 w-3.5" />
                                            LMS에서 crop하지 않고, 검수 완료된 export 산출물만 등록합니다.
                                        </p>
                                    </div>
                                )}

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <div className="mb-2 text-sm font-semibold">대상 반</div>
                                        <div className="max-h-52 space-y-2 overflow-auto rounded-lg border bg-white p-2">
                                            {data.classes.filter((row) => row.active).map((row) => (
                                                <label key={row.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                                                    <input type="checkbox" checked={selectedClassIds.has(row.id)} onChange={() => toggleSetValue(setSelectedClassIds, row.id)} />
                                                    <span>{row.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="mb-2 text-sm font-semibold">개별 학생</div>
                                        <div className="max-h-52 space-y-2 overflow-auto rounded-lg border bg-white p-2">
                                            {data.students.filter((row) => row.status === 'active').map((row) => (
                                                <label key={row.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-slate-50">
                                                    <input type="checkbox" checked={selectedStudentIds.has(row.id)} onChange={() => toggleSetValue(setSelectedStudentIds, row.id)} />
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
                                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">아직 생성된 과제가 없습니다.</div>
                            ) : (
                                <div className="space-y-3">
                                    {data.assignments.map((assignment) => (
                                        <div key={assignment.id} className="rounded-lg border bg-white p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="font-semibold text-slate-900">{assignment.title}</div>
                                                    <div className="mt-1 text-xs text-slate-500">
                                                        {assignment.bookTitle || '외부 학습지'} · {assignment.problemCount}문제 · {formatDate(assignment.dueAt)}
                                                    </div>
                                                </div>
                                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                                    {assignment.sourceType === 'worksheet' ? '학습지' : '교재'}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {assignment.targetLabels.length === 0 ? (
                                                    <span className="text-xs text-slate-400">대상 없음</span>
                                                ) : assignment.targetLabels.map((label) => (
                                                    <span key={label} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                                                        {label}
                                                    </span>
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
        </div>
    );
}
