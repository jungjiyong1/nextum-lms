'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileQuestion,
  ListChecks,
  Plus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import { Skeleton, SkeletonPanel } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AnalysisPlanKind,
  ChallengeBand,
  CreateLearningPlanInput,
  ExamPlanSummary,
  LearningActionQueueItem,
  LearningAnalysisCatalog,
  LearningAnalysisTab,
  LearningAnalysisViewProps,
  LearningEvidenceCountSummary,
  LearningEvidenceEvent,
  LearningEvidenceOutcome,
  LearningEvidenceStatus,
  LearningPathRole,
  LearningPathPurpose,
  LearningPathStatus,
  LearningPathSummary,
  StudentExamEvidenceSummary,
} from './learning-analysis-types';

const CHALLENGE_BAND_LABEL: Record<ChallengeBand, string> = {
  1: '하',
  2: '중',
  3: '상',
  4: '최상',
};

const PLAN_KIND_LABEL: Record<AnalysisPlanKind, string> = {
  current: '현행',
  advance: '선행',
  maintenance: '유지 복습',
  exam: '시험',
};

const PLAN_KIND_DESCRIPTION: Record<AnalysisPlanKind, string> = {
  current: '현재 학교 진도에 맞춰 확인합니다.',
  advance: '앞으로 배울 범위를 미리 학습합니다.',
  maintenance: '교재 유무와 관계없이 잊지 않도록 확인합니다.',
  exam: '시험일과 정확한 범위를 기준으로 확인합니다.',
};

const PATH_ROLE_LABEL: Record<LearningPathRole, string> = {
  primary: '대표 경로',
  supplemental: '보조 경로',
};

const PATH_PURPOSE_LABEL: Record<LearningPathPurpose, string> = {
  current: '현행',
  advance: '선행',
  review: '복습',
  exam: '시험 대비',
  other: '기타',
};

const PATH_STATUS_LABEL: Record<LearningPathStatus, string> = {
  draft: '준비 중',
  active: '진행 중',
  completed: '완료',
  archived: '보관',
};

const STATUS_LABEL: Record<LearningEvidenceStatus, string> = {
  recently_confirmed: '최근 확인',
  needs_check: '확인 필요',
  support_candidate: '지원 후보',
  content_gap: '자료 부족',
};

const STATUS_TONE: Record<LearningEvidenceStatus, StatusTone> = {
  recently_confirmed: 'success',
  needs_check: 'warning',
  support_candidate: 'danger',
  content_gap: 'neutral',
};

const OUTCOME_LABEL: Record<LearningEvidenceOutcome, string> = {
  correct: '정답',
  incorrect: '오답',
  partial: '부분 정답',
  unknown: '모름',
  blank: '미응답',
};

type EvidenceDialogState = {
  title: string;
  description: string;
  events: LearningEvidenceEvent[];
};

