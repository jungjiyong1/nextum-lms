'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronLeft, ChevronUp, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import { LatestAbortController } from './latest-abort-controller';
import {
    loadStudentAiConversationDetail,
    loadStudentAiConversationSummaries,
    loadStudentAssignmentLearningDetail,
    loadStudentLearningClassContext,
    loadStudentLearningTypeEvidence,
    loadStudentLearningUnitDetail,
} from './service';
import type {
    StudentAiConversationDetail,
    StudentAiConversationSummary,
    StudentAssignmentInsight,
    StudentAssignmentLearningDetail,
    StudentLearningAttentionStatus,
    StudentLearningClassContext,
    StudentLearningOverview,
    StudentLearningTypeEvidence,
    StudentLearningUnitDetail,
} from './types';

interface StudentLearningViewProps {
    academyId: string;
    studentId: string;
    overview: StudentLearningOverview | null;
}

function percent(value: number | null): string {
    return value === null ? '-' : `${Math.round(value)}%`;
}

function shortDate(value: string | null | undefined): string {
    return value ? value.slice(0, 10) : '-';
}

function attentionBadge(status: StudentLearningAttentionStatus) {
    if (status === 'support_needed') return <StatusBadge tone="danger" label="지원 필요" />;
    if (status === 'check_needed') return <StatusBadge tone="warning" label="확인 필요" />;
    if (status === 'steady') return <StatusBadge tone="success" label="학습 중" />;
    return <StatusBadge tone="neutral" label="학습 기록 없음" />;
}

