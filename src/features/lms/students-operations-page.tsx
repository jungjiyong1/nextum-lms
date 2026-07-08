'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BarChart3,
    BookOpen,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock3,
    Copy,
    CreditCard,
    GraduationCap,
    KeyRound,
    MessageSquare,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    ShieldAlert,
    Target,
    Trash2,
    UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { PasswordConfirmDialog } from '@/components/security/PasswordConfirmDialog';
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
import { EmptyState, ErrorState } from '@/components/ui/state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SelectableCard } from '@/components/ui/selectable-card';
import { Skeleton, SkeletonPage, SkeletonPanel } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
    addLmsInvalidationListener,
    archiveStudent,
    createStudent,
    hardDeleteStudent,
    issueStudentInvitation,
    loadStudentDetail,
    loadStudentLearningMetrics,
    loadStudentOperationsOverview,
    previewHardDeleteStudent,
    updateStudent,
} from './service';
import type {
    BillingMode,
    ClassSummary,
    CreateStudentResult,
    StudentDetail,
    StudentDetailSection,
    StudentHardDeletePreview,
    StudentLearningMetric,
    StudentLearningPeriod,
    StudentOperationsPermissions,
    StudentStatus,
    StudentSummary,
} from './types';

type StudentFilterStatus = 'operations' | 'all' | StudentStatus;
type StudentSortMode = 'risk' | 'recent' | 'name';
type FormMode = 'create' | 'edit' | null;
type StudentPageLoadOptions = { force?: boolean; background?: boolean };
type StudentDetailLoadOptions = StudentPageLoadOptions & { replace?: boolean; period?: StudentLearningPeriod; assignmentId?: string | null };

const emptyPermissions: StudentOperationsPermissions = {
    canCreate: false,
    canEdit: false,
    canArchive: false,
    canViewBilling: false,
    canHardDelete: false,
    scopedToAssignedClasses: false,
};

const DETAIL_SECTION_BY_TAB: Record<string, StudentDetailSection | null> = {
    learning: 'learning',
    profile: null,
    attendance: 'attendance',
    billing: 'billing',
    manage: 'management',
};

function hasLoadedSection(detail: StudentDetail | null, section: StudentDetailSection): boolean {
    if (!detail) return false;
    return detail.loadedSections.includes('full') || detail.loadedSections.includes(section);
}

function uniqueSections(sections: StudentDetailSection[]): StudentDetailSection[] {
    return [...new Set(sections)];
}

function mergeStudentDetail(current: StudentDetail | null, next: StudentDetail): StudentDetail {
    if (!current || current.summary.id !== next.summary.id) return next;

    const loadedSections = uniqueSections([...current.loadedSections, ...next.loadedSections]);
    const nextLoaded = (section: StudentDetailSection) => next.loadedSections.includes('full') || next.loadedSections.includes(section);

    return {
        summary: {
            ...current.summary,
            ...next.summary,
            weakTypeCount: next.summary.learningMetricsLoaded ? next.summary.weakTypeCount : current.summary.weakTypeCount,
            avgTypeScore: next.summary.learningMetricsLoaded ? next.summary.avgTypeScore : current.summary.avgTypeScore,
            lastLearningAt: next.summary.learningMetricsLoaded ? next.summary.lastLearningAt : current.summary.lastLearningAt,
            learningMetricsLoaded: current.summary.learningMetricsLoaded || next.summary.learningMetricsLoaded,
        },
        permissions: next.permissions,
        loadedSections,
        signupInvitation: next.signupInvitation,
        hasGradeAppAccount: next.hasGradeAppAccount,
        learningAnalytics: nextLoaded('learning') ? next.learningAnalytics : current.learningAnalytics,
        weakTypes: nextLoaded('learning') ? next.weakTypes : current.weakTypes,
        recentAttempts: nextLoaded('learning') ? next.recentAttempts : current.recentAttempts,
        aiConversations: nextLoaded('learning') ? next.aiConversations : current.aiConversations,
        reports: nextLoaded('learning') ? next.reports : current.reports,
        attendanceSummary: nextLoaded('attendance') ? next.attendanceSummary : current.attendanceSummary,
        recentAttendance: nextLoaded('attendance') ? next.recentAttendance : current.recentAttendance,
        billing: nextLoaded('billing') ? next.billing : current.billing,
        recentPayments: nextLoaded('billing') ? next.recentPayments : current.recentPayments,
        hardDeletePreview: next.hardDeletePreview || current.hardDeletePreview,
    };
}

function academyIdOf(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function currency(value: number | null | undefined): string {
    return `${Math.round(value || 0).toLocaleString()}원`;
}

function shortDate(value: string | null | undefined): string {
    if (!value) return '-';
    return value.slice(0, 10);
}

function statusLabel(status: string): string {
    const labels: Record<string, string> = {
        active: '재원',
        inactive: '중지',
        on_leave: '휴원',
        graduated: '졸업',
        dropped: '퇴원/보관',
        weak: '취약',
        watch: '주의',
        insufficient: '표본 부족',
        ok: '양호',
        present: '출석',
        late: '지각',
        absent: '결석',
        excused: '인정 결석',
        makeup: '보강',
        issued: '청구',
        paid: '완납',
        partial: '부분 납부',
        not_issued: '미발행',
        draft: '초안',
    };
    return labels[status] || status;
}

function billingModeLabel(mode: BillingMode | null): string {
    if (mode === 'monthly_plus_classes') return '기본료 + 반 추가금';
    if (mode === 'usage_based') return '시간제';
    if (mode === 'manual') return '수동 청구';
    return '-';
}

function StudentStatusBadge({ status }: { status: string }) {
    return <StatusBadge status={status} label={statusLabel(status)} />;
}

function LoadingBlock() {
    return <SkeletonPanel className="min-h-[320px]" rows={6} />;
}

function StudentDetailSkeleton() {
    return (
        <Card className="overflow-hidden">
            <CardHeader className="border-b">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-4 w-72 max-w-full" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="h-12 w-24" />
                        <Skeleton className="h-12 w-24" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-4">
                <div className="mb-4 flex flex-wrap gap-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-24" />)}
                </div>
                <SkeletonPanel rows={5} showHeader={false} />
            </CardContent>
        </Card>
    );
}

function StudentTabSkeleton() {
    return <SkeletonPanel rows={4} showHeader={false} />;
}