function toDate(value: string): Date | null {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '기록 없음';
  const date = toDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatDateTime(value: string): string {
  const date = toDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusBadge(status: LearningEvidenceStatus) {
  return <StatusBadge label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
}

function LearningAnalysisLoading() {
  return (
    <PageShell
      title="학습 경로"
      icon={BarChart3}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-52 max-w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <SkeletonPanel rows={6} />
    </PageShell>
  );
}

function EvidenceDialog({
  state,
  onOpenChange,
}: {
  state: EvidenceDialogState | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{state?.title ?? '근거 보기'}</DialogTitle>
          <DialogDescription>{state?.description ?? '관찰 기록을 확인합니다.'}</DialogDescription>
        </DialogHeader>

        {state && state.events.length > 0 ? (
          <div className="space-y-3" aria-label="학습 근거 목록">
            {state.events.map((event) => (
              <article key={event.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{event.problemLabel}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {event.skillName} · {event.sourceLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <StatusBadge
                      label={OUTCOME_LABEL[event.outcome]}
                      tone={event.outcome === 'correct' ? 'success' : event.outcome === 'blank' ? 'neutral' : 'warning'}
                    />
                    <StatusBadge
                      label={event.included ? '분석 반영' : '분석 제외'}
                      tone={event.included ? 'primary' : 'neutral'}
                    />
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">풀이 시각</dt>
                    <dd className="mt-1 text-foreground">{formatDateTime(event.occurredAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">도전 단계</dt>
                    <dd className="mt-1 text-foreground">
                      {event.challengeBand ? CHALLENGE_BAND_LABEL[event.challengeBand] : '미지정'}
                      {event.evidenceKindLabel ? ` · ${event.evidenceKindLabel}` : ''}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-muted-foreground">
                      {event.included ? '반영 이유' : '제외 이유'}
                    </dt>
                    <dd className="mt-1 text-foreground">{event.reason}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileQuestion}
            title="표시할 근거가 없습니다"
            description="문제 풀이가 기록되면 날짜와 반영 여부를 여기에서 확인할 수 있습니다."
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PathCard({
  path,
  onStart,
  onStatusChange,
}: {
  path: LearningPathSummary;
  onStart?: (pathId: string) => void | Promise<void>;
  onStatusChange?: (pathId: string, action: 'complete' | 'archive') => void | Promise<void>;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const start = async () => {
    if (!onStart || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await onStart(path.id);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '다음 학습 경로를 시작하지 못했습니다.');
    } finally {
      setStarting(false);
    }
  };

  const changeStatus = async (action: 'complete' | 'archive') => {
    if (!onStatusChange || starting) return;
    const message = action === 'complete'
      ? '이 학습 경로를 완료 처리할까요? 학습 기록은 그대로 유지됩니다.'
      : '이 학습 경로를 보관할까요?';
    if (typeof window !== 'undefined' && !window.confirm(message)) return;
    setStarting(true);
    setStartError(null);
    try {
      await onStatusChange(path.id, action);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '학습 경로 상태를 변경하지 못했습니다.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{path.name}</CardTitle>
            <CardDescription className="mt-1">
              {path.className} · 목표 도전 단계 {CHALLENGE_BAND_LABEL[path.targetBand]}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusBadge label={PATH_ROLE_LABEL[path.role]} tone={path.role === 'primary' ? 'primary' : 'neutral'} />
            <StatusBadge label={PATH_STATUS_LABEL[path.status]} tone={path.status === 'active' ? 'success' : path.status === 'draft' ? 'info' : 'neutral'} />
            <StatusBadge label={PATH_PURPOSE_LABEL[path.purpose]} tone="info" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">범위</dt>
            <dd className="mt-1 font-semibold text-foreground">{path.scopeSkillCount.toLocaleString()}개 유형</dd>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">연결 자료</dt>
            <dd className="mt-1 font-semibold text-foreground">
              {path.materialCount === 0 ? '없음' : `${path.materialCount.toLocaleString()}개`}
            </dd>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">확인 예정 학생</dt>
            <dd className="mt-1 font-semibold text-foreground">{path.dueStudentCount.toLocaleString()}명</dd>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">조치 항목</dt>
            <dd className="mt-1 font-semibold text-foreground">{path.actionCount.toLocaleString()}건</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {path.maintenanceIntervalDays
              ? `${path.maintenanceIntervalDays}일마다 ${path.kind === 'maintenance' ? '유지 확인' : '재확인'}`
              : path.kind === 'exam' ? '시험 범위 경로' : '확인 주기 미설정'}
          </span>
          <span>최근 근거 {formatDate(path.lastEvidenceAt)}</span>
        </div>
        <details className="mt-4 rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            단원별 상태 {path.units.length}개
          </summary>
          <div className="mt-3 space-y-2">
            {path.units.map((unit) => (
              <div key={unit.name} className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-foreground">{unit.name}</span>
                <span className="text-muted-foreground">
                  유형 {unit.skillCount} · 확인 {unit.needsCheckCount} · 지원 {unit.supportCandidateCount} · 자료 부족 {unit.contentGapCount}
                </span>
              </div>
            ))}
            {path.units.length === 0 && <p className="text-xs text-muted-foreground">학습 범위 설정이 필요합니다.</p>}
          </div>
        </details>
        <div className="mt-4 flex flex-wrap gap-2">
          {path.status === 'draft' && path.role === 'primary' && onStart && (
            <Button type="button" className="flex-1" disabled={starting} onClick={() => void start()}>
              {starting ? '처리하는 중' : '다음 경로 시작'}
            </Button>
          )}
          {path.status === 'active' && onStatusChange && (
            <Button type="button" variant="outline" className="flex-1" disabled={starting} onClick={() => void changeStatus('complete')}>
              {starting ? '처리하는 중' : '완료 처리'}
            </Button>
          )}
          {(path.status === 'completed' || path.status === 'draft') && onStatusChange && (
            <Button type="button" variant="ghost" className="flex-1" disabled={starting} onClick={() => void changeStatus('archive')}>
              {starting ? '처리하는 중' : '보관'}
            </Button>
          )}
        </div>
        {startError && <p className="mt-3 text-sm text-destructive" role="alert">{startError}</p>}
      </CardContent>
    </Card>
  );
}

function ActionQueue({
  items,
  onCreateAssignmentDraft,
}: {
  items: LearningActionQueueItem[];
  onCreateAssignmentDraft?: (actionIds: string[]) => void | Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [evidenceDialog, setEvidenceDialog] = useState<EvidenceDialogState | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    const availableIds = new Set(items.map((item) => item.id));
    setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [items]);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const toggleItem = (id: string) => {
    setDraftError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setDraftError(null);
    setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  };

  const createDraft = async () => {
    if (!onCreateAssignmentDraft || selectedIds.size === 0) return;
    setCreatingDraft(true);
    setDraftError(null);
    try {
      await onCreateAssignmentDraft([...selectedIds]);
      setSelectedIds(new Set());
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : '과제 초안을 만들지 못했습니다.');
    } finally {
      setCreatingDraft(false);
    }
  };

  const openEvidence = (item: LearningActionQueueItem) => {
    setEvidenceDialog({
      title: `${item.studentName} · ${item.skillName}`,
      description: `${item.reason} 문제별 반영 여부를 확인하세요.`,
      events: item.evidence,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>통합 조치 큐</CardTitle>
            <CardDescription className="mt-1">
              여러 학습 경로에 겹치는 학생과 유형은 한 항목으로 모았습니다.
            </CardDescription>
          </div>
          {onCreateAssignmentDraft && (
            <Button
              type="button"
              size="sm"
              disabled={selectedIds.size === 0 || creatingDraft}
              onClick={() => void createDraft()}
            >
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              {creatingDraft ? '초안 만드는 중' : `과제 초안 만들기 (${selectedIds.size})`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {draftError && (
          <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {draftError}
          </p>
        )}
        {items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="지금 확인할 조치가 없습니다"
            description="새로운 독립 풀이가 들어오거나 유지 확인일이 되면 항목이 나타납니다."
          />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable>
                <Table>
                  <caption className="sr-only">학생별 확인 및 지원 후보 목록</caption>
                  <TableHeader>
                    <TableRow>
                      {onCreateAssignmentDraft && (
                        <TableHead className="w-12">
                          <Checkbox
                            checked={allSelected ? true : selectedIds.size > 0 ? 'indeterminate' : false}
                            onCheckedChange={toggleAll}
                            aria-label="조치 항목 전체 선택"
                          />
                        </TableHead>
                      )}
                      <TableHead>학생</TableHead>
                      <TableHead>유형</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>관련 계획</TableHead>
                      <TableHead>확인일</TableHead>
                      <TableHead className="text-right">근거</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        {onCreateAssignmentDraft && (
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={() => toggleItem(item.id)}
                              aria-label={`${item.studentName} ${item.skillName} 선택`}
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          <p className="font-medium">{item.studentName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.className}</p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{item.skillName}</p>
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">{item.reason}</p>
                        </TableCell>
                        <TableCell>{statusBadge(item.status)}</TableCell>
                        <TableCell className="max-w-xs text-muted-foreground">
                          {item.relatedPlanNames.join(', ') || '계획 없음'}
                        </TableCell>
                        <TableCell>{item.dueAt ? formatDate(item.dueAt) : '가능한 때'}</TableCell>
                        <TableCell className="text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEvidence(item)}>
                            근거 보기
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTable>
            </div>

            <div className="space-y-3 md:hidden">
              {items.map((item) => (
                <article key={item.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    {onCreateAssignmentDraft && (
                      <Checkbox
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={() => toggleItem(item.id)}
                        aria-label={`${item.studentName} ${item.skillName} 선택`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-foreground">{item.studentName}</p>
                        {statusBadge(item.status)}
                      </div>
                      <p className="mt-2 text-sm font-medium text-foreground">{item.skillName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {item.relatedPlanNames.join(', ') || '계획 없음'} · {item.dueAt ? formatDate(item.dueAt) : '가능한 때'}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => openEvidence(item)}
                      >
                        근거 보기
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </CardContent>

      <EvidenceDialog state={evidenceDialog} onOpenChange={(open) => !open && setEvidenceDialog(null)} />
    </Card>
  );
}

function ClassLearningSection({
  paths,
  actionQueue,
  onCreateAssignmentDraft,
  onStartPath,
  onChangePathStatus,
}: {
  paths: LearningPathSummary[];
  actionQueue: LearningActionQueueItem[];
  onCreateAssignmentDraft?: (actionIds: string[]) => void | Promise<void>;
  onStartPath?: (pathId: string) => void | Promise<void>;
  onChangePathStatus?: (pathId: string, action: 'complete' | 'archive') => void | Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="learning-track-heading">
        <div className="mb-3">
          <h2 id="learning-track-heading" className="text-lg font-semibold text-foreground">학습 경로</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            대표 경로 하나와 여러 보조 경로를 운영합니다. 준비한 대표 경로는 기존 경로를 완료하면서 시작됩니다.
          </p>
        </div>
        {paths.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {paths.map((path) => (
              <PathCard key={path.id} path={path} onStart={onStartPath} onStatusChange={onChangePathStatus} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="아직 학습 경로가 없습니다"
            description="현행, 선행 또는 유지 복습 계획을 추가하면 여기에서 함께 관리할 수 있습니다."
          />
        )}
      </section>

      <section aria-label="통합 조치 큐">
        <ActionQueue items={actionQueue} onCreateAssignmentDraft={onCreateAssignmentDraft} />
      </section>
    </div>
  );
}

function EvidenceSummaryCards({ summary }: { summary: LearningEvidenceCountSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="시험 범위 근거 개수">
      <StatCard label="전체 범위" value={summary.scope.toLocaleString()} hint="공통 유형" icon={ListChecks} />
      <StatCard label="분석 가능" value={summary.analyzable.toLocaleString()} hint="근거 판정 가능" icon={BarChart3} tone="info" />
      <StatCard label="최근 확인" value={summary.recentlyConfirmed.toLocaleString()} hint="독립 풀이 확인" icon={CheckCircle2} tone="success" />
      <StatCard label="확인 필요" value={summary.needsCheck.toLocaleString()} hint="새 문항 확인 필요" icon={Clock3} tone="warning" />
      <StatCard label="지원 후보" value={summary.supportCandidate.toLocaleString()} hint="강사 검토 필요" icon={AlertCircle} tone="danger" />
      <StatCard label="자료 부족" value={summary.contentGap.toLocaleString()} hint="학생 상태와 분리" icon={FileQuestion} />
    </div>
  );
}

function StudentEvidenceTable({ students }: { students: StudentExamEvidenceSummary[] }) {
  const [evidenceDialog, setEvidenceDialog] = useState<EvidenceDialogState | null>(null);

  const openEvidence = (student: StudentExamEvidenceSummary) => {
    setEvidenceDialog({
      title: `${student.studentName} · 시험 근거`,
      description: '문제별 결과와 분석 반영·제외 이유를 확인하세요.',
      events: student.evidence,
    });
  };

  if (students.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="표시할 학생 근거가 없습니다"
        description="시험 범위에 해당하는 독립 풀이가 기록되면 학생별 개수가 나타납니다."
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <DataTable>
          <Table>
            <caption className="sr-only">시험 계획의 학생별 학습 근거 개수</caption>
            <TableHeader>
              <TableRow>
                <TableHead>학생</TableHead>
                <TableHead>대표 상태</TableHead>
                <TableHead className="text-right">분석 가능</TableHead>
                <TableHead className="text-right">최근 확인</TableHead>
                <TableHead className="text-right">확인 필요</TableHead>
                <TableHead className="text-right">지원 후보</TableHead>
                <TableHead className="text-right">자료 부족</TableHead>
                <TableHead>최근 근거</TableHead>
                <TableHead className="text-right">상세</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.studentId}>
                  <TableCell className="font-medium">{student.studentName}</TableCell>
                  <TableCell>{statusBadge(student.status)}</TableCell>
                  <TableCell className="text-right">{student.summary.analyzable.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{student.summary.recentlyConfirmed.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{student.summary.needsCheck.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{student.summary.supportCandidate.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{student.summary.contentGap.toLocaleString()}</TableCell>
                  <TableCell>{formatDate(student.lastEvidenceAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEvidence(student)}>
                      근거 보기
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      </div>

      <div className="space-y-3 md:hidden">
        {students.map((student) => (
          <article key={student.studentId} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-foreground">{student.studentName}</p>
              {statusBadge(student.status)}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">분석 가능</dt><dd className="mt-1 font-semibold">{student.summary.analyzable}</dd></div>
              <div><dt className="text-xs text-muted-foreground">최근 확인</dt><dd className="mt-1 font-semibold">{student.summary.recentlyConfirmed}</dd></div>
              <div><dt className="text-xs text-muted-foreground">확인 필요</dt><dd className="mt-1 font-semibold">{student.summary.needsCheck}</dd></div>
              <div><dt className="text-xs text-muted-foreground">지원 후보</dt><dd className="mt-1 font-semibold">{student.summary.supportCandidate}</dd></div>
              <div><dt className="text-xs text-muted-foreground">자료 부족</dt><dd className="mt-1 font-semibold">{student.summary.contentGap}</dd></div>
              <div><dt className="text-xs text-muted-foreground">최근 근거</dt><dd className="mt-1 font-semibold">{formatDate(student.lastEvidenceAt)}</dd></div>
            </dl>
            <Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={() => openEvidence(student)}>
              근거 보기
            </Button>
          </article>
        ))}
      </div>

      <EvidenceDialog state={evidenceDialog} onOpenChange={(open) => !open && setEvidenceDialog(null)} />
    </>
  );
}

function ExamPreparationSection({
  plans,
  selectedPlanId,
  students,
  loading,
  onSelectedPlanChange,
  onRequestCreatePlan,
}: {
  plans: ExamPlanSummary[];
  selectedPlanId: string | null;
  students: StudentExamEvidenceSummary[];
  loading: boolean;
  onSelectedPlanChange: (planId: string) => void;
  onRequestCreatePlan: () => void;
}) {
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  if (plans.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="아직 시험 계획이 없습니다"
        description="시험일과 정확한 유형 범위를 지정하면 학생별 근거 개수를 확인할 수 있습니다."
        action={<Button type="button" onClick={onRequestCreatePlan}><Plus className="h-4 w-4" aria-hidden="true" />시험 계획 만들기</Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>시험 계획 선택</CardTitle>
          <CardDescription>학생 상태와 자료 부족을 분리해서 보여줍니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-end">
            <div>
              <Label htmlFor="exam-plan-select">시험 계획</Label>
              <Select value={selectedPlanId ?? undefined} onValueChange={onSelectedPlanChange}>
                <SelectTrigger id="exam-plan-select" className="mt-2">
                  <SelectValue placeholder="시험 계획을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} · {formatDate(plan.examDate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPlan && (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{selectedPlan.className}</span>
                {' · '}시험일 {formatDate(selectedPlan.examDate)}
                {' · '}목표 도전 단계 {CHALLENGE_BAND_LABEL[selectedPlan.targetBand]}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedPlan ? (
        <>
          <EvidenceSummaryCards summary={selectedPlan.summary} />
          <section aria-labelledby="exam-student-heading">
            <div className="mb-3">
              <h2 id="exam-student-heading" className="text-lg font-semibold text-foreground">학생별 근거</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                개수와 문제별 근거를 함께 보고 다음 확인 또는 지원 여부를 결정하세요.
              </p>
            </div>
            {loading ? <SkeletonPanel rows={5} /> : <StudentEvidenceTable students={students} />}
          </section>
        </>
      ) : (
        <EmptyState title="확인할 시험 계획을 선택하세요" />
      )}
    </div>
  );
}

type PlanDraft = {
  kind: AnalysisPlanKind;
  role: LearningPathRole;
  classId: string;
  name: string;
  targetBand: ChallengeBand;
  examDate: string;
  maintenanceIntervalDays: 7 | 14 | 21 | 30;
  scopeSkillIds: string[];
  materialBookIds: string[];
  studentOverrides: Array<{ studentId: string; included: boolean; targetBand: ChallengeBand }>;
};

function initialPlanDraft(catalog: LearningAnalysisCatalog, kind: AnalysisPlanKind = 'current'): PlanDraft {
  return {
    kind,
    role: kind === 'current' ? 'primary' : 'supplemental',
    classId: catalog.classes[0]?.id ?? '',
    name: '',
    targetBand: 2,
    examDate: '',
    maintenanceIntervalDays: 21,
    scopeSkillIds: [],
    materialBookIds: [],
    studentOverrides: [],
  };
}

function toggleArrayValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export interface LearningPlanCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: LearningAnalysisCatalog;
  initialKind?: AnalysisPlanKind;
  submitting?: boolean;
  submitError?: string | null;
  onSubmit: (input: CreateLearningPlanInput) => void | Promise<void>;
}

export function LearningPlanCreateDialog({
  open,
  onOpenChange,
  catalog,
  initialKind = 'current',
  submitting = false,
  submitError,
  onSubmit,
}: LearningPlanCreateDialogProps) {
  const [draft, setDraft] = useState<PlanDraft>(() => initialPlanDraft(catalog, initialKind));
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const classStudents = useMemo(
    () => catalog.students.filter((student) => student.classIds.includes(draft.classId)),
    [catalog.students, draft.classId],
  );

  useEffect(() => {
    if (!open) return;
    setDraft(initialPlanDraft(catalog, initialKind));
    setFormError(null);
  }, [catalog, initialKind, open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = draft.name.trim();
    if (!draft.classId || !trimmedName || draft.scopeSkillIds.length === 0) {
      setFormError('반, 계획 이름, 범위 유형을 모두 입력하세요.');
      return;
    }
    if (draft.kind === 'exam' && !draft.examDate) {
      setFormError('시험 계획에는 시험일이 필요합니다.');
      return;
    }

    setFormError(null);
    setPending(true);
    try {
      await onSubmit({
        kind: draft.kind,
        role: draft.role,
        classId: draft.classId,
        name: trimmedName,
        targetBand: draft.targetBand,
        examDate: draft.kind === 'exam' ? draft.examDate : null,
        maintenanceIntervalDays: draft.kind === 'exam' ? null : draft.maintenanceIntervalDays,
        scopeSkillIds: draft.scopeSkillIds,
        materialBookIds: draft.materialBookIds,
        studentOverrides: draft.studentOverrides,
      });
      onOpenChange(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '계획을 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  };

  const busy = submitting || pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>학습 경로 만들기</DialogTitle>
          <DialogDescription>
            반의 과목·과정에 맞는 범위와 경로 역할을 정하세요. 교재는 선택 사항입니다.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend className="text-sm font-medium text-foreground">계획 종류</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(PLAN_KIND_LABEL) as AnalysisPlanKind[]).map((kind) => (
                <SelectableCard
                  key={kind}
                  selected={draft.kind === kind}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    kind,
                    role: kind === 'exam' ? 'supplemental' : current.kind === 'exam' ? (kind === 'current' ? 'primary' : 'supplemental') : current.role,
                  }))}
                >
                  <span className="block font-semibold text-foreground">{PLAN_KIND_LABEL[kind]}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{PLAN_KIND_DESCRIPTION[kind]}</span>
                </SelectableCard>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">경로 역할</legend>
            <p className="mt-1 text-xs text-muted-foreground">
              대표 경로가 이미 진행 중이면 새 대표 경로는 준비 중으로 저장됩니다.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(['primary', 'supplemental'] as LearningPathRole[]).map((role) => (
                <SelectableCard
                  key={role}
                  selected={draft.role === role}
                  disabled={draft.kind === 'exam' && role === 'primary'}
                  onClick={() => setDraft((current) => ({ ...current, role }))}
                >
                  <span className="block font-semibold text-foreground">{PATH_ROLE_LABEL[role]}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {role === 'primary' ? '반 진도를 대표하는 경로입니다.' : '시험 대비·복습 등 함께 운영하는 경로입니다.'}
                  </span>
                </SelectableCard>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="learning-plan-classroom">반</Label>
              <Select
                value={draft.classId || undefined}
                onValueChange={(classId) => setDraft((current) => ({
                  ...current,
                  classId,
                  studentOverrides: current.studentOverrides.filter((override) =>
                    catalog.students.some((student) =>
                      student.id === override.studentId && student.classIds.includes(classId),
                    ),
                  ),
                }))}
              >
                <SelectTrigger id="learning-plan-classroom" className="mt-2">
                  <SelectValue placeholder="반을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.classes.map((classroom) => (
                    <SelectItem key={classroom.id} value={classroom.id}>{classroom.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="learning-plan-name">계획 이름</Label>
              <Input
                id="learning-plan-name"
                className="mt-2"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={draft.kind === 'exam' ? '예: 2학기 중간고사' : '예: 2-2 유지 복습'}
              />
            </div>
            <div>
              <Label htmlFor="learning-plan-band">목표 도전 단계</Label>
              <Select
                value={String(draft.targetBand)}
                onValueChange={(value) => setDraft((current) => ({ ...current, targetBand: Number(value) as ChallengeBand }))}
              >
                <SelectTrigger id="learning-plan-band" className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHALLENGE_BAND_LABEL) as unknown as ChallengeBand[]).map((band) => (
                    <SelectItem key={band} value={String(band)}>{CHALLENGE_BAND_LABEL[band]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.kind === 'exam' ? (
              <div>
                <Label htmlFor="learning-plan-exam-date">시험일</Label>
                <Input
                  id="learning-plan-exam-date"
                  type="date"
                  className="mt-2"
                  value={draft.examDate}
                  onChange={(event) => setDraft((current) => ({ ...current, examDate: event.target.value }))}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="learning-plan-interval">
                  {draft.kind === 'maintenance' ? '유지 확인 주기' : '재확인 주기'}
                </Label>
                <Select
                  value={String(draft.maintenanceIntervalDays)}
                  onValueChange={(value) => setDraft((current) => ({
                    ...current,
                    maintenanceIntervalDays: Number(value) as 7 | 14 | 21 | 30,
                  }))}
                >
                  <SelectTrigger id="learning-plan-interval" className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[7, 14, 21, 30].map((days) => <SelectItem key={days} value={String(days)}>{days}일</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              학생별 적용·목표 예외
              {draft.studentOverrides.length > 0 ? ` (${draft.studentOverrides.length}명)` : ' (선택)'}
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              기본적으로 반 전체에 적용됩니다. 제외할 학생이나 목표 단계가 다른 학생만 지정하세요.
            </p>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {classStudents.map((student) => {
                const override = draft.studentOverrides.find((item) => item.studentId === student.id);
                return (
                  <div key={student.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <span className="min-w-0 truncate text-sm text-foreground">{student.name}</span>
                    <Select
                      value={override?.included === false ? 'excluded' : override ? String(override.targetBand) : 'default'}
                      onValueChange={(value) => setDraft((current) => ({
                        ...current,
                        studentOverrides: value === 'default'
                          ? current.studentOverrides.filter((item) => item.studentId !== student.id)
                          : [
                              ...current.studentOverrides.filter((item) => item.studentId !== student.id),
                              value === 'excluded'
                                ? { studentId: student.id, included: false, targetBand: current.targetBand }
                                : { studentId: student.id, included: true, targetBand: Number(value) as ChallengeBand },
                            ],
                      }))}
                    >
                      <SelectTrigger className="w-36" aria-label={`${student.name} 목표 단계`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">반 기본값</SelectItem>
                        <SelectItem value="excluded">이 경로에서 제외</SelectItem>
                        {(Object.keys(CHALLENGE_BAND_LABEL) as unknown as ChallengeBand[]).map((band) => (
                          <SelectItem key={band} value={String(band)}>
                            {CHALLENGE_BAND_LABEL[band]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
              {classStudents.length === 0 && (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  선택한 반에 활성 학생이 없습니다.
                </p>
              )}
            </div>
          </details>

          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-medium text-foreground">범위 유형</legend>
              <p className="text-xs text-muted-foreground">하나 이상 선택하세요.</p>
              <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                {catalog.skills.map((skill) => {
                  const checkboxId = `plan-skill-${skill.id}`;
                  return (
                    <div key={skill.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <Checkbox
                        id={checkboxId}
                        checked={draft.scopeSkillIds.includes(skill.id)}
                        onCheckedChange={() => setDraft((current) => ({
                          ...current,
                          scopeSkillIds: toggleArrayValue(current.scopeSkillIds, skill.id),
                        }))}
                      />
                      <Label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block text-foreground">{skill.name}</span>
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">{skill.unitLabel}</span>
                      </Label>
                    </div>
                  );
                })}
                {catalog.skills.length === 0 && (
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">선택할 수 있는 공통 유형이 없습니다.</p>
                )}
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-medium text-foreground">연결 자료</legend>
              <p className="text-xs text-muted-foreground">교재나 문제집이 없어도 계획을 저장할 수 있습니다.</p>
              <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                {catalog.materials.map((material) => {
                  const checkboxId = `plan-material-${material.id}`;
                  return (
                    <div key={material.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                      <Checkbox
                        id={checkboxId}
                        checked={draft.materialBookIds.includes(material.id)}
                        onCheckedChange={() => setDraft((current) => ({
                          ...current,
                          materialBookIds: toggleArrayValue(current.materialBookIds, material.id),
                        }))}
                      />
                      <Label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                        <span className="block text-foreground">{material.name}</span>
                        {material.description && (
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">{material.description}</span>
                        )}
                      </Label>
                    </div>
                  );
                })}
                {catalog.materials.length === 0 && (
                  <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">연결할 자료가 없습니다. 그대로 계획을 만들 수 있습니다.</p>
                )}
              </div>
            </fieldset>
          </div>

          {(formError || submitError) && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {formError || submitError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={busy}>{busy ? '저장하는 중' : '경로 저장'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LearningAnalysisView({
  data,
  loading,
  error,
  initialTab = 'class-learning',
  selectedExamPlanId,
  submittingPlan = false,
  planSubmitError,
  onRetry,
  onSelectedExamPlanChange,
  onSubmitPlan,
  onStartPath,
  onChangePathStatus,
  onCreateAssignmentDraft,
}: LearningAnalysisViewProps) {
  const [tab, setTab] = useState<LearningAnalysisTab>(initialTab);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [createPlanKind, setCreatePlanKind] = useState<AnalysisPlanKind>('current');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const openPlanDialog = (kind: AnalysisPlanKind) => {
    setCreatePlanKind(kind);
    setCreatePlanOpen(true);
  };

  if (loading && !data) return <LearningAnalysisLoading />;

  if (!data) {
    return (
      <PageShell title="학습 경로" icon={BarChart3}>
        {error ? (
          <ErrorState
            title="학습 경로를 불러오지 못했습니다"
            description={error}
            retryLabel="다시 시도"
            onRetry={onRetry}
          />
        ) : (
          <EmptyState title="표시할 학습 경로 데이터가 없습니다" />
        )}
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        title="학습 경로"
        icon={BarChart3}
        actions={(
          <Button type="button" onClick={() => openPlanDialog(tab === 'exam-preparation' ? 'exam' : 'current')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            경로 만들기
          </Button>
        )}
        status={error ? (
          <PageStatusBar
            tone="danger"
            action={onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry}>다시 시도</Button> : undefined}
          >
            최신 데이터를 불러오지 못했습니다. 현재 화면에는 이전 데이터가 표시될 수 있습니다. {error}
          </PageStatusBar>
        ) : undefined}
      >
        <Tabs value={tab} onValueChange={(value) => setTab(value as LearningAnalysisTab)} variant="underline">
          <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
            <TabsTrigger value="class-learning">
              <BookOpen className="mr-2 h-4 w-4" aria-hidden="true" />반 학습
            </TabsTrigger>
            <TabsTrigger value="exam-preparation">
              <CalendarDays className="mr-2 h-4 w-4" aria-hidden="true" />시험 대비
            </TabsTrigger>
          </TabsList>
          <TabsContent value="class-learning">
            <ClassLearningSection
              paths={data.paths}
              actionQueue={data.actionQueue}
              onCreateAssignmentDraft={onCreateAssignmentDraft}
              onStartPath={onStartPath}
              onChangePathStatus={onChangePathStatus}
            />
          </TabsContent>
          <TabsContent value="exam-preparation">
            <ExamPreparationSection
              plans={data.examPlans}
              selectedPlanId={selectedExamPlanId}
              students={data.examStudents}
              loading={loading}
              onSelectedPlanChange={onSelectedExamPlanChange}
              onRequestCreatePlan={() => openPlanDialog('exam')}
            />
          </TabsContent>
        </Tabs>
      </PageShell>

      <LearningPlanCreateDialog
        open={createPlanOpen}
        onOpenChange={setCreatePlanOpen}
        catalog={data.catalog}
        initialKind={createPlanKind}
        submitting={submittingPlan}
        submitError={planSubmitError}
        onSubmit={onSubmitPlan}
      />
    </>
  );
}