function assignmentBadge(assignment: StudentAssignmentInsight) {
    if (assignment.progressStatus === 'completed') return <StatusBadge tone="success" label="완료" />;
    if (assignment.overdue) return <StatusBadge tone="danger" label="기한 지남" />;
    if (assignment.dueSoon) return <StatusBadge tone="warning" label="기한 임박" />;
    if (assignment.progressStatus === 'in_progress') return <StatusBadge tone="info" label="진행 중" />;
    return <StatusBadge tone="neutral" label="미시작" />;
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export function StudentLearningView({ academyId, studentId, overview }: StudentLearningViewProps) {
    const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
    const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
    const [classContext, setClassContext] = useState<StudentLearningClassContext | null>(null);
    const [classLoading, setClassLoading] = useState(false);
    const [expandedUnitKey, setExpandedUnitKey] = useState<string | null>(null);
    const [unitDetail, setUnitDetail] = useState<StudentLearningUnitDetail | null>(null);
    const [unitLoading, setUnitLoading] = useState(false);
    const [expandedTypeKey, setExpandedTypeKey] = useState<string | null>(null);
    const [typeEvidence, setTypeEvidence] = useState<StudentLearningTypeEvidence | null>(null);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);
    const [assignmentDetail, setAssignmentDetail] = useState<StudentAssignmentLearningDetail | null>(null);
    const [assignmentLoading, setAssignmentLoading] = useState(false);
    const [conversationDetail, setConversationDetail] = useState<StudentAiConversationDetail | null>(null);
    const [conversationLoading, setConversationLoading] = useState(false);
    const [unlinkedAi, setUnlinkedAi] = useState<StudentAiConversationSummary[] | null>(null);
    const [unlinkedLoading, setUnlinkedLoading] = useState(false);
    const classRequests = useMemo(() => new LatestAbortController(), []);
    const unitRequests = useMemo(() => new LatestAbortController(), []);
    const evidenceRequests = useMemo(() => new LatestAbortController(), []);
    const assignmentRequests = useMemo(() => new LatestAbortController(), []);
    const conversationRequests = useMemo(() => new LatestAbortController(), []);
    const unlinkedRequests = useMemo(() => new LatestAbortController(), []);

    useEffect(() => {
        classRequests.abort();
        unitRequests.abort();
        evidenceRequests.abort();
        assignmentRequests.abort();
        conversationRequests.abort();
        unlinkedRequests.abort();
        setExpandedSubjects(new Set());
        setSelectedClassId(null);
        setClassContext(null);
        setExpandedUnitKey(null);
        setUnitDetail(null);
        setExpandedTypeKey(null);
        setTypeEvidence(null);
        setAssignmentDetail(null);
        setConversationDetail(null);
        setUnlinkedAi(null);
        return () => {
            classRequests.abort();
            unitRequests.abort();
            evidenceRequests.abort();
            assignmentRequests.abort();
            conversationRequests.abort();
            unlinkedRequests.abort();
        };
    }, [assignmentRequests, classRequests, conversationRequests, evidenceRequests, studentId, unitRequests, unlinkedRequests]);

    const toggleSubject = (key: string) => {
        setExpandedSubjects((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const openClass = async (classId: string) => {
        if (selectedClassId === classId) {
            classRequests.abort();
            setSelectedClassId(null);
            setClassContext(null);
            return;
        }
        const controller = classRequests.start();
        setSelectedClassId(classId);
        setClassContext(null);
        setExpandedUnitKey(null);
        setUnitDetail(null);
        setExpandedTypeKey(null);
        setTypeEvidence(null);
        setShowCompleted(false);
        setClassLoading(true);
        try {
            const data = await loadStudentLearningClassContext(academyId, studentId, classId, { signal: controller.signal });
            if (!controller.signal.aborted) setClassContext(data);
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : '반 학습 정보를 불러오지 못했습니다.');
        } finally {
            classRequests.clear(controller);
            if (!controller.signal.aborted) setClassLoading(false);
        }
    };

    const openUnit = async (classId: string, unitId: string | null) => {
        const key = `${classId}:${unitId || 'none'}`;
        if (expandedUnitKey === key) {
            unitRequests.abort();
            setExpandedUnitKey(null);
            setUnitDetail(null);
            return;
        }
        const controller = unitRequests.start();
        setExpandedUnitKey(key);
        setUnitDetail(null);
        setExpandedTypeKey(null);
        setTypeEvidence(null);
        setUnitLoading(true);
        try {
            const data = await loadStudentLearningUnitDetail(academyId, studentId, classId, unitId, { signal: controller.signal });
            if (!controller.signal.aborted) setUnitDetail(data);
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : '단원 유형을 불러오지 못했습니다.');
        } finally {
            unitRequests.clear(controller);
            if (!controller.signal.aborted) setUnitLoading(false);
        }
    };

    const openType = async (classId: string, unitId: string | null, typeId: string | null) => {
        const key = `${classId}:${unitId || 'none'}:${typeId || 'none'}`;
        if (expandedTypeKey === key) {
            evidenceRequests.abort();
            setExpandedTypeKey(null);
            setTypeEvidence(null);
            return;
        }
        const controller = evidenceRequests.start();
        setExpandedTypeKey(key);
        setTypeEvidence(null);
        setEvidenceLoading(true);
        try {
            const data = await loadStudentLearningTypeEvidence(academyId, studentId, classId, typeId, unitId, { signal: controller.signal });
            if (!controller.signal.aborted) setTypeEvidence(data);
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : '학습 근거를 불러오지 못했습니다.');
        } finally {
            evidenceRequests.clear(controller);
            if (!controller.signal.aborted) setEvidenceLoading(false);
        }
    };

    const openAssignment = async (assignmentId: string) => {
        const controller = assignmentRequests.start();
        conversationRequests.abort();
        setAssignmentDetail(null);
        setConversationDetail(null);
        setAssignmentLoading(true);
        try {
            const data = await loadStudentAssignmentLearningDetail(academyId, studentId, assignmentId, { signal: controller.signal });
            if (!controller.signal.aborted) setAssignmentDetail(data);
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : '과제 상세를 불러오지 못했습니다.');
        } finally {
            assignmentRequests.clear(controller);
            if (!controller.signal.aborted) setAssignmentLoading(false);
        }
    };

    const openConversation = async (conversationId: string) => {
        const controller = conversationRequests.start();
        setConversationDetail(null);
        setConversationLoading(true);
        try {
            const data = await loadStudentAiConversationDetail(academyId, studentId, conversationId, { signal: controller.signal });
            if (!controller.signal.aborted) setConversationDetail(data);
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : 'AI 대화를 불러오지 못했습니다.');
        } finally {
            conversationRequests.clear(controller);
            if (!controller.signal.aborted) setConversationLoading(false);
        }
    };

    const toggleUnlinkedAi = async () => {
        if (unlinkedAi !== null) {
            setUnlinkedAi(null);
            return;
        }
        const controller = unlinkedRequests.start();
        setUnlinkedLoading(true);
        try {
            const rows = await loadStudentAiConversationSummaries(academyId, studentId, null, { signal: controller.signal });
            if (!controller.signal.aborted) setUnlinkedAi(rows.filter((row) => row.linkStatus === 'needs_review'));
        } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted) toast.error(error instanceof Error ? error.message : '연결 확인이 필요한 AI 대화를 불러오지 못했습니다.');
        } finally {
            unlinkedRequests.clear(controller);
            if (!controller.signal.aborted) setUnlinkedLoading(false);
        }
    };

    if (!overview || (overview.subjects.length === 0 && overview.personalAssignments.length === 0 && overview.unclassifiedAttemptCount === 0)) {
        return <EmptyState title="표시할 과목별 학습 기록이 없습니다." description="학생이 수강 중인 반에 과목을 설정하면 여기에 모아 보여줍니다." className="py-12" />;
    }

    const pendingAssignments = classContext?.assignments.filter((row) => row.progressStatus !== 'completed') || [];
    const completedAssignments = classContext?.assignments.filter((row) => row.progressStatus === 'completed') || [];

    return (
        <div className="space-y-3">
            {overview.subjects.map((subject) => {
                const subjectKey = subject.subjectId || `unclassified:${subject.subjectName}`;
                const expanded = expandedSubjects.has(subjectKey);
                return (
                    <section key={subjectKey} className="overflow-hidden rounded-xl border bg-card">
                        <button type="button" className="flex w-full items-center justify-between gap-4 p-4 text-left" onClick={() => toggleSubject(subjectKey)}>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="truncate text-base font-semibold text-foreground">{subject.subjectName}</h3>
                                    {attentionBadge(subject.status)}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                    <span>최근 최초 시도 {percent(subject.correctRate)} · {subject.sampleCount}문항</span>
                                    {subject.correctedProblemCount > 0 && <span>교정 완료 {subject.correctedProblemCount}</span>}
                                    <span>미완료 과제 {subject.pendingAssignmentCount}</span>
                                    {subject.dueSoonAssignmentCount > 0 && <span className="text-warning-foreground">기한 확인 {subject.dueSoonAssignmentCount}</span>}
                                </div>
                            </div>
                            {expanded ? <ChevronUp className="h-5 w-5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />}
                        </button>
                        {expanded && (
                            <div className="space-y-3 border-t bg-muted/20 p-3">
                                {subject.classes.map((classRow) => {
                                    const selected = selectedClassId === classRow.classId;
                                    return (
                                        <div key={classRow.classId} className="overflow-hidden rounded-lg border bg-background">
                                            <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => void openClass(classRow.classId)}>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: classRow.color || '#64748b' }} />
                                                        <p className="truncate font-medium text-foreground">{classRow.className}</p>
                                                        {classRow.pathState === 'needs_setup' && <StatusBadge tone="neutral" label="학습 범위 설정 필요" />}
                                                    </div>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {classRow.primaryPathName || classRow.courseTitle || '학습 경로 미설정'} · 최초 시도 {percent(classRow.correctRate)} ({classRow.sampleCount}) · 미완료 {classRow.pendingAssignmentCount}
                                                    </p>
                                                </div>
                                                {selected ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                            </button>
                                            {selected && (
                                                <div className="border-t p-3">
                                                    {classLoading ? (
                                                        <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
                                                    ) : classContext ? (
                                                        <div className="space-y-4">
                                                            {classContext.pathState === 'needs_setup' ? (
                                                                <div className="rounded-lg border border-dashed p-4 text-sm">
                                                                    <p className="font-medium text-foreground">학습 범위 설정이 필요합니다.</p>
                                                                    <p className="mt-1 text-xs text-muted-foreground">과제와 풀이 기록은 확인할 수 있지만, 기존 전체 풀이를 임의로 단원 이해도로 계산하지 않습니다.</p>
                                                                </div>
                                                            ) : (
                                                                <div>
                                                                    <p className="mb-2 text-xs font-medium text-muted-foreground">학습 경로</p>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {classContext.paths.map((path) => <StatusBadge key={path.id} tone={path.role === 'primary' ? 'info' : 'neutral'} label={`${path.role === 'primary' ? '대표' : '보조'} · ${path.name}`} />)}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {classContext.pathState === 'configured' && (
                                                                <div>
                                                                    <div className="mb-2 flex items-center gap-2"><BookOpen className="h-4 w-4 text-muted-foreground" /><p className="text-sm font-medium">단원별 이해도</p></div>
                                                                    <div className="divide-y rounded-lg border">
                                                                        {classContext.units.map((unit) => {
                                                                            const unitKey = `${classRow.classId}:${unit.unitId || 'none'}`;
                                                                            const unitExpanded = expandedUnitKey === unitKey;
                                                                            return (
                                                                                <div key={unitKey}>
                                                                                    <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => void openUnit(classRow.classId, unit.unitId)}>
                                                                                        <div className="min-w-0"><p className="truncate text-sm font-medium">{unit.unitName}</p><p className="mt-1 text-xs text-muted-foreground">{unit.bookTitle || '교재 미지정'} · {percent(unit.correctRate)} · {unit.sampleCount}문항{unit.correctedProblemCount > 0 ? ` · 교정 ${unit.correctedProblemCount}` : ''}</p></div>
                                                                                        {unitExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                                                                                    </button>
                                                                                    {unitExpanded && (
                                                                                        <div className="border-t bg-muted/20 p-3">
                                                                                            {unitLoading ? <Skeleton className="h-16 w-full" /> : unitDetail?.types.length ? unitDetail.types.map((type) => {
                                                                                                const typeKey = `${unitKey}:${type.typeId || 'none'}`;
                                                                                                const typeExpanded = expandedTypeKey === typeKey;
                                                                                                return (
                                                                                                    <div key={typeKey} className="mb-2 overflow-hidden rounded-md border bg-background last:mb-0">
                                                                                                        <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => void openType(classRow.classId, unit.unitId, type.typeId)}>
                                                                                                            <div><p className="text-sm font-medium">{type.typeName}</p><p className="mt-1 text-xs text-muted-foreground">{percent(type.correctRate)} · 표본 {type.sampleCount}{type.correctedProblemCount > 0 ? ` · 교정 ${type.correctedProblemCount}` : ''}</p></div>
                                                                                                            {typeExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                                                                        </button>
                                                                                                        {typeExpanded && <div className="border-t p-3">{evidenceLoading ? <Skeleton className="h-14 w-full" /> : typeEvidence?.evidence.length ? <div className="space-y-2">{typeEvidence.evidence.map((row) => <div key={row.id} className="rounded-md bg-muted p-2 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-medium text-foreground">{row.problemLabel}</span><StatusBadge tone={row.firstCorrect ? 'success' : row.corrected ? 'info' : 'danger'} label={row.firstCorrect ? '첫 시도 정답' : row.corrected ? '교정 완료' : '오답'} /></div><p className="mt-1 text-muted-foreground">{row.className || '개인 학습'} · {row.assignmentTitle || '과제 미연결'} · {row.bookTitle || '교재 미지정'} · {shortDate(row.lastAttemptedAt)}</p></div>)}</div> : <p className="text-xs text-muted-foreground">표시할 근거가 없습니다.</p>}</div>}
                                                                                                    </div>
                                                                                                );
                                                                                            }) : <p className="text-xs text-muted-foreground">아직 확인할 유형이 없습니다.</p>}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {classContext.units.length === 0 && <p className="p-4 text-xs text-muted-foreground">경로에 연결된 단원이나 풀이 기록이 없습니다.</p>}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            <div>
                                                                <p className="mb-2 text-sm font-medium">과제</p>
                                                                <div className="divide-y rounded-lg border">
                                                                    {[...pendingAssignments, ...(showCompleted ? completedAssignments : completedAssignments.slice(0, 2))].map((assignment) => (
                                                                        <button key={assignment.id} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => void openAssignment(assignment.id)}>
                                                                            <div className="min-w-0"><p className="truncate text-sm font-medium">{assignment.title}</p><p className="mt-1 text-xs text-muted-foreground">{assignment.attemptedProblemCount}/{assignment.requiredProblemCount || assignment.attemptedProblemCount}문항 · 최초 정답률 {percent(assignment.correctRate)} · {shortDate(assignment.dueAt)}</p></div>
                                                                            {assignmentBadge(assignment)}
                                                                        </button>
                                                                    ))}
                                                                    {classContext.assignments.length === 0 && <p className="p-4 text-xs text-muted-foreground">연결된 과제가 없습니다.</p>}
                                                                </div>
                                                                {completedAssignments.length > 2 && <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setShowCompleted((value) => !value)}>{showCompleted ? '완료 과제 접기' : `완료 과제 ${completedAssignments.length}개 보기`}</Button>}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                );
            })}

            {overview.personalAssignments.length > 0 && (
                <section className="rounded-xl border bg-card p-4">
                    <h3 className="font-semibold text-foreground">개인 과제</h3>
                    <div className="mt-3 divide-y rounded-lg border">
                        {overview.personalAssignments.map((assignment) => <button key={assignment.id} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => void openAssignment(assignment.id)}><span className="truncate text-sm font-medium">{assignment.title}</span>{assignmentBadge(assignment)}</button>)}
                    </div>
                </section>
            )}
            {overview.unclassifiedAttemptCount > 0 && <p className="px-1 text-xs text-muted-foreground">반·과제를 안전하게 확인할 수 없는 풀이 {overview.unclassifiedAttemptCount}건은 이해도 계산에서 제외했습니다.</p>}

            <section className="rounded-xl border bg-card p-4">
                <Button type="button" variant="ghost" size="sm" className="w-full justify-between px-0" disabled={unlinkedLoading} onClick={() => void toggleUnlinkedAi()}>
                    <span>AI 연결 확인 필요</span>
                    {unlinkedAi === null ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
                {unlinkedAi !== null && <div className="mt-2 divide-y rounded-lg border">{unlinkedAi.length ? unlinkedAi.map((conversation) => <button key={conversation.id} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => void openConversation(conversation.id)}><div className="min-w-0"><p className="truncate text-sm font-medium">{conversation.title || '제목 없는 AI 대화'}</p><p className="mt-1 text-xs text-muted-foreground">연결 확인 필요 · {conversation.messageCount}개 메시지 · {shortDate(conversation.updatedAt)}</p></div><MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" /></button>) : <p className="p-4 text-xs text-muted-foreground">연결을 확인할 대화가 없습니다.</p>}</div>}
            </section>

            <Dialog open={assignmentLoading || conversationLoading || Boolean(assignmentDetail) || Boolean(conversationDetail)} onOpenChange={(open) => { if (!open) { assignmentRequests.abort(); conversationRequests.abort(); setAssignmentDetail(null); setConversationDetail(null); } }}>
                <DialogContent className="inset-0 h-[100dvh] max-h-none max-w-none translate-x-0 translate-y-0 rounded-none sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:w-[640px] sm:translate-x-0 sm:translate-y-0">
                    {conversationLoading && !conversationDetail ? (
                        <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>
                    ) : conversationDetail ? (
                        <>
                            <DialogHeader>
                                {assignmentDetail && <Button type="button" variant="ghost" size="sm" className="mb-2 w-fit px-0" onClick={() => setConversationDetail(null)}><ChevronLeft className="mr-1 h-4 w-4" />과제로 돌아가기</Button>}
                                <DialogTitle>{conversationDetail.problemLabel || conversationDetail.title || 'AI 대화'}</DialogTitle>
                                <DialogDescription>{conversationDetail.assignmentTitle || '연결 확인 필요'} · {shortDate(conversationDetail.updatedAt)}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                {conversationDetail.messages.map((message) => <div key={message.id} className={cn('rounded-lg p-3 text-sm', message.role === 'assistant' ? 'bg-muted' : 'bg-primary-soft')}><div className="mb-1 text-xs text-muted-foreground">{message.role === 'assistant' ? 'AI' : '학생'} · {shortDate(message.createdAt)}</div><p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p></div>)}
                            </div>
                        </>
                    ) : (
                        <>
                            <DialogHeader><DialogTitle>{assignmentDetail?.assignment.title || '과제 상세'}</DialogTitle><DialogDescription>AI를 사용한 문제를 선택하면 해당 대화를 불러옵니다.</DialogDescription></DialogHeader>
                            {assignmentLoading ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : assignmentDetail ? <div className="space-y-4">
                                <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center text-xs"><div><p className="text-muted-foreground">진행</p><p className="mt-1 font-semibold">{assignmentDetail.assignment.attemptedProblemCount}/{assignmentDetail.assignment.requiredProblemCount || assignmentDetail.assignment.attemptedProblemCount}</p></div><div><p className="text-muted-foreground">최초 정답률</p><p className="mt-1 font-semibold">{percent(assignmentDetail.assignment.correctRate)}</p></div><div><p className="text-muted-foreground">교정 완료</p><p className="mt-1 font-semibold">{assignmentDetail.assignment.correctedProblemCount}</p></div></div>
                                <div><div className="mb-2 flex items-center gap-2"><MessageSquare className="h-4 w-4 text-muted-foreground" /><p className="text-sm font-medium">AI 사용 문제</p></div>{assignmentDetail.aiProblems.length ? <div className="space-y-2">{assignmentDetail.aiProblems.map((problem) => <div key={problem.problemId || problem.conversations[0]?.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{problem.problemLabel}</p><p className="mt-1 text-xs text-muted-foreground">{problem.unitName || '단원 미지정'} · 대화 {problem.conversationCount}건</p><div className="mt-2 space-y-1">{problem.conversations.map((conversation) => <Button key={conversation.id} type="button" variant="outline" size="sm" className="w-full justify-between" disabled={conversationLoading} onClick={() => void openConversation(conversation.id)}><span className="truncate">{conversation.title || `${problem.problemLabel} 대화`}</span><span className="ml-2 text-xs text-muted-foreground">{conversation.messageCount}개</span></Button>)}</div></div>)}</div> : <EmptyState title="이 과제에서 확인할 AI 대화가 없습니다." className="py-8" />}</div>
                            </div> : null}
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