function EmptyDetail({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
    return (
        <Card className="min-h-[520px]">
            <CardContent className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-center">
                <UserRound className="h-9 w-9 text-muted-foreground" />
                <div>
                    <p className="text-sm font-medium text-foreground">학생을 선택하세요.</p>
                    <p className="mt-1 text-xs text-muted-foreground">왼쪽 목록에서 학생을 클릭하면 상세 정보가 열립니다.</p>
                </div>
                {canCreate && (
                    <Button type="button" variant="outline" size="sm" onClick={onCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        학생 등록
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

function summarizeRisk(student: StudentSummary): string {
    const weakCount = student.weakTypeCount || 0;
    if (weakCount > 0) return `${weakCount}개 취약`;
    if (student.avgTypeScore !== null && student.avgTypeScore !== undefined) return `${student.avgTypeScore}점`;
    return '데이터 없음';
}

function sortStudents(students: StudentSummary[], sortMode: StudentSortMode): StudentSummary[] {
    return [...students].sort((a, b) => {
        if (sortMode === 'name') return a.name.localeCompare(b.name, 'ko');
        if (sortMode === 'recent') {
            return String(b.lastLearningAt || '').localeCompare(String(a.lastLearningAt || ''));
        }
        return (b.weakTypeCount || 0) - (a.weakTypeCount || 0)
            || (a.avgTypeScore ?? 101) - (b.avgTypeScore ?? 101)
            || a.name.localeCompare(b.name, 'ko');
    });
}

function StudentList({
    students,
    selectedStudentId,
    metricsLoading,
    onSelect,
}: {
    students: StudentSummary[];
    selectedStudentId: string;
    metricsLoading: boolean;
    onSelect: (student: StudentSummary) => void;
}) {
    return (
        <div className="space-y-2 bg-card p-2">
            {students.map((student) => (
                <SelectableCard
                    key={student.id}
                    selected={selectedStudentId === student.id}
                    className="flex items-start justify-between gap-3"
                    onClick={() => onSelect(student)}
                >
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-foreground">{student.name}</span>
                            <StudentStatusBadge status={student.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{student.classNames.join(', ') || '배정 반 없음'}</p>
                        <p className="mt-1 text-xs text-muted-foreground/80">{student.phone || '-'} · 보호자 {student.parentPhone || '-'}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                        {metricsLoading && !student.learningMetricsLoaded ? (
                            <div className="space-y-1">
                                <Skeleton className="ml-auto h-4 w-16" />
                                <Skeleton className="ml-auto h-3 w-20" />
                            </div>
                        ) : (
                            <>
                                <p className={cn('font-medium', (student.weakTypeCount || 0) > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                                    {summarizeRisk(student)}
                                </p>
                                <p className="mt-1 text-muted-foreground/80">{shortDate(student.lastLearningAt)}</p>
                            </>
                        )}
                    </div>
                </SelectableCard>
            ))}
            {students.length === 0 && (
                <EmptyState title="조건에 맞는 학생이 없습니다." className="border-0" />
            )}
        </div>
    );
}

function percentText(value: number | null | undefined): string {
    return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function learningStatusLabel(status: string): string {
    if (status === 'weak') return '취약';
    if (status === 'watch') return '주의';
    if (status === 'ok') return '양호';
    return '표본 부족';
}

function learningStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
    if (status === 'weak') return 'danger';
    if (status === 'watch') return 'warning';
    if (status === 'ok') return 'success';
    return 'neutral';
}

function assignmentProgressLabel(status: string): string {
    if (status === 'completed') return '완료';
    if (status === 'in_progress') return '진행중';
    return '미시작';
}

function assignmentProgressTone(status: string): 'neutral' | 'success' | 'warning' {
    if (status === 'completed') return 'success';
    if (status === 'in_progress') return 'warning';
    return 'neutral';
}

function PercentBar({ value, status }: { value: number | null | undefined; status?: string }) {
    const width = Math.max(0, Math.min(100, value ?? 0));
    const tone = learningStatusTone(status || 'ok');
    const color = tone === 'danger' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning-foreground' : 'bg-primary';
    return (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-[width]', color)} style={{ width: `${width}%` }} />
        </div>
    );
}

function MetricTile({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
    return (
        <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
        </div>
    );
}

function LearningTab({
    detail,
    period,
    selectedAssignmentId,
    onPeriodChange,
    onAssignmentChange,
}: {
    detail: StudentDetail;
    period: StudentLearningPeriod;
    selectedAssignmentId: string | null;
    onPeriodChange: (period: StudentLearningPeriod) => void;
    onAssignmentChange: (assignmentId: string | null) => void;
}) {
    const analytics = detail.learningAnalytics;
    const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set());
    const overview = analytics?.overview;
    const units = analytics?.units || [];
    const assignments = analytics?.assignments || [];

    const toggleUnit = (unitKey: string) => {
        setExpandedUnitIds((current) => {
            const next = new Set(current);
            if (next.has(unitKey)) next.delete(unitKey);
            else next.add(unitKey);
            return next;
        });
    };

    return (
        <div className="grid min-w-0 gap-4">
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-sm font-medium text-foreground">학습분석</p>
                    <p className="mt-1 text-xs text-muted-foreground">기간과 과제를 바꾸면 단원, 유형, 채점, AI 대화가 같은 기준으로 갱신됩니다.</p>
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,140px)_minmax(0,320px)]">
                    <Select value={period} onValueChange={(value) => onPeriodChange(value as StudentLearningPeriod)}>
                        <SelectTrigger className="min-w-0">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="30d">최근 30일</SelectItem>
                            <SelectItem value="90d">최근 90일</SelectItem>
                            <SelectItem value="180d">최근 180일</SelectItem>
                            <SelectItem value="all">전체 누적</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={selectedAssignmentId || 'all'} onValueChange={(value) => onAssignmentChange(value === 'all' ? null : value)}>
                        <SelectTrigger className="min-w-0">
                            <SelectValue placeholder="전체 학습" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체 학습</SelectItem>
                            {assignments.map((assignment) => (
                                <SelectItem key={assignment.id} value={assignment.id}>{assignment.title}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <MetricTile label="풀이 문항" value={`${overview?.attemptedProblemCount ?? 0}개`} icon={Target} />
                <MetricTile label="정답률" value={percentText(overview?.correctRate)} icon={BarChart3} />
                <MetricTile label="취약/주의" value={`${(overview?.weakTypeCount ?? 0) + (overview?.watchTypeCount ?? 0)}개`} icon={ShieldAlert} />
                <MetricTile label="완료 과제" value={`${overview?.completedAssignmentCount ?? 0}/${overview?.assignmentCount ?? 0}`} icon={CheckCircle2} />
                <MetricTile label="AI 대화" value={`${overview?.aiConversationCount ?? detail.aiConversations.length}건`} icon={MessageSquare} />
            </div>

            <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)]">
                <div className="min-w-0 rounded-lg border bg-card">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                        <div>
                            <p className="text-sm font-medium text-foreground">단원별 이해도</p>
                            <p className="mt-1 text-xs text-muted-foreground">단원을 펼치면 하위 유형별 정답률과 표본을 볼 수 있습니다.</p>
                        </div>
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="divide-y">
                        {units.map((unit) => {
                            const unitKey = unit.unitId || 'none';
                            const expanded = expandedUnitIds.has(unitKey);
                            return (
                                <div key={unitKey} className="p-4">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="truncate font-medium text-foreground">{unit.unitName}</p>
                                                <StatusBadge tone={learningStatusTone(unit.status)} label={learningStatusLabel(unit.status)} />
                                                {unit.bookTitle && <StatusBadge tone="neutral" label={unit.bookTitle} />}
                                            </div>
                                            <div className="mt-3 max-w-xl">
                                                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                                                    <span>정답률</span>
                                                    <span>{percentText(unit.score)} · 표본 {unit.sampleCount}</span>
                                                </div>
                                                <PercentBar value={unit.score} status={unit.status} />
                                            </div>
                                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                                {unit.types.slice(0, 3).map((type) => (
                                                    <div key={`${unitKey}-${type.typeId || type.typeName}`} className="rounded-md bg-muted p-2">
                                                        <div className="flex items-center justify-between gap-2 text-xs">
                                                            <span className="truncate text-muted-foreground">{type.typeName}</span>
                                                            <span className="font-medium text-foreground">{percentText(type.score)}</span>
                                                        </div>
                                                        <div className="mt-1"><PercentBar value={type.score} status={type.status} /></div>
                                                    </div>
                                                ))}
                                                {unit.types.length === 0 && <p className="text-xs text-muted-foreground">아직 풀이한 유형이 없습니다.</p>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 md:flex-col md:items-end">
                                            <p className="text-xs text-muted-foreground">최근 {shortDate(unit.lastAttemptedAt)}</p>
                                            <Button type="button" variant="ghost" size="sm" onClick={() => toggleUnit(unitKey)}>
                                                {expanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
                                                유형 보기
                                            </Button>
                                        </div>
                                    </div>
                                    {expanded && (
                                        <div className="mt-4 grid gap-2">
                                            {unit.types.map((type) => (
                                                <div key={`${unitKey}-detail-${type.typeId || type.typeName}`} className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[1fr_120px_90px] md:items-center">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium text-foreground">{type.typeName}</p>
                                                        <p className="mt-1 text-xs text-muted-foreground">표본 {type.sampleCount} · 정답 {type.correctCount} · 최근 {shortDate(type.lastAttemptedAt)}</p>
                                                    </div>
                                                    <PercentBar value={type.score} status={type.status} />
                                                    <div className="text-right">
                                                        <StatusBadge tone={learningStatusTone(type.status)} label={learningStatusLabel(type.status)} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {units.length === 0 && <EmptyState title="분석할 풀이 데이터가 없습니다." description="기간이나 과제 필터를 바꾸면 다른 데이터가 보일 수 있습니다." className="border-0 py-10" />}
                    </div>
                </div>

                <div className="grid min-w-0 gap-4">
                    <div className="min-w-0 rounded-lg border bg-card">
                        <div className="border-b px-4 py-3 text-sm font-medium">과제 진행</div>
                        <div className="divide-y">
                            {assignments.slice(0, 6).map((assignment) => (
                                <SelectableCard
                                    key={assignment.id}
                                    className={cn(
                                        'rounded-none border-0 px-4 py-3',
                                    )}
                                    selected={selectedAssignmentId === assignment.id}
                                    onClick={() => onAssignmentChange(selectedAssignmentId === assignment.id ? null : assignment.id)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-foreground">{assignment.title}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">{assignment.bookTitle || '외부 학습지'} · {shortDate(assignment.dueAt)}</p>
                                        </div>
                                        <StatusBadge tone={assignmentProgressTone(assignment.progressStatus)} label={assignmentProgressLabel(assignment.progressStatus)} />
                                    </div>
                                    <div>
                                        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                                            <span>{assignment.attemptedProblemCount}/{assignment.requiredProblemCount || assignment.attemptedProblemCount}문항</span>
                                            <span>{percentText(assignment.correctRate)}</span>
                                        </div>
                                        <PercentBar value={assignment.correctRate} status={assignment.correctRate !== null && assignment.correctRate < 50 ? 'weak' : assignment.correctRate !== null && assignment.correctRate < 75 ? 'watch' : 'ok'} />
                                    </div>
                                </SelectableCard>
                            ))}
                            {assignments.length === 0 && <EmptyState title="연결된 과제가 없습니다." className="border-0 py-8" />}
                        </div>
                    </div>

                    <div className="min-w-0 rounded-lg border bg-card">
                        <div className="border-b px-4 py-3 text-sm font-medium">최근 채점</div>
                        <div className="divide-y">
                            {detail.recentAttempts.map((row) => (
                                <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-foreground">{row.label}</p>
                                        <p className="text-xs text-muted-foreground">{row.unitName || '단원 미지정'} · {row.typeName || '유형 미지정'} · {shortDate(row.createdAt)}</p>
                                    </div>
                                    <StatusBadge tone={row.correct ? 'success' : 'danger'} label={row.correct ? '정답' : '오답'} />
                                </div>
                            ))}
                            {detail.recentAttempts.length === 0 && <EmptyState title="최근 채점 데이터가 없습니다." className="border-0 py-8" />}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="min-w-0 rounded-lg border bg-card">
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                        <div>
                            <p className="text-sm font-medium text-foreground">AI 대화</p>
                            <p className="mt-1 text-xs text-muted-foreground">선택한 과제 기준의 대화 내용을 바로 확인합니다.</p>
                        </div>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="divide-y">
                        {detail.aiConversations.map((conversation) => (
                            <div key={conversation.id} className="space-y-3 px-4 py-4">
                                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-foreground">{conversation.title || '제목 없는 대화'}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {conversation.assignmentTitle || '과제 연결 없음'} · {conversation.sourceApp || '-'} · {shortDate(conversation.updatedAt)}
                                        </p>
                                    </div>
                                    <StatusBadge status={conversation.status} />
                                </div>
                                <div className="grid gap-2">
                                    {(conversation.messages || []).map((message) => (
                                        <div
                                            key={message.id}
                                            className={cn(
                                                'rounded-lg p-3 text-sm',
                                                message.role === 'assistant' ? 'bg-muted text-foreground' : 'bg-primary-soft text-foreground',
                                            )}
                                        >
                                            <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                                <span>{message.role === 'assistant' ? 'AI' : '학생'}</span>
                                                <span>{shortDate(message.createdAt)}</span>
                                            </div>
                                            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
                                        </div>
                                    ))}
                                    {(conversation.messages || []).length === 0 && <p className="text-xs text-muted-foreground">표시할 메시지가 없습니다.</p>}
                                </div>
                            </div>
                        ))}
                        {detail.aiConversations.length === 0 && <EmptyState title="AI 대화 데이터가 없습니다." className="border-0 py-10" />}
                    </div>
                </div>

                <div className="min-w-0 rounded-lg border bg-card">
                    <div className="border-b px-4 py-3 text-sm font-medium">리포트 소재</div>
                    <div className="divide-y">
                        {detail.reports.map((row) => (
                            <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-foreground">{row.title || row.reportType}</p>
                                    <p className="text-xs text-muted-foreground">{row.reportType} · {shortDate(row.generatedAt)}</p>
                                </div>
                                <StudentStatusBadge status={row.status} />
                            </div>
                        ))}
                        {detail.reports.length === 0 && <EmptyState title="저장된 리포트가 없습니다." className="border-0 py-8" />}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ProfileTab({
    student,
    canEdit,
    classes,
    formMode,
    formProps,
    onStartEdit,
}: {
    student: StudentSummary;
    canEdit: boolean;
    classes: ClassSummary[];
    formMode: FormMode;
    formProps: Omit<StudentFormProps, 'mode' | 'classes'>;
    onStartEdit: () => void;
}) {
    if (canEdit && formMode === 'edit') {
        return (
            <div className="rounded-xl border bg-card p-4">
                <div className="mb-4">
                    <p className="text-sm font-medium text-foreground">프로필 수정</p>
                    <p className="mt-1 text-xs text-muted-foreground">학생 기본 정보, 연락처, 반 배정, 청구 기준을 수정합니다.</p>
                </div>
                <StudentForm {...formProps} mode="edit" classes={classes} />
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-muted-foreground">학생 정보</p>
                    {canEdit && (
                        <Button type="button" variant="outline" size="sm" onClick={onStartEdit}>
                            <Pencil className="mr-2 h-4 w-4" />
                            프로필 수정
                        </Button>
                    )}
                </div>
                <dl className="mt-3 grid gap-3 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">이름</dt><dd className="font-medium">{student.name}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">상태</dt><dd><StudentStatusBadge status={student.status} /></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">학년/메모</dt><dd>{student.grade || '-'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">학생 연락처</dt><dd>{student.phone || '-'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">보호자</dt><dd>{student.parentName || '-'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">보호자 연락처</dt><dd>{student.parentPhone || '-'}</dd></div>
                </dl>
            </div>
            <div className="rounded-xl border bg-card p-4">
                <p className="text-xs font-medium text-muted-foreground">반 배정</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {student.classNames.map((name) => (
                        <span key={name} className="rounded-full bg-muted px-3 py-1 text-sm text-foreground">{name}</span>
                    ))}
                    {student.classNames.length === 0 && <span className="text-sm text-muted-foreground">배정된 반이 없습니다.</span>}
                </div>
            </div>
        </div>
    );
}

function AttendanceTab({ detail }: { detail: StudentDetail }) {
    const summary = detail.attendanceSummary;
    return (
        <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-5">
                {(['present', 'late', 'absent', 'excused', 'makeup'] as const).map((status) => (
                    <div key={status} className="rounded-xl border bg-card p-3">
                        <p className="text-xs text-muted-foreground">{statusLabel(status)}</p>
                        <p className="mt-1 text-xl font-semibold text-foreground">{summary[status]}건</p>
                    </div>
                ))}
            </div>
            <DataTable>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>일자</TableHead>
                            <TableHead>반</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead>시간</TableHead>
                            <TableHead>메모</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {detail.recentAttendance.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell>{row.date}</TableCell>
                                <TableCell>{row.className}</TableCell>
                                <TableCell><StudentStatusBadge status={row.status} /></TableCell>
                                <TableCell>{row.attendedMinutes ?? 0}분 / {row.billableMinutes ?? 0}분</TableCell>
                                <TableCell>{row.notes || '-'}</TableCell>
                            </TableRow>
                        ))}
                        {detail.recentAttendance.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5}>
                                    <EmptyState title="출결 기록이 없습니다." className="border-0 py-6" />
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </DataTable>
        </div>
    );
}

function BillingTab({ detail }: { detail: StudentDetail }) {
    const student = detail.summary;
    return (
        <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border bg-card p-3">
                    <p className="text-xs text-muted-foreground">청구 방식</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{billingModeLabel(student.billingMode)}</p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                    <p className="text-xs text-muted-foreground">기본료</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{currency(student.baseMonthlyFee)}</p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                    <p className="text-xs text-muted-foreground">추가 반 금액</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{currency(student.extraClassFee)}</p>
                </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium text-foreground">최근 청구</p>
                        <p className="mt-1 text-xs text-muted-foreground">{detail.billing?.invoiceId || '발행된 청구서 없음'}</p>
                    </div>
                    {detail.billing ? <StudentStatusBadge status={detail.billing.status} /> : <StudentStatusBadge status="not_issued" />}
                </div>
                {detail.billing && (
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                        <div><span className="text-muted-foreground">청구액</span><p className="font-medium">{currency(detail.billing.invoicedAmount)}</p></div>
                        <div><span className="text-muted-foreground">납부액</span><p className="font-medium">{currency(detail.billing.paidAmount)}</p></div>
                        <div><span className="text-muted-foreground">예상액</span><p className="font-medium">{currency(detail.billing.expectedAmount)}</p></div>
                    </div>
                )}
            </div>
            <div className="rounded-xl border bg-card">
                <div className="border-b px-4 py-3 text-sm font-medium">최근 납부</div>
                <div className="divide-y">
                    {detail.recentPayments.map((row) => (
                        <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                            <div>
                                <p className="font-medium text-foreground">{currency(row.amount)}</p>
                                <p className="text-xs text-muted-foreground">{row.paymentDate} · {row.paymentMethod || '-'}</p>
                            </div>
                            <StudentStatusBadge status={row.status} />
                        </div>
                    ))}
                    {detail.recentPayments.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">납부 기록이 없습니다.</p>}
                </div>
            </div>
        </div>
    );
}

interface StudentFormProps {
    mode: Exclude<FormMode, null>;
    classes: ClassSummary[];
    name: string;
    phone: string;
    parentName: string;
    parentPhone: string;
    grade: string;
    status: StudentStatus;
    billingMode: BillingMode;
    baseFee: string;
    hourlyRate: string;
    extraClassFee: string;
    selectedClassIds: Set<string>;
    submitting: boolean;
    onName: (value: string) => void;
    onPhone: (value: string) => void;
    onParentName: (value: string) => void;
    onParentPhone: (value: string) => void;
    onGrade: (value: string) => void;
    onStatus: (value: StudentStatus) => void;
    onBillingMode: (value: BillingMode) => void;
    onBaseFee: (value: string) => void;
    onHourlyRate: (value: string) => void;
    onExtraClassFee: (value: string) => void;
    onToggleClass: (classId: string) => void;
    onCancel: () => void;
    onSubmit: (event: React.FormEvent) => void;
}

function StudentForm(props: StudentFormProps) {
    return (
        <form onSubmit={props.onSubmit} className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
                <div>
                    <Label>이름</Label>
                    <Input value={props.name} onChange={(event) => props.onName(event.target.value)} />
                </div>
                <div>
                    <Label>학년/메모</Label>
                    <Input value={props.grade} onChange={(event) => props.onGrade(event.target.value)} placeholder="중2" />
                </div>
                <div>
                    <Label>학생 연락처</Label>
                    <Input value={props.phone} onChange={(event) => props.onPhone(event.target.value)} />
                </div>
                <div>
                    <Label>보호자 이름</Label>
                    <Input value={props.parentName} onChange={(event) => props.onParentName(event.target.value)} placeholder="보호자 이름" />
                </div>
                <div>
                    <Label>보호자 연락처</Label>
                    <Input value={props.parentPhone} onChange={(event) => props.onParentPhone(event.target.value)} />
                </div>
            </div>

            {props.mode === 'edit' && (
                <div>
                    <Label>상태</Label>
                    <Select value={props.status} onValueChange={(value) => props.onStatus(value as StudentStatus)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="active">재원</SelectItem>
                            <SelectItem value="on_leave">휴원</SelectItem>
                            <SelectItem value="inactive">중지</SelectItem>
                            <SelectItem value="graduated">졸업</SelectItem>
                            <SelectItem value="dropped">퇴원/보관</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}

            <div>
                <Label>반 배정</Label>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {props.classes.map((row) => (
                        <label key={row.id} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                            <Checkbox checked={props.selectedClassIds.has(row.id)} onCheckedChange={() => props.onToggleClass(row.id)} />
                            <span className="truncate">{row.name}</span>
                        </label>
                    ))}
                    {props.classes.length === 0 && <p className="text-sm text-muted-foreground">배정 가능한 반이 없습니다.</p>}
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <div>
                    <Label>청구 방식</Label>
                    <Select value={props.billingMode} onValueChange={(value) => props.onBillingMode(value as BillingMode)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="monthly_plus_classes">기본료 + 추가반</SelectItem>
                            <SelectItem value="usage_based">시간제</SelectItem>
                            <SelectItem value="manual">수동 청구</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label>기본료</Label>
                    <Input type="number" value={props.baseFee} onChange={(event) => props.onBaseFee(event.target.value)} />
                </div>
                <div>
                    <Label>시간제 금액</Label>
                    <Input type="number" value={props.hourlyRate} onChange={(event) => props.onHourlyRate(event.target.value)} />
                </div>
                <div>
                    <Label>추가반 금액</Label>
                    <Input type="number" value={props.extraClassFee} onChange={(event) => props.onExtraClassFee(event.target.value)} />
                </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" disabled={props.submitting}>
                    {props.submitting ? '저장 중...' : props.mode === 'create' ? '학생 등록' : '수정 저장'}
                </Button>
                <Button type="button" variant="outline" onClick={props.onCancel} disabled={props.submitting}>
                    취소
                </Button>
            </div>
        </form>
    );
}

function ManagementTab({
    detail,
    classes,
    formMode,
    formProps,
    onStartEdit,
    onArchive,
    onHardDelete,
    onCopyInviteCode,
    onIssueInvitation,
    issuingInvitation,
}: {
    detail: StudentDetail;
    classes: ClassSummary[];
    formMode: FormMode;
    formProps: Omit<StudentFormProps, 'mode' | 'classes'>;
    onStartEdit: () => void;
    onArchive: () => void;
    onHardDelete: () => void;
    onCopyInviteCode: (code: string | null | undefined) => void;
    onIssueInvitation: () => void;
    issuingInvitation: boolean;
}) {
    const preview = detail.hardDeletePreview;
    return (
        <div className="grid gap-4">
            {detail.permissions.canEdit && (
                <div className="rounded-xl border bg-card p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <KeyRound className="h-4 w-4" />
                                Grade app 가입 코드
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                미사용 코드만 표시됩니다. 학생이 가입하면 코드는 더 이상 사용할 수 없습니다.
                            </p>
                        </div>
                        {!detail.hasGradeAppAccount && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={onIssueInvitation}
                                disabled={issuingInvitation}
                            >
                                <RefreshCw className={cn('mr-2 h-4 w-4', issuingInvitation && 'animate-spin')} />
                                {detail.signupInvitation ? '재발급' : '발급'}
                            </Button>
                        )}
                    </div>
                    <div className="mt-4 rounded-xl bg-muted p-3">
                        {detail.hasGradeAppAccount ? (
                            <p className="text-sm font-medium text-success-foreground">가입 완료</p>
                        ) : detail.signupInvitation ? (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <code className="select-all break-all text-xl font-semibold tracking-[0.18em] text-foreground">
                                        {detail.signupInvitation.inviteCode}
                                    </code>
                                    <p className="mt-1 text-xs text-muted-foreground">만료일 {shortDate(detail.signupInvitation.expiresAt)}</p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onCopyInviteCode(detail.signupInvitation?.inviteCode)}
                                >
                                    <Copy className="mr-2 h-4 w-4" />
                                    복사
                                </Button>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">사용 가능한 가입 코드가 없습니다.</p>
                        )}
                    </div>
                </div>
            )}

            {detail.permissions.canEdit && (
                <div className="rounded-xl border bg-card p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium text-foreground">학생 정보 수정</p>
                            <p className="mt-1 text-xs text-muted-foreground">연락처, 반 배정, 청구 계약을 수정합니다.</p>
                        </div>
                        {formMode !== 'edit' && (
                            <Button type="button" variant="outline" size="sm" onClick={onStartEdit}>
                                <Pencil className="mr-2 h-4 w-4" />
                                수정
                            </Button>
                        )}
                    </div>
                    {formMode === 'edit' ? (
                        <StudentForm {...formProps} mode="edit" classes={classes} />
                    ) : (
                        <ProfileTab
                            student={detail.summary}
                            canEdit={false}
                            classes={classes}
                            formMode={formMode}
                            formProps={formProps}
                            onStartEdit={onStartEdit}
                        />
                    )}
                </div>
            )}

            {detail.permissions.canArchive && (
                <div className="rounded-xl border border-warning/30 bg-warning-soft p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-warning-foreground">
                                <ShieldAlert className="h-4 w-4" />
                                퇴원/보관
                            </p>
                            <p className="mt-1 text-sm text-warning-foreground">
                                운영 목록에서 숨기고 반 배정, 청구 계약, 학생 멤버십을 종료합니다. 회계, 출결, 학습, AI 이력은 보존됩니다.
                            </p>
                        </div>
                        <Button type="button" variant="outline" onClick={onArchive} disabled={detail.summary.status === 'dropped'}>
                            퇴원/보관 처리
                        </Button>
                    </div>
                </div>
            )}

            {detail.permissions.canHardDelete && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                                <Trash2 className="h-4 w-4" />
                                오등록 완전삭제
                            </p>
                            <p className="mt-1 text-sm text-destructive">
                                청구, 납부, 출결, 학습, AI, 리포트 이력이 0건일 때만 삭제할 수 있습니다.
                            </p>
                            {preview && !preview.canHardDelete && (
                                <p className="mt-2 text-xs text-destructive">
                                    이력 {preview.historicalRecordCount}건 또는 공유 신원 {preview.sharedIdentityCount}건이 있어 완전삭제가 차단됩니다.
                                </p>
                            )}
                        </div>
                        <Button type="button" variant="destructive" onClick={onHardDelete} disabled={preview ? !preview.canHardDelete : false}>
                            완전삭제
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function StudentsOperationsPage() {
    const { profile } = useAuth();
    const academyId = academyIdOf(profile?.current_academy_id);
    const [students, setStudents] = useState<StudentSummary[]>([]);
    const [classes, setClasses] = useState<ClassSummary[]>([]);
    const [permissions, setPermissions] = useState<StudentOperationsPermissions>(emptyPermissions);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [hasExternalUpdate, setHasExternalUpdate] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [sectionLoading, setSectionLoading] = useState<Partial<Record<StudentDetailSection, boolean>>>({});
    const [error, setError] = useState('');
    const [selectedStudentId, setSelectedStudentId] = useState('');
    const [detail, setDetail] = useState<StudentDetail | null>(null);
    const [activeTab, setActiveTab] = useState('learning');
    const [learningPeriod, setLearningPeriod] = useState<StudentLearningPeriod>('90d');
    const [selectedLearningAssignmentId, setSelectedLearningAssignmentId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [classFilter, setClassFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState<StudentFilterStatus>('operations');
    const [sortMode, setSortMode] = useState<StudentSortMode>('risk');
    const [formMode, setFormMode] = useState<FormMode>(null);
    const [submitting, setSubmitting] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
    const [hardDeletePreview, setHardDeletePreview] = useState<StudentHardDeletePreview | null>(null);
    const [hardDeleteConfirmName, setHardDeleteConfirmName] = useState('');
    const [hardDeletePasswordOpen, setHardDeletePasswordOpen] = useState(false);
    const [createdInvitation, setCreatedInvitation] = useState<CreateStudentResult | null>(null);
    const [issuingInvitation, setIssuingInvitation] = useState(false);

    const [editingStudentId, setEditingStudentId] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [parentName, setParentName] = useState('');
    const [parentPhone, setParentPhone] = useState('');
    const [grade, setGrade] = useState('');
    const [studentStatus, setStudentStatus] = useState<StudentStatus>('active');
    const [billingMode, setBillingMode] = useState<BillingMode>('monthly_plus_classes');
    const [baseFee, setBaseFee] = useState('0');
    const [hourlyRate, setHourlyRate] = useState('');
    const [extraClassFee, setExtraClassFee] = useState('0');
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());

    const resetStudentForm = useCallback(() => {
        setEditingStudentId('');
        setName('');
        setPhone('');
        setParentName('');
        setParentPhone('');
        setGrade('');
        setStudentStatus('active');
        setBillingMode('monthly_plus_classes');
        setBaseFee('0');
        setHourlyRate('');
        setExtraClassFee('0');
        setSelectedClassIds(new Set());
        setFormMode(null);
    }, []);

    const mergeLearningMetrics = useCallback((metrics: StudentLearningMetric[]) => {
        if (metrics.length === 0) return;
        const metricsByStudent = new Map(metrics.map((row) => [row.studentId, row]));
        setStudents((current) => current.map((student) => {
            const metric = metricsByStudent.get(student.id);
            if (!metric) return student;
            return {
                ...student,
                weakTypeCount: metric.weakTypeCount,
                avgTypeScore: metric.avgTypeScore,
                lastLearningAt: metric.lastLearningAt,
                learningMetricsLoaded: true,
            };
        }));
    }, []);

    const loadMetrics = useCallback(async (studentIds: string[], options: StudentPageLoadOptions = {}) => {
        if (!academyId || studentIds.length === 0) return;
        if (!options.background) setMetricsLoading(true);
        try {
            const metrics = await loadStudentLearningMetrics(academyId, studentIds, { force: options.force });
            mergeLearningMetrics(metrics);
        } catch (err) {
            console.warn('[Students] Failed to load learning metrics:', err);
        } finally {
            if (!options.background) setMetricsLoading(false);
        }
    }, [academyId, mergeLearningMetrics]);

    const load = useCallback(async (options: StudentPageLoadOptions = {}) => {
        if (!academyId) return;
        if (options.background) setRefreshing(true);
        else setLoading(true);
        setError('');
        try {
            const data = await loadStudentOperationsOverview(academyId, { force: options.force });
            setStudents(data.students);
            setClasses(data.classes);
            setPermissions(data.permissions);
            setSelectedStudentId((current) => {
                if (current && data.students.some((student) => student.id === current)) return current;
                return '';
            });
            setHasExternalUpdate(false);
            void loadMetrics(data.students.map((student) => student.id), options);
        } catch (err) {
            const message = err instanceof Error ? err.message : '학생 정보를 불러오지 못했습니다.';
            setError(message);
            toast.error(message);
        } finally {
            if (options.background) setRefreshing(false);
            else setLoading(false);
        }
    }, [academyId, loadMetrics]);

    const loadDetail = useCallback(async (
        studentId: string,
        section: StudentDetailSection = 'learning',
        options: StudentDetailLoadOptions = {},
    ) => {
        if (!academyId || !studentId) {
            setDetail(null);
            return;
        }
        if (!options.background) {
            if (options.replace) setDetailLoading(true);
            else setSectionLoading((current) => ({ ...current, [section]: true }));
        }
        try {
            const data = await loadStudentDetail(academyId, studentId, section, {
                force: options.force,
                period: section === 'learning' || section === 'full' ? options.period || '90d' : undefined,
                assignmentId: section === 'learning' || section === 'full' ? options.assignmentId || null : undefined,
            });
            setDetail((current) => options.replace ? data : mergeStudentDetail(current, data));
            if (data.hardDeletePreview) setHardDeletePreview(data.hardDeletePreview);
        } catch (err) {
            const message = err instanceof Error ? err.message : '학생 상세 정보를 불러오지 못했습니다.';
            toast.error(message);
            if (options.replace) setDetail(null);
        } finally {
            if (!options.background) {
                if (options.replace) setDetailLoading(false);
                else setSectionLoading((current) => ({ ...current, [section]: false }));
            }
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
            if (!['students', 'classes', 'accounting', 'assignments', 'learning', 'ai', 'reports', 'lms', 'admin'].includes(domain)) return;

            if (formMode || submitting) {
                setHasExternalUpdate(true);
                return;
            }

            void load({ force: true, background: true });
            const section = DETAIL_SECTION_BY_TAB[activeTab] || 'learning';
            const studentMatches = !payload.studentId || payload.studentId === selectedStudentId;
            if (selectedStudentId && studentMatches && section !== 'management') {
                void loadDetail(selectedStudentId, section, {
                    force: true,
                    background: true,
                    period: learningPeriod,
                    assignmentId: selectedLearningAssignmentId,
                });
            }
        });
    }, [academyId, activeTab, formMode, learningPeriod, load, loadDetail, selectedLearningAssignmentId, selectedStudentId, submitting]);

    useEffect(() => {
        if (!selectedStudentId) {
            setDetail(null);
            setHardDeletePreview(null);
            return;
        }
        setActiveTab('learning');
        setLearningPeriod('90d');
        setSelectedLearningAssignmentId(null);
        setSectionLoading({});
        setHardDeletePreview(null);
        resetStudentForm();
        void loadDetail(selectedStudentId, 'learning', { replace: true, period: '90d', assignmentId: null });
    }, [loadDetail, resetStudentForm, selectedStudentId]);

    const handleTabChange = useCallback((tab: string) => {
        setActiveTab(tab);
        const section = DETAIL_SECTION_BY_TAB[tab];
        if (!section || section === 'management' || !selectedStudentId || hasLoadedSection(detail, section)) return;
        void loadDetail(selectedStudentId, section, { period: learningPeriod, assignmentId: selectedLearningAssignmentId });
    }, [detail, learningPeriod, loadDetail, selectedLearningAssignmentId, selectedStudentId]);

    const changeLearningPeriod = useCallback((nextPeriod: StudentLearningPeriod) => {
        setLearningPeriod(nextPeriod);
        if (selectedStudentId) {
            void loadDetail(selectedStudentId, 'learning', {
                force: true,
                period: nextPeriod,
                assignmentId: selectedLearningAssignmentId,
            });
        }
    }, [loadDetail, selectedLearningAssignmentId, selectedStudentId]);

    const changeLearningAssignment = useCallback((assignmentId: string | null) => {
        setSelectedLearningAssignmentId(assignmentId);
        if (selectedStudentId) {
            void loadDetail(selectedStudentId, 'learning', {
                force: true,
                period: learningPeriod,
                assignmentId,
            });
        }
    }, [learningPeriod, loadDetail, selectedStudentId]);

    const filteredStudents = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const filtered = students.filter((student) => {
            const matchesQuery = !query
                || student.name.toLowerCase().includes(query)
                || (student.phone || '').includes(query)
                || (student.parentPhone || '').includes(query);
            const matchesClass = classFilter === 'all' || student.classIds.includes(classFilter);
            const matchesStatus = statusFilter === 'all'
                ? true
                : statusFilter === 'operations'
                    ? student.status !== 'dropped'
                    : student.status === statusFilter;
            return matchesQuery && matchesClass && matchesStatus;
        });
        return sortStudents(filtered, sortMode);
    }, [classFilter, searchQuery, sortMode, statusFilter, students]);

    const selectedStudent = useMemo(
        () => students.find((student) => student.id === selectedStudentId) || null,
        [selectedStudentId, students],
    );

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

    const startCreate = () => {
        setSelectedStudentId('');
        setDetail(null);
        resetStudentForm();
        setFormMode('create');
        setActiveTab('manage');
    };

    const startEdit = () => {
        const student = detail?.summary || selectedStudent;
        if (!student) return;
        setEditingStudentId(student.id);
        setName(student.name);
        setPhone(student.phone || '');
        setParentName(student.parentName || '');
        setParentPhone(student.parentPhone || '');
        setGrade(student.grade || '');
        setStudentStatus(student.status);
        setBillingMode(student.billingMode || 'monthly_plus_classes');
        setBaseFee(String(student.baseMonthlyFee || 0));
        setHourlyRate(student.hourlyRate === null ? '' : String(student.hourlyRate));
        setExtraClassFee(String(student.extraClassFee || 0));
        setSelectedClassIds(new Set(student.classIds));
        setFormMode('edit');
    };

    const toggleClass = (classId: string) => {
        setSelectedClassIds((prev) => {
            const next = new Set(prev);
            if (next.has(classId)) next.delete(classId);
            else next.add(classId);
            return next;
        });
    };

    const copyInviteCode = async (code: string | null | undefined) => {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            toast.success('가입 코드를 복사했습니다.');
        } catch {
            toast.error('가입 코드 복사에 실패했습니다.');
        }
    };

    const issueInvitationForDetail = async () => {
        if (!academyId || !detail) return;
        setIssuingInvitation(true);
        try {
            const invitation = await issueStudentInvitation(academyId, detail.summary.id);
            setDetail((current) => current && current.summary.id === detail.summary.id
                ? { ...current, signupInvitation: invitation, hasGradeAppAccount: false }
                : current);
            setCreatedInvitation({
                studentId: detail.summary.id,
                studentName: detail.summary.name,
                invitation,
            });
            toast.success('가입 코드를 발행했습니다.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '가입 코드 발행에 실패했습니다.');
        } finally {
            setIssuingInvitation(false);
        }
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!academyId || !permissions.canEdit && formMode === 'edit' || !permissions.canCreate && formMode === 'create') return;

        const classIds = [...selectedClassIds];
        const classBillingRules = classIds.map((classId, index) => {
            if (billingMode === 'usage_based') {
                return { classId, ruleType: 'usage_based' as const, amount: Number(hourlyRate) || 0 };
            }
            return {
                classId,
                ruleType: index === 0 || billingMode === 'manual' ? 'included' as const : 'extra_flat' as const,
                amount: index === 0 || billingMode === 'manual' ? 0 : Number(extraClassFee) || 0,
            };
        });

        setSubmitting(true);
        try {
            const payload = {
                name,
                phone,
                parentName,
                parentPhone,
                grade,
                classIds,
                classBillingRules,
                billingMode,
                baseMonthlyFee: Number(baseFee) || 0,
                hourlyRate: hourlyRate ? Number(hourlyRate) : null,
            };
            if (editingStudentId) {
                await updateStudent(academyId, editingStudentId, { ...payload, status: studentStatus });
                toast.success('학생 정보를 수정했습니다.');
                setSelectedStudentId(editingStudentId);
            } else {
                const result = await createStudent(academyId, payload);
                setCreatedInvitation(result);
                toast.success('학생을 등록하고 가입 코드를 발행했습니다.');
            }
            resetStudentForm();
            await load({ force: true });
            if (editingStudentId) {
                await loadDetail(editingStudentId, 'learning', {
                    replace: true,
                    force: true,
                    period: learningPeriod,
                    assignmentId: selectedLearningAssignmentId,
                });
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '학생 저장에 실패했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const executeArchive = async () => {
        if (!academyId || !selectedStudentId) return;
        try {
            await archiveStudent(academyId, selectedStudentId);
            toast.success('학생을 퇴원/보관 처리했습니다.');
            setArchiveOpen(false);
            resetStudentForm();
            await load({ force: true });
            setSelectedStudentId('');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '퇴원/보관 처리에 실패했습니다.');
        }
    };

    const openHardDelete = async () => {
        if (!academyId || !selectedStudentId) return;
        setHardDeleteOpen(true);
        setHardDeleteConfirmName('');
        setHardDeletePreview(null);
        try {
            const preview = await previewHardDeleteStudent(academyId, selectedStudentId);
            setHardDeletePreview(preview);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '완전삭제 가능 여부를 확인하지 못했습니다.');
        }
    };

    const executeHardDelete = async () => {
        if (!academyId || !selectedStudentId) return;
        try {
            await hardDeleteStudent(academyId, selectedStudentId, hardDeleteConfirmName);
            toast.success('오등록 학생을 완전삭제했습니다.');
            setHardDeletePasswordOpen(false);
            setHardDeleteOpen(false);
            setSelectedStudentId('');
            setDetail(null);
            await load({ force: true });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '완전삭제에 실패했습니다.');
        }
    };

    const formProps = {
        name,
        phone,
        parentName,
        parentPhone,
        grade,
        status: studentStatus,
        billingMode,
        baseFee,
        hourlyRate,
        extraClassFee,
        selectedClassIds,
        submitting,
        onName: setName,
        onPhone: setPhone,
        onParentName: setParentName,
        onParentPhone: setParentPhone,
        onGrade: setGrade,
        onStatus: setStudentStatus,
        onBillingMode: setBillingMode,
        onBaseFee: setBaseFee,
        onHourlyRate: setHourlyRate,
        onExtraClassFee: setExtraClassFee,
        onToggleClass: toggleClass,
        onCancel: resetStudentForm,
        onSubmit: submit,
    };

    return (
        <PageShell
            title="학생"
            description="학습분석, 출결, 연락처, 청구 계약을 한 화면에서 관리합니다."
            icon={GraduationCap}
            actions={permissions.canCreate ? (
                <Button type="button" onClick={startCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    학생 등록
                </Button>
            ) : undefined}
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
                    입력 중 새 데이터가 들어왔습니다.
                </PageStatusBar>
            )}
            {loading && <SkeletonPage />}
            {!loading && error && (
                <ErrorState title={error} retryLabel="다시 시도" onRetry={() => void load({ force: true })} />
            )}
            {!loading && !error && (
                <div className="grid min-h-[620px] gap-5 xl:grid-cols-[0.9fr_1.5fr]">
                    <Card className="overflow-hidden">
                        <CardHeader className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <CardTitle>학생 목록</CardTitle>
                                {permissions.scopedToAssignedClasses && (
                                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">담당 반만</span>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input className="pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="이름, 학생/보호자 연락처 검색" />
                                </div>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    <Select value={classFilter} onValueChange={setClassFilter}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">전체 반</SelectItem>
                                            {classes.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StudentFilterStatus)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="operations">운영 학생</SelectItem>
                                            <SelectItem value="all">전체 상태</SelectItem>
                                            <SelectItem value="active">재원</SelectItem>
                                            <SelectItem value="on_leave">휴원</SelectItem>
                                            <SelectItem value="inactive">중지</SelectItem>
                                            <SelectItem value="graduated">졸업</SelectItem>
                                            <SelectItem value="dropped">퇴원/보관</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={sortMode} onValueChange={(value) => setSortMode(value as StudentSortMode)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="risk">위험도순</SelectItem>
                                            <SelectItem value="recent">최근 학습순</SelectItem>
                                            <SelectItem value="name">이름순</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <StudentList
                                students={filteredStudents}
                                selectedStudentId={selectedStudentId}
                                metricsLoading={metricsLoading}
                                onSelect={(student) => setSelectedStudentId(student.id)}
                            />
                        </CardContent>
                    </Card>

                    {formMode === 'create' && permissions.canCreate ? (
                        <Card>
                            <CardHeader><CardTitle>학생 등록</CardTitle></CardHeader>
                            <CardContent>
                                <StudentForm {...formProps} mode="create" classes={classes} />
                            </CardContent>
                        </Card>
                    ) : detailLoading ? (
                        <StudentDetailSkeleton />
                    ) : detail ? (
                        <Card className="overflow-hidden">
                            <CardHeader className="border-b">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <CardTitle>{detail.summary.name}</CardTitle>
                                            <StudentStatusBadge status={detail.summary.status} />
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {detail.summary.classNames.join(', ') || '배정 반 없음'} · {detail.summary.phone || '학생 연락처 없음'} · 보호자 {detail.summary.parentPhone || '-'}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <div className="rounded-xl bg-muted px-3 py-2 text-right text-xs">
                                            <p className="text-muted-foreground">취약/주의</p>
                                            <p className="font-semibold text-foreground">{detail.summary.weakTypeCount || 0}개</p>
                                        </div>
                                        <div className="rounded-xl bg-muted px-3 py-2 text-right text-xs">
                                            <p className="text-muted-foreground">최근 학습</p>
                                            <p className="font-semibold text-foreground">{shortDate(detail.summary.lastLearningAt)}</p>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-4">
                                <Tabs value={activeTab} onValueChange={handleTabChange} variant="underline">
                                    <TabsList className="flex h-auto w-full flex-wrap justify-start overflow-x-auto">
                                        <TabsTrigger value="learning"><BarChart3 className="mr-2 h-4 w-4" />학습분석</TabsTrigger>
                                        <TabsTrigger value="profile"><UserRound className="mr-2 h-4 w-4" />프로필</TabsTrigger>
                                        <TabsTrigger value="attendance"><CalendarDays className="mr-2 h-4 w-4" />출결</TabsTrigger>
                                        {detail.permissions.canViewBilling && <TabsTrigger value="billing"><CreditCard className="mr-2 h-4 w-4" />청구</TabsTrigger>}
                                        {(detail.permissions.canEdit || detail.permissions.canArchive || detail.permissions.canHardDelete) && (
                                            <TabsTrigger value="manage"><ShieldAlert className="mr-2 h-4 w-4" />관리</TabsTrigger>
                                        )}
                                    </TabsList>
                                    <TabsContent value="learning">
                                        {sectionLoading.learning ? (
                                            <StudentTabSkeleton />
                                        ) : (
                                            <LearningTab
                                                detail={detail}
                                                period={learningPeriod}
                                                selectedAssignmentId={selectedLearningAssignmentId}
                                                onPeriodChange={changeLearningPeriod}
                                                onAssignmentChange={changeLearningAssignment}
                                            />
                                        )}
                                    </TabsContent>
                                    <TabsContent value="profile">
                                        <ProfileTab
                                            student={detail.summary}
                                            canEdit={detail.permissions.canEdit}
                                            classes={classes}
                                            formMode={formMode}
                                            formProps={formProps}
                                            onStartEdit={startEdit}
                                        />
                                    </TabsContent>
                                    <TabsContent value="attendance">{sectionLoading.attendance ? <StudentTabSkeleton /> : <AttendanceTab detail={detail} />}</TabsContent>
                                    {detail.permissions.canViewBilling && (
                                        <TabsContent value="billing">
                                            {sectionLoading.billing ? <StudentTabSkeleton /> : <BillingTab detail={detail} />}
                                        </TabsContent>
                                    )}
                                    {(detail.permissions.canEdit || detail.permissions.canArchive || detail.permissions.canHardDelete) && (
                                        <TabsContent value="manage">
                                            <ManagementTab
                                                detail={detail}
                                                classes={classes}
                                                formMode={formMode}
                                                formProps={formProps}
                                                onStartEdit={startEdit}
                                                onArchive={() => setArchiveOpen(true)}
                                                onHardDelete={openHardDelete}
                                                onCopyInviteCode={(code) => void copyInviteCode(code)}
                                                onIssueInvitation={() => void issueInvitationForDetail()}
                                                issuingInvitation={issuingInvitation}
                                            />
                                        </TabsContent>
                                    )}
                                </Tabs>
                            </CardContent>
                        </Card>
                    ) : (
                        <EmptyDetail canCreate={permissions.canCreate} onCreate={startCreate} />
                    )}
                </div>
            )}

            <Dialog open={Boolean(createdInvitation)} onOpenChange={(open) => {
                if (!open) setCreatedInvitation(null);
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Grade app 가입 코드</DialogTitle>
                        <DialogDescription>
                            {createdInvitation?.studentName || '학생'} 학생에게 전달할 일회용 가입 코드입니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="rounded-xl border bg-muted p-4">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">가입 코드</p>
                            <div className="mt-2 flex items-center justify-between gap-3">
                                <code className="select-all break-all text-2xl font-semibold tracking-[0.2em] text-foreground">
                                    {createdInvitation?.invitation.inviteCode || '-'}
                                </code>
                                <Button type="button" variant="outline" size="sm" onClick={() => void copyInviteCode(createdInvitation?.invitation.inviteCode)}>
                                    <Copy className="mr-2 h-4 w-4" />
                                    복사
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-2 text-sm text-muted-foreground">
                            <div className="flex items-center justify-between gap-3">
                                <span>학생</span>
                                <strong className="text-foreground">{createdInvitation?.studentName || '-'}</strong>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span>만료일</span>
                                <strong className="text-foreground">{shortDate(createdInvitation?.invitation.expiresAt)}</strong>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" onClick={() => setCreatedInvitation(null)}>확인</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>퇴원/보관 처리</DialogTitle>
                        <DialogDescription>
                            {detail?.summary.name || selectedStudent?.name} 학생을 운영 목록에서 숨기고 반 배정, 청구 계약, 학생 멤버십을 종료합니다. 회계, 출결, 학습, AI 이력은 유지됩니다.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setArchiveOpen(false)}>취소</Button>
                        <Button type="button" variant="destructive" onClick={() => void executeArchive()}>퇴원/보관 처리</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={hardDeleteOpen} onOpenChange={setHardDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>오등록 완전삭제</DialogTitle>
                        <DialogDescription>
                            이 기능은 이력이 없는 오등록 학생만 삭제합니다. 이력이 있는 학생은 퇴원/보관만 가능합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="rounded-xl border bg-muted p-3 text-sm">
                            <p className="font-medium text-foreground">{hardDeletePreview?.studentName || detail?.summary.name || '-'}</p>
                            {hardDeletePreview ? (
                                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                                    {hardDeletePreview.blockers.filter((row) => row.count > 0).map((row) => (
                                        <div key={row.key} className="flex justify-between gap-3">
                                            <span>{row.label}</span>
                                            <strong>{row.count.toLocaleString()}건</strong>
                                        </div>
                                    ))}
                                    {hardDeletePreview.canHardDelete && <p className="text-success-foreground">차단 이력이 없어 완전삭제할 수 있습니다.</p>}
                                    {!hardDeletePreview.canHardDelete && <p className="text-destructive">이력이 있어 완전삭제가 차단됩니다.</p>}
                                </div>
                            ) : (
                                <p className="mt-2 text-xs text-muted-foreground">가능 여부를 확인하는 중입니다.</p>
                            )}
                        </div>
                        <div>
                            <Label>학생 이름 확인</Label>
                            <Input value={hardDeleteConfirmName} onChange={(event) => setHardDeleteConfirmName(event.target.value)} placeholder={hardDeletePreview?.studentName || detail?.summary.name || ''} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setHardDeleteOpen(false)}>취소</Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={!hardDeletePreview?.canHardDelete || hardDeleteConfirmName.trim() !== hardDeletePreview.studentName}
                            onClick={() => setHardDeletePasswordOpen(true)}
                        >
                            비밀번호 확인
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PasswordConfirmDialog
                open={hardDeletePasswordOpen}
                onOpenChange={setHardDeletePasswordOpen}
                title="완전삭제 확인"
                description="오등록 학생과 연결된 임시 데이터가 삭제됩니다. 과거 이력이 있는 학생은 서버에서 다시 차단됩니다."
                confirmLabel="완전삭제"
                onConfirm={executeHardDelete}
            />
        </PageShell>
    );
}
