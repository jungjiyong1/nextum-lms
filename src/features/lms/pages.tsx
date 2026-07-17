'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  House,
  ReceiptText,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { PasswordConfirmDialog } from '@/components/security/PasswordConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell } from '@/components/ui/page-shell';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton, SkeletonPanel } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/state';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  addLmsInvalidationListener,
  exportAdminCsv,
  generateMonthlyInvoices,
  getDashboardData,
  loadAccountingTaxSettings,
  loadExpenseOperationsOverview,
  loadInstructorPayrollOperationsOverview,
  loadStudentPaymentOperationsOverview,
  prepareAdminReset,
  recordPayment,
  resetAdminData,
  updateTaxSettings,
  createExpense,
  createInstructorPayment,
  upsertInstructorPayRate,
} from './service';
import { calculatePayrollDraft } from './payroll';
import { accountingHref, accountingMonthRange, type AccountingSection } from './accounting-month';
import { QuickActionSparkIcon } from './home/quick-action-spark-icon';
import type {
  AdminExportType,
  AdminResetTarget,
  BillingMode,
  BillingRow,
  DashboardData,
  ExpenseRow,
  InstructorPaymentRow,
  InstructorPayrollEstimate,
  PaymentRow,
  StaffSummary,
  WithholdingType,
} from './types';

type LmsPageLoadOptions = { force?: boolean; background?: boolean };

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function currency(value: number | null | undefined): string {
  return `${Math.round(value || 0).toLocaleString()}원`;
}

function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function hoursLabel(minutes: number): string {
  return `${hoursFromMinutes(minutes).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}시간`;
}

function academyIdOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function useAcademyId() {
  const { profile } = useAuth();
  return academyIdOf(profile?.current_academy_id);
}

function billingModeLabel(mode: BillingMode | null): string {
  if (mode === 'monthly_plus_classes') return '월 기본료 + 추가반';
  if (mode === 'usage_based') return '시간제';
  if (mode === 'manual') return '수동 청구';
  return '-';
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function LoadingBlock() {
  return <SkeletonPanel className="min-h-[320px]" rows={6} />;
}

function MissingAcademy() {
  return (
    <div className="mx-auto flex h-full max-w-xl items-center justify-center p-8">
      <Card>
        <CardHeader>
          <CardTitle>학원 연결이 필요합니다</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          현재 계정에 연결된 academy가 없습니다. 개발 환경에서는 `npm run seed:dev-admin`으로 관리자 계정을 먼저 생성하세요.
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <ErrorState title="데이터를 불러오지 못했습니다" description={message} retryLabel="다시 시도" onRetry={onRetry} />;
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return <StatCard label={label} value={value} hint={hint} icon={Icon} />;
}

function monthFromDate(value: string): string {
  return value.slice(0, 7);
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${value}T00:00:00`));
}

function completionTone(value: number, hasAssignments: boolean): 'neutral' | 'success' | 'warning' | 'danger' | 'primary' {
  if (!hasAssignments) return 'neutral';
  if (value >= 80) return 'success';
  if (value >= 50) return 'warning';
  return 'danger';
}

function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' }) {
  const toneClass = {
    neutral: 'bg-muted-foreground/35',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-destructive',
    primary: 'bg-primary',
  }[tone];
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="flex items-center justify-between border-b px-[22px] py-[18px]">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 border-t px-5 py-4 first:border-t-0">
              <Skeleton className="h-8 w-32 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-9 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border bg-card p-[22px] shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="space-y-2.5">
            <Skeleton className="h-[72px] w-full rounded-xl" />
            <Skeleton className="h-[72px] w-full rounded-xl" />
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-5 w-24" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex h-[111px] flex-col items-center justify-center gap-2 rounded-xl border bg-card">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-card">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-4 h-11 w-full" />
          <Skeleton className="mt-3 h-9 w-full" />
          <Skeleton className="mt-2 h-9 w-full" />
        </div>
      </div>
    </div>
  );
}

type HomeClassRowData = DashboardData['classes'][number];

interface HomeLearningStudentSummary {
  studentId: string;
  studentName: string;
  missingAssignmentCount: number;
  weakTypeCount: number;
  assignmentTitles: string[];
  weakTypeNames: string[];
  priorityScore: number;
}

function collectHomeLearningStudents(classes: DashboardData['classes']): HomeLearningStudentSummary[] {
  const byStudent = new Map<string, HomeLearningStudentSummary>();

  classes.forEach((classRow) => {
    classRow.actionStudents.forEach((student) => {
      const current = byStudent.get(student.studentId) || {
        studentId: student.studentId,
        studentName: student.studentName,
        missingAssignmentCount: 0,
        weakTypeCount: 0,
        assignmentTitles: [],
        weakTypeNames: [],
        priorityScore: 0,
      };

      current.missingAssignmentCount = Math.max(current.missingAssignmentCount, student.missingAssignmentCount);
      current.weakTypeCount = Math.max(current.weakTypeCount, student.weakTypeCount);
      current.assignmentTitles = Array.from(new Set([...current.assignmentTitles, ...student.assignmentTitles]));
      current.weakTypeNames = Array.from(new Set([
        ...current.weakTypeNames,
        ...student.weakTypes.map((weakType) => weakType.typeName),
      ]));
      current.priorityScore = Math.max(current.priorityScore, student.priorityScore);
      byStudent.set(student.studentId, current);
    });
  });

  return Array.from(byStudent.values()).sort((left, right) => (
    right.priorityScore - left.priorityScore
    || left.studentName.localeCompare(right.studentName, 'ko-KR')
  ));
}

function summarizeStudentNames(students: HomeLearningStudentSummary[]): string {
  if (students.length === 0) return '';
  return students.length === 1
    ? students[0].studentName
    : `${students[0].studentName} 외 ${students.length - 1}명`;
}

function summarizeItems(items: string[], fallback: string): string {
  const uniqueItems = Array.from(new Set(items.filter(Boolean)));
  if (uniqueItems.length === 0) return fallback;
  return uniqueItems.length === 1
    ? uniqueItems[0]
    : `${uniqueItems[0]} 외 ${uniqueItems.length - 1}개`;
}

function firstLessonStart(classes: DashboardData['classes']): string | null {
  const starts = classes.flatMap((classRow) => classRow.lessons.map((lesson) => lesson.startTime));
  return starts.sort((left, right) => left.localeCompare(right))[0] || null;
}

function lessonTimeText(classRow: HomeClassRowData): string {
  if (classRow.lessons.length === 0) return '수업 시간 없음';
  return classRow.lessons
    .map((lesson) => `${lesson.startTime}-${lesson.endTime}`)
    .join(', ');
}

function HomeClassRow({ classRow, date }: { classRow: HomeClassRowData; date: string }) {
  const progress = classRow.assignmentProgress;
  const hasAssignments = progress.assignmentCount > 0;
  const tone = completionTone(progress.completionRate, hasAssignments);
  const details = [
    classRow.instructorName ? `강사 ${classRow.instructorName}` : null,
    classRow.classroomName,
    `${classRow.studentCount}명`,
  ].filter((detail): detail is string => Boolean(detail));

  return (
    <div className="flex flex-col gap-3 border-t px-5 py-[13px] first:border-t-0 md:flex-row md:items-center md:gap-3.5">
      <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-sm font-bold tabular-nums text-primary-strong">
        <Clock className="h-[15px] w-[15px]" />
        {lessonTimeText(classRow)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="truncate text-[15px] font-bold text-foreground">{classRow.className}</strong>
          {classRow.grade && <StatusBadge tone="neutral" icon={false} label={classRow.grade} />}
        </div>
        <p className="mt-[3px] truncate text-[13px] text-muted-foreground">
          {details.map((detail, index) => (
            <React.Fragment key={detail}>
              {index > 0 && ' · '}
              {index === 0 && classRow.instructorName ? (
                <>강사 <strong className="font-semibold text-foreground">{classRow.instructorName}</strong></>
              ) : detail}
            </React.Fragment>
          ))}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1.5 md:items-end">
        <span className="text-xs text-muted-foreground">
          {hasAssignments ? (
            <>과제 <strong className="font-bold tabular-nums text-foreground">{progress.completedCount}/{progress.targetStudentCount}</strong></>
          ) : '과제 없음'}
        </span>
        <span className="block w-[90px]">
          <ProgressBar value={progress.completionRate} tone={tone} />
        </span>
      </div>
      <Button asChild variant="outline" size="sm" className="w-full shrink-0 md:w-auto">
        <Link href={`/classrooms/attendance?classId=${encodeURIComponent(classRow.classId)}&date=${encodeURIComponent(date)}`}>
          출결
        </Link>
      </Button>
    </div>
  );
}

function LearningTaskRow({
  tone,
  icon: Icon,
  title,
  description,
  cta,
  href,
}: {
  tone: 'danger' | 'warning';
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cta: string;
  href: string;
}) {
  const iconTone = tone === 'danger'
    ? 'bg-destructive-soft text-destructive'
    : 'bg-warning-soft text-warning-foreground';

  return (
    <Link
      href={href}
      className="flex w-full items-center gap-3.5 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/50 hover:bg-muted focus-visible:border-primary/50 focus-visible:bg-muted focus-visible:outline-none"
    >
      <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
        <Icon className="h-[21px] w-[21px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-bold text-primary-strong">
        {cta}
        <ChevronRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

type HomeQuickActionIconName = 'clipboard' | 'grid' | 'megaphone' | 'calendar';

function HomeQuickActionIcon({ name }: { name: HomeQuickActionIconName }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'clipboard' && (
        <>
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M12 11h4" />
          <path d="M12 16h4" />
          <path d="M8 11h.01" />
          <path d="M8 16h.01" />
        </>
      )}
      {name === 'grid' && (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </>
      )}
      {name === 'megaphone' && (
        <>
          <path d="m3 11 18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </>
      )}
      {name === 'calendar' && (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
        </>
      )}
    </svg>
  );
}

function QuickAction({
  icon,
  label,
  href,
}: {
  icon: HomeQuickActionIconName;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-[9px] rounded-[14px] border bg-card px-2.5 py-[18px] text-center shadow-card transition-colors hover:border-primary/50 hover:bg-muted focus-visible:border-primary/50 focus-visible:bg-muted focus-visible:outline-none"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <HomeQuickActionIcon name={icon} />
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </Link>
  );
}

function AdminAlertsPanel({
  alerts,
  serviceMonth,
}: {
  alerts: DashboardData['adminAlerts'];
  serviceMonth: string;
}) {
  if (!alerts || alerts.unpaidBillingCount === 0) {
    return (
      <Card id="admin-alerts" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="text-base">관리자 알림</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" />
          이번 달 미납/미발행 알림이 없습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="admin-alerts" className="scroll-mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">관리자 알림</CardTitle>
          <StatusBadge tone="warning" label={`${alerts.unpaidBillingCount}건`} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-lg bg-warning-soft p-3 text-sm text-warning-foreground">
          미납/미발행 합계 {currency(alerts.unpaidBillingAmount)}
        </div>
        {alerts.unpaidBillingStudents.map((student) => (
          <div key={student.studentId} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
            <span className="truncate font-medium">{student.studentName}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{currency(student.amount)}</span>
          </div>
        ))}
        <Button asChild variant="outline" size="sm">
          <Link href={`/accounting/payments?month=${encodeURIComponent(serviceMonth)}`}>회계에서 확인</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function LearningHomePage() {
  const academyId = useAcademyId();
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serviceMonth = monthFromDate(selectedDate);
  const homeView = useMemo(() => {
    const classes = data?.classes || [];
    const learningStudents = collectHomeLearningStudents(classes);
    const missingAssignmentStudents = learningStudents.filter((student) => student.missingAssignmentCount > 0);
    const weakTypeStudents = learningStudents.filter((student) => student.weakTypeCount > 0);
    const managedStudentIds = new Set([
      ...missingAssignmentStudents.map((student) => student.studentId),
      ...weakTypeStudents.map((student) => student.studentId),
    ]);

    return {
      firstLessonStart: firstLessonStart(classes),
      missingAssignmentStudents,
      weakTypeStudents,
      managedStudentCount: managedStudentIds.size,
    };
  }, [data]);

  const load = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId) return;
    if (options.background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await getDashboardData(academyId, selectedDate, serviceMonth, { force: options.force }));
    } catch (err) {
      const message = err instanceof Error ? err.message : '홈 대시보드를 불러오지 못했습니다.';
      setError(message);
    } finally {
      if (options.background) setRefreshing(false);
      else setLoading(false);
    }
  }, [academyId, selectedDate, serviceMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!academyId) return undefined;
    return addLmsInvalidationListener((payload) => {
      if (payload.academyId && payload.academyId !== academyId) return;
      const domain = payload.domain || 'lms';
      if (!['students', 'classes', 'accounting', 'assignments', 'learning', 'ai', 'lms', 'admin'].includes(domain)) return;
      void load({ force: true, background: true });
    });
  }, [academyId, load]);

  if (!academyId) return <MissingAcademy />;

  return (
    <PageShell
      title="홈"
      subtitle={data
        ? `${formatShortDate(data.date)} · 수업 ${data.summary.todayLessonCount}회 · ${data.summary.todayClassCount}개 반`
        : formatShortDate(selectedDate)}
      icon={House}
      action={
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            aria-label="홈 기준 날짜"
            onChange={(event) => setSelectedDate(event.target.value || today())}
            className="w-[150px]"
          />
          <Button variant="outline" onClick={() => setSelectedDate(today())}>
            오늘
          </Button>
          <Button
            variant="outline"
            disabled={loading || refreshing}
            onClick={() => void load({ force: true, background: Boolean(data) })}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
        </div>
      }
    >
      {!loading && refreshing && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          최신 데이터 동기화 중
        </div>
      )}
      {loading && <DashboardSkeleton />}
      {error && !loading && <ErrorBlock message={error} onRetry={() => void load({ force: true })} />}
      {data && !loading && !error && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-6">
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-[19px] w-[19px] text-primary" />
                    <CardTitle className="text-[17px]">오늘 수업</CardTitle>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {data.summary.todayClassCount}개 반 · 첫 수업 {homeView.firstLessonStart || '-'}
                  </span>
                </div>
              </CardHeader>
              <div className="pb-1.5">
                {data.classes.length > 0 ? (
                  data.classes.map((classRow) => (
                    <HomeClassRow key={classRow.classId} classRow={classRow} date={data.date} />
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-3 border-t px-5 py-8 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <CalendarDays className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">예정된 수업이 없습니다</p>
                      <p className="mt-1 text-xs text-muted-foreground">날짜를 바꾸거나 시간표에서 수업 일정을 확인하세요.</p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/classrooms/schedule">시간표 보기</Link>
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-[22px]">
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-[19px] w-[19px] text-primary" />
                  <h2 className="text-[17px] font-extrabold text-foreground">학습 관리</h2>
                </div>
                <span className="text-sm text-muted-foreground">관리 필요 {homeView.managedStudentCount}명</span>
              </div>
              {homeView.managedStudentCount > 0 ? (
                <div className="flex flex-col gap-2.5">
                  {homeView.missingAssignmentStudents.length > 0 && (
                    <LearningTaskRow
                      tone="danger"
                      icon={AlertTriangle}
                      title={`미완료 과제 확인 ${homeView.missingAssignmentStudents.length}명`}
                      description={`${summarizeStudentNames(homeView.missingAssignmentStudents)} · ${summarizeItems(
                        homeView.missingAssignmentStudents.flatMap((student) => student.assignmentTitles),
                        '미완료 과제 확인 필요',
                      )}`}
                      cta="과제 확인"
                      href="/assignments"
                    />
                  )}
                  {homeView.weakTypeStudents.length > 0 && (
                    <LearningTaskRow
                      tone="warning"
                      icon={BookOpen}
                      title={`취약 유형 보강 필요 ${homeView.weakTypeStudents.length}명`}
                      description={`${summarizeStudentNames(homeView.weakTypeStudents)} · ${summarizeItems(
                        homeView.weakTypeStudents.flatMap((student) => student.weakTypeNames),
                        '취약 유형 학습 보강 필요',
                      )}`}
                      cta="보충 배정"
                      href="/assignments/new?source=home"
                    />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-dashed bg-background px-4 py-4">
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">학습 관리 상태가 좋습니다</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">오늘 확인할 미완료 과제나 취약 유형이 없습니다.</p>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="flex items-center gap-2 px-0.5 pt-1">
              <QuickActionSparkIcon className="h-[19px] w-[19px] text-primary" />
              <h2 className="text-lg font-bold text-foreground">빠른 실행</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction
                icon="clipboard"
                label="과제 배정"
                href={`/assignments/new?source=home&date=${encodeURIComponent(data.date)}`}
              />
              <QuickAction icon="grid" label="시간표 보기" href="/classrooms/schedule" />
              <QuickAction icon="megaphone" label="공지/알림" href="#admin-alerts" />
              <QuickAction
                icon="calendar"
                label="출결 입력"
                href={`/classrooms/attendance?date=${encodeURIComponent(data.date)}`}
              />
            </div>
            <AdminAlertsPanel alerts={data.adminAlerts} serviceMonth={data.serviceMonth} />
          </aside>
        </div>
      )}
    </PageShell>
  );
}

const accountingSectionOptions: Array<{ value: AccountingSection; label: string; adminOnly?: boolean }> = [
  { value: 'payments', label: '학생 수납' },
  { value: 'payroll', label: '강사 급여' },
  { value: 'expenses', label: '지출 관리' },
  { value: 'reports', label: '세무·내보내기', adminOnly: true },
];

function AccountingMobileNavigation({
  current,
  month,
  canViewReports,
}: {
  current: AccountingSection;
  month: string;
  canViewReports: boolean;
}) {
  const router = useRouter();
  return (
    <div className="md:hidden">
      <Label>회계 메뉴</Label>
      <SelectField value={current} onChange={(event) => router.push(accountingHref(event.target.value as AccountingSection, month))}>
        {accountingSectionOptions
          .filter((option) => !option.adminOnly || canViewReports)
          .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField>
    </div>
  );
}

export function AccountingOperationsPage({
  view,
  initialMonth,
}: {
  view: Exclude<AccountingSection, 'reports'>;
  initialMonth: string;
}) {
  const academyId = useAcademyId();
  const { profile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payroll, setPayroll] = useState<InstructorPaymentRow[]>([]);
  const [payrollEstimates, setPayrollEstimates] = useState<InstructorPayrollEstimate[]>([]);
  const [payrollTaxSettings, setPayrollTaxSettings] = useState({ payrollIncomeTaxRate: 3, payrollLocalTaxRate: 0.3 });
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState('계좌이체');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [expenseDate, setExpenseDate] = useState(today());
  const [expenseCategory, setExpenseCategory] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseMethod, setExpenseMethod] = useState('카드');
  const [expenseRecipient, setExpenseRecipient] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseTaxDeductible, setExpenseTaxDeductible] = useState(true);
  const [expenseHasReceipt, setExpenseHasReceipt] = useState(false);
  const [payrollInstructorId, setPayrollInstructorId] = useState('');
  const [payrollRecipientName, setPayrollRecipientName] = useState('');
  const [payrollPaymentDate, setPayrollPaymentDate] = useState(today());
  const [payrollWithholdingType, setPayrollWithholdingType] = useState<WithholdingType>('freelance_3.3');
  const [payrollWithholdingRate, setPayrollWithholdingRate] = useState('');
  const [payrollHours, setPayrollHours] = useState('');
  const [payrollHourlyRate, setPayrollHourlyRate] = useState('');
  const [payrollAdditionalAmount, setPayrollAdditionalAmount] = useState('');
  const [payrollDeductionAmount, setPayrollDeductionAmount] = useState('');
  const [payrollMethod, setPayrollMethod] = useState('계좌이체');
  const [payrollNotes, setPayrollNotes] = useState('');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [payrollDialogOpen, setPayrollDialogOpen] = useState(false);
  const [payRateDialogOpen, setPayRateDialogOpen] = useState(false);
  const [payRateInstructorId, setPayRateInstructorId] = useState('');
  const [payRateEffectiveFrom, setPayRateEffectiveFrom] = useState(`${initialMonth}-01`);
  const [payRateHourlyRate, setPayRateHourlyRate] = useState('');
  const [payRateSubmitting, setPayRateSubmitting] = useState(false);
  const canViewReports = profile?.role === 'owner' || profile?.role === 'admin';

  useEffect(() => {
    setMonth(initialMonth);
    setPaymentDialogOpen(false);
    setExpenseDialogOpen(false);
    setPayrollDialogOpen(false);
    setPayRateDialogOpen(false);
    setPayRateEffectiveFrom(`${initialMonth}-01`);
  }, [initialMonth]);

  const load = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId) return;
    if (options.background) setRefreshing(true);
    else setLoading(true);
    try {
      if (view === 'payments') {
        const data = await loadStudentPaymentOperationsOverview(academyId, month, { force: options.force });
        setRows(data.billing);
        setPayments(data.payments);
        setSelectedStudentId((current) => data.billing.some((row) => row.studentId === current) ? current : data.billing[0]?.studentId || '');
      } else if (view === 'payroll') {
        const data = await loadInstructorPayrollOperationsOverview(academyId, month, { force: options.force });
        setPayroll(data.payroll);
        setPayrollEstimates(data.payrollEstimates || []);
        setPayrollTaxSettings(data.taxSettings || { payrollIncomeTaxRate: 3, payrollLocalTaxRate: 0.3 });
        setStaff(data.staff);
      } else {
        const data = await loadExpenseOperationsOverview(academyId, month, { force: options.force });
        setExpenses(data.expenses);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '청구 정보를 불러오지 못했습니다.');
    } finally {
      if (options.background) setRefreshing(false);
      else setLoading(false);
    }
  }, [academyId, month, view]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!academyId) return undefined;
    return addLmsInvalidationListener((payload) => {
      if (payload.academyId && payload.academyId !== academyId) return;
      const domain = payload.domain || 'lms';
      if (!['accounting', 'students', 'classes', 'staff', 'lms', 'admin'].includes(domain)) return;
      void load({ force: true, background: true });
    });
  }, [academyId, load]);

  const studentTotals = useMemo(() => ({
    expected: rows.reduce((sum, row) => sum + row.expectedAmount, 0),
    invoiced: rows.reduce((sum, row) => sum + row.invoicedAmount, 0),
    paid: rows.reduce((sum, row) => sum + row.paidAmount, 0),
    outstanding: rows.reduce((sum, row) => sum + Math.max(0, row.invoicedAmount - row.paidAmount), 0),
  }), [rows]);
  const expenseTotals = useMemo(() => ({
    total: expenses.reduce((sum, row) => sum + row.amount, 0),
    deductible: expenses.filter((row) => row.taxDeductible).reduce((sum, row) => sum + row.amount, 0),
    missingReceiptCount: expenses.filter((row) => !row.hasReceipt).length,
  }), [expenses]);
  const payrollTotals = useMemo(() => ({
    completedLessonCount: payrollEstimates.reduce((sum, row) => sum + row.completedLessonCount, 0),
    completedMinutes: payrollEstimates.reduce((sum, row) => sum + row.completedMinutes, 0),
    estimatedBase: payrollEstimates.reduce((sum, row) => sum + row.estimatedBase, 0),
    paidBase: payrollEstimates.reduce((sum, row) => sum + row.paidBase, 0),
    remainingBase: payrollEstimates.reduce((sum, row) => sum + row.remainingBase, 0),
  }), [payrollEstimates]);
  const payrollStaff = useMemo(() => {
    const estimatedInstructorIds = new Set(payrollEstimates.map((row) => row.instructorId));
    return staff.filter((row) => (
      estimatedInstructorIds.has(row.id)
      || (row.status !== 'inactive' && (row.role === 'teacher' || row.role === 'instructor'))
    ));
  }, [payrollEstimates, staff]);
  const payrollPreview = useMemo(() => calculatePayrollDraft({
    hoursWorked: Number(payrollHours),
    hourlyRate: Number(payrollHourlyRate),
    additionalAmount: Number(payrollAdditionalAmount),
    deductionAmount: Number(payrollDeductionAmount),
    withholdingType: payrollWithholdingType,
    customWithholdingRate: Number(payrollWithholdingRate),
    incomeTaxRate: payrollTaxSettings.payrollIncomeTaxRate,
    localTaxRate: payrollTaxSettings.payrollLocalTaxRate,
  }), [
    payrollAdditionalAmount,
    payrollDeductionAmount,
    payrollHourlyRate,
    payrollHours,
    payrollWithholdingRate,
    payrollWithholdingType,
    payrollTaxSettings,
  ]);

  if (!academyId) return <MissingAcademy />;

  const selectedBillingRow = rows.find((row) => row.studentId === selectedStudentId) || rows[0] || null;
  const outstandingAmount = selectedBillingRow
    ? Math.max(0, selectedBillingRow.invoicedAmount - selectedBillingRow.paidAmount)
    : 0;

  const generate = async () => {
    try {
      await generateMonthlyInvoices(academyId, month);
      toast.success(`${month} 청구서를 생성했습니다.`);
      await load({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '청구서 생성 실패');
    }
  };

  const selectPaymentTarget = (row: BillingRow) => {
    setSelectedStudentId(row.studentId);
    setPaymentAmount(String(Math.max(0, row.invoicedAmount - row.paidAmount) || row.invoicedAmount || row.expectedAmount));
    setPaymentDialogOpen(true);
  };

  const changePaymentTarget = (studentId: string) => {
    const row = rows.find((item) => item.studentId === studentId);
    if (!row) return;
    setSelectedStudentId(row.studentId);
    setPaymentAmount(String(Math.max(0, row.invoicedAmount - row.paidAmount) || row.invoicedAmount || row.expectedAmount));
  };

  const resetPayrollDraft = () => {
    setPayrollInstructorId('');
    setPayrollRecipientName('');
    setPayrollHours('');
    setPayrollHourlyRate('');
    setPayrollAdditionalAmount('');
    setPayrollDeductionAmount('');
    setPayrollWithholdingRate('');
    setPayrollNotes('');
  };

  const selectPayrollInstructor = (instructorId: string) => {
    setPayrollInstructorId(instructorId);
    setPayrollAdditionalAmount('');
    if (!instructorId) {
      setPayrollRecipientName('');
      setPayrollHours('');
      setPayrollHourlyRate('');
      setPayrollDeductionAmount('');
      return;
    }

    const estimate = payrollEstimates.find((row) => row.instructorId === instructorId);
    const instructor = staff.find((row) => row.id === instructorId);
    const hourlyRate = estimate?.hourlyRate || instructor?.hourlyRate || null;
    setPayrollRecipientName(estimate?.instructorName || instructor?.name || '');
    const effectiveRate = estimate && estimate.completedMinutes > 0
      ? estimate.estimatedBase / (estimate.completedMinutes / 60)
      : hourlyRate || 0;
    const draftRate = Math.round(effectiveRate);
    setPayrollHours(estimate && draftRate > 0 ? String(estimate.remainingBase / draftRate) : '');
    setPayrollHourlyRate(draftRate ? String(draftRate) : '');
    setPayrollDeductionAmount('');
    setPayrollDialogOpen(true);
  };

  const changeMonth = (nextMonth: string) => {
    setMonth(nextMonth);
    setPaymentDialogOpen(false);
    setExpenseDialogOpen(false);
    setPayrollDialogOpen(false);
    setPayRateDialogOpen(false);
    setPayRateEffectiveFrom(`${nextMonth}-01`);
    setPaymentAmount('');
    resetPayrollDraft();
    router.replace(`${pathname}?month=${encodeURIComponent(nextMonth)}`, { scroll: false });
  };

  const selectPayRateInstructor = (instructorId: string) => {
    setPayRateInstructorId(instructorId);
    const estimate = payrollEstimates.find((row) => row.instructorId === instructorId);
    const instructor = staff.find((row) => row.id === instructorId);
    setPayRateHourlyRate(String(estimate?.hourlyRate ?? instructor?.hourlyRate ?? ''));
  };

  const openPayRateDialog = (instructorId = '') => {
    setPayRateEffectiveFrom(`${month}-01`);
    selectPayRateInstructor(instructorId);
    setPayRateDialogOpen(true);
  };

  const submitPayRate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!payRateInstructorId) {
      toast.error('시급을 설정할 강사를 선택하세요.');
      return;
    }
    setPayRateSubmitting(true);
    try {
      await upsertInstructorPayRate(academyId, {
        instructorId: payRateInstructorId,
        effectiveFrom: payRateEffectiveFrom,
        hourlyRate: Number(payRateHourlyRate),
      });
      setPayRateDialogOpen(false);
      toast.success('적용 시작일별 시급을 저장했습니다.');
      await load({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시급 저장에 실패했습니다.');
    } finally {
      setPayRateSubmitting(false);
    }
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = selectedBillingRow;
    if (!target) {
      toast.error('입금 처리할 학생을 선택하세요.');
      return;
    }
    try {
      await recordPayment(academyId, {
        invoiceId: target.invoiceId,
        studentId: target.studentId,
        paymentDate,
        amount: Number(paymentAmount) || outstandingAmount,
        paymentMethod,
        status: 'completed',
        notes: paymentNotes || null,
      });
      setPaymentAmount('');
      setPaymentNotes('');
      setPaymentDialogOpen(false);
      toast.success('입금 기록을 저장했습니다.');
      await load({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '입금 기록 저장 실패');
    }
  };

  const submitExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createExpense(academyId, {
        expenseDate,
        category: expenseCategory,
        amount: Number(expenseAmount) || 0,
        paymentMethod: expenseMethod,
        recipient: expenseRecipient || null,
        description: expenseDescription || null,
        taxDeductible: expenseTaxDeductible,
        hasReceipt: expenseHasReceipt,
      });
      setExpenseCategory('');
      setExpenseAmount('');
      setExpenseRecipient('');
      setExpenseDescription('');
      setExpenseDialogOpen(false);
      toast.success('지출 기록을 저장했습니다.');
      await load({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지출 기록 저장 실패');
    }
  };

  const submitPayroll = async (event: React.FormEvent) => {
    event.preventDefault();
    const instructor = staff.find((row) => row.id === payrollInstructorId) || null;
    const calculationNotes = [
      payrollPreview.baseAmount > 0
        ? `수업급 ${Number(payrollHours) || 0}시간 × ${currency(Number(payrollHourlyRate) || 0)} = ${currency(payrollPreview.baseAmount)}`
        : null,
      payrollPreview.additionalAmount > 0 ? `추가금 ${currency(payrollPreview.additionalAmount)}` : null,
      payrollPreview.deductionAmount > 0 ? `차감 ${currency(payrollPreview.deductionAmount)}` : null,
    ].filter(Boolean).join(' · ');
    const notes = [calculationNotes, payrollNotes.trim()].filter(Boolean).join('\n') || null;
    try {
      await createInstructorPayment(academyId, {
        instructorId: payrollInstructorId || null,
        recipientName: payrollRecipientName || instructor?.name || null,
        serviceMonth: month,
        paymentDate: payrollPaymentDate,
        grossAmount: payrollPreview.grossAmount,
        baseAmount: payrollPreview.baseAmount,
        additionalAmount: payrollPreview.additionalAmount,
        deductionAmount: payrollPreview.deductionAmount,
        withholdingType: payrollWithholdingType,
        withholdingRate: payrollWithholdingRate ? Number(payrollWithholdingRate) : undefined,
        hoursWorked: payrollHours ? Number(payrollHours) : null,
        hourlyRate: payrollHourlyRate ? Number(payrollHourlyRate) : instructor?.hourlyRate ?? null,
        paymentMethod: payrollMethod,
        status: 'paid',
        notes,
      });
      resetPayrollDraft();
      setPayrollDialogOpen(false);
      toast.success('강사 지급 기록을 저장했습니다.');
      await load({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강사 지급 기록 저장 실패');
    }
  };

  const pageTitle = view === 'payments' ? '학생 수납' : view === 'payroll' ? '강사 급여' : '지출 관리';
  const openDirectPayroll = () => {
    resetPayrollDraft();
    setPayrollDialogOpen(true);
  };

  return (
    <PageShell
      title={pageTitle}
      icon={CreditCard}
      action={(
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="회계 기준 월" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="w-40" />
          {view === 'payments' && <Button type="button" onClick={generate}>청구서 생성</Button>}
          {view === 'payroll' && (
            <>
              <Button type="button" variant="outline" onClick={() => openPayRateDialog()}>시급 설정</Button>
              <Button type="button" onClick={openDirectPayroll}>직접 지급 등록</Button>
            </>
          )}
          {view === 'expenses' && <Button type="button" onClick={() => setExpenseDialogOpen(true)}>지출 등록</Button>}
        </div>
      )}
    >
      <AccountingMobileNavigation current={view} month={month} canViewReports={canViewReports} />

      {view === 'payments' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="예상 청구" value={currency(studentTotals.expected)} hint="계약·출결 기준" icon={CreditCard} />
          <MetricCard label="발행 청구" value={currency(studentTotals.invoiced)} hint="이번 달 청구서" icon={BookOpen} />
          <MetricCard label="수납" value={currency(studentTotals.paid)} hint="납부 반영액" icon={Activity} />
          <MetricCard label="미수" value={currency(studentTotals.outstanding)} hint="남은 청구액" icon={AlertTriangle} />
        </div>
      )}
      {view === 'payroll' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="완료 수업" value={hoursLabel(payrollTotals.completedMinutes)} hint={`${payrollTotals.completedLessonCount}회`} icon={Clock} />
          <MetricCard label="예상 수업급" value={currency(payrollTotals.estimatedBase)} hint="완료 시간 × 당시 시급" icon={Users} />
          <MetricCard label="기지급 수업급" value={currency(payrollTotals.paidBase)} hint="지급 기록의 기본 수업급" icon={CheckCircle2} />
          <MetricCard label="남은 수업급" value={currency(payrollTotals.remainingBase)} hint="예상 수업급 - 기지급 수업급" icon={AlertTriangle} />
        </div>
      )}
      {view === 'expenses' && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="지출 합계" value={currency(expenseTotals.total)} hint="이번 달" icon={ReceiptText} />
          <MetricCard label="세무 반영" value={currency(expenseTotals.deductible)} hint="공제 대상 표시" icon={CheckCircle2} />
          <MetricCard label="증빙 미확인" value={`${expenseTotals.missingReceiptCount}건`} hint="영수증 확인 필요" icon={AlertTriangle} />
        </div>
      )}
      {loading ? <LoadingBlock /> : (
        <div className="space-y-5">
          {view === 'payments' && (
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle>학생별 청구 상태</CardTitle></CardHeader>
              <CardContent className="p-0">
                <DataTable>
                    <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4 py-3 font-medium">학생</TableHead>
                      <TableHead className="px-4 py-3 font-medium">방식</TableHead>
                      <TableHead className="px-4 py-3 font-medium">예상액</TableHead>
                      <TableHead className="px-4 py-3 font-medium">청구액</TableHead>
                      <TableHead className="px-4 py-3 font-medium">입금액</TableHead>
                      <TableHead className="px-4 py-3 font-medium">상태</TableHead>
                      <TableHead className="px-4 py-3 font-medium">처리</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.studentId}>
                        <TableCell className="px-4 py-3 font-medium">{row.studentName}</TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground">{billingModeLabel(row.billingMode)}</TableCell>
                        <TableCell className="px-4 py-3 tabular-nums">{currency(row.expectedAmount)}</TableCell>
                        <TableCell className="px-4 py-3 tabular-nums">{currency(row.invoicedAmount)}</TableCell>
                        <TableCell className="px-4 py-3 tabular-nums">{currency(row.paidAmount)}</TableCell>
                        <TableCell className="px-4 py-3"><StatusBadge status={row.status} /></TableCell>
                        <TableCell className="px-4 py-3">
                          <Button type="button" size="sm" variant="outline" onClick={() => selectPaymentTarget(row)}>
                            수납 처리
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {rows.length === 0 && <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">학생 청구 데이터가 없습니다.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                  </DataTable>
              </CardContent>
            </Card>

            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>수납 처리</DialogTitle>
                  <DialogDescription>선택한 학생의 납부 금액과 결제 정보를 기록합니다.</DialogDescription>
                </DialogHeader>
                <form onSubmit={submitPayment} className="space-y-3">
                  <div>
                    <Label>학생</Label>
                    <SelectField value={selectedStudentId} onChange={(event) => changePaymentTarget(event.target.value)}>
                      {rows.map((row) => (
                        <option key={row.studentId} value={row.studentId}>{row.studentName}</option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>납부일</Label><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div>
                    <div><Label>금액</Label><Input type="number" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder={String(outstandingAmount)} /></div>
                  </div>
                  <div><Label>결제수단</Label><Input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} /></div>
                  <div><Label>메모</Label><Input value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(false)}>취소</Button>
                    <Button type="submit" disabled={!selectedBillingRow}>입금 저장</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          )}

          <div className="space-y-5">
            {view === 'expenses' && (
            <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>지출 등록</DialogTitle>
                  <DialogDescription>지출 금액과 증빙·세무 반영 정보를 기록합니다.</DialogDescription>
                </DialogHeader>
                <form onSubmit={submitExpense} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>지출일</Label><Input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></div>
                    <div><Label>금액</Label><Input type="number" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>분류</Label><Input value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} placeholder="임대료, 교재, 광고..." /></div>
                    <div><Label>결제수단</Label><Input value={expenseMethod} onChange={(event) => setExpenseMethod(event.target.value)} /></div>
                  </div>
                  <div><Label>거래처/수령인</Label><Input value={expenseRecipient} onChange={(event) => setExpenseRecipient(event.target.value)} /></div>
                  <div><Label>내용</Label><Input value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                      <Checkbox checked={expenseTaxDeductible} onCheckedChange={(checked) => setExpenseTaxDeductible(checked === true)} />
                      세무 반영
                    </label>
                    <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                      <Checkbox checked={expenseHasReceipt} onCheckedChange={(checked) => setExpenseHasReceipt(checked === true)} />
                      증빙 있음
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setExpenseDialogOpen(false)}>취소</Button>
                    <Button type="submit">지출 저장</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            )}

            {view === 'payroll' && (<>
            <Card>
              <CardHeader><CardTitle>월 급여 예상</CardTitle></CardHeader>
              <CardContent className="p-0">
                <DataTable>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-4 py-3 font-medium">강사</TableHead>
                        <TableHead className="px-4 py-3 font-medium">수업 진행</TableHead>
                        <TableHead className="px-4 py-3 font-medium">시급</TableHead>
                        <TableHead className="px-4 py-3 font-medium">예상 수업급</TableHead>
                        <TableHead className="px-4 py-3 font-medium">기지급 수업급</TableHead>
                        <TableHead className="px-4 py-3 font-medium">남은 수업급</TableHead>
                        <TableHead className="px-4 py-3 font-medium">처리</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollEstimates.map((row) => {
                        const rateBreakdown = row.rateBreakdown.filter((rate) => rate.hourlyRate > 0);
                        const hasRate = rateBreakdown.length > 0 || Boolean(row.hourlyRate);
                        return (
                          <TableRow key={row.instructorId}>
                          <TableCell className="px-4 py-3 font-medium">{row.instructorName}</TableCell>
                          <TableCell className="px-4 py-3">
                            <div className="font-medium">완료 {row.completedLessonCount}/{row.scheduledLessonCount}회</div>
                            <div className="text-xs text-muted-foreground">{hoursLabel(row.completedMinutes)} / {hoursLabel(row.scheduledMinutes)}</div>
                          </TableCell>
                          <TableCell className="px-4 py-3 tabular-nums">
                            {rateBreakdown.length > 1 ? (
                              <div>
                                <div className="font-medium">혼합 시급</div>
                                <div className="text-xs text-muted-foreground">
                                  {rateBreakdown.map((rate) => `${currency(rate.hourlyRate)} · ${hoursLabel(rate.minutes)}`).join(' / ')}
                                </div>
                              </div>
                            ) : rateBreakdown[0] ? currency(rateBreakdown[0].hourlyRate) : row.hourlyRate
                              ? currency(row.hourlyRate)
                              : <span className="text-warning-foreground">시급 미설정</span>}
                          </TableCell>
                          <TableCell className="px-4 py-3 tabular-nums">{hasRate ? currency(row.estimatedBase) : '-'}</TableCell>
                          <TableCell className="px-4 py-3 tabular-nums">
                            <div>{currency(row.paidBase)}</div>
                            {(row.additionalAmount > 0 || row.deductionAmount > 0) && (
                              <div className="text-xs text-muted-foreground">
                                추가 {currency(row.additionalAmount)} · 차감 {currency(row.deductionAmount)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-3 tabular-nums font-medium">{hasRate ? currency(row.remainingBase) : '-'}</TableCell>
                          <TableCell className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="ghost" onClick={() => openPayRateDialog(row.instructorId)}>
                                시급 설정
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => selectPayrollInstructor(row.instructorId)}>
                                지급 작성
                              </Button>
                            </div>
                          </TableCell>
                          </TableRow>
                        );
                      })}
                      {payrollEstimates.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">이번 달 강사 수업이나 시급 정보가 없습니다.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </DataTable>
              </CardContent>
            </Card>

            <Dialog open={payRateDialogOpen} onOpenChange={setPayRateDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>강사 시급 설정</DialogTitle>
                  <DialogDescription>적용 시작일을 기준으로 이력을 남기며, 이전 수업의 계산은 바뀌지 않습니다.</DialogDescription>
                </DialogHeader>
                <form onSubmit={submitPayRate} className="space-y-4">
                  <div>
                    <Label htmlFor="pay-rate-instructor">강사</Label>
                    <SelectField
                      id="pay-rate-instructor"
                      value={payRateInstructorId}
                      onChange={(event) => selectPayRateInstructor(event.target.value)}
                      disabled={payRateSubmitting}
                    >
                      <option value="">강사 선택</option>
                      {payrollStaff.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                    </SelectField>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="pay-rate-effective-from">적용 시작일</Label>
                      <Input
                        id="pay-rate-effective-from"
                        type="date"
                        required
                        value={payRateEffectiveFrom}
                        onChange={(event) => setPayRateEffectiveFrom(event.target.value)}
                        disabled={payRateSubmitting}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pay-rate-hourly-rate">시급</Label>
                      <Input
                        id="pay-rate-hourly-rate"
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={payRateHourlyRate}
                        onChange={(event) => setPayRateHourlyRate(event.target.value)}
                        disabled={payRateSubmitting}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setPayRateDialogOpen(false)} disabled={payRateSubmitting}>취소</Button>
                    <Button type="submit" disabled={payRateSubmitting}>{payRateSubmitting ? '저장 중...' : '시급 저장'}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={payrollDialogOpen} onOpenChange={setPayrollDialogOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>강사 지급 작성</DialogTitle>
                  <DialogDescription>완료 수업 예상치를 바탕으로 지급액과 원천징수를 조정합니다.</DialogDescription>
                </DialogHeader>
                <form onSubmit={submitPayroll} className="space-y-3">
                  <div>
                    <Label>강사</Label>
                    <SelectField value={payrollInstructorId} onChange={(event) => selectPayrollInstructor(event.target.value)}>
                      <option value="">직접 입력</option>
                      {payrollStaff.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>수령인명</Label><Input value={payrollRecipientName} onChange={(event) => setPayrollRecipientName(event.target.value)} placeholder="직접 입력 시 필요" /></div>
                    <div><Label>지급일</Label><Input type="date" value={payrollPaymentDate} onChange={(event) => setPayrollPaymentDate(event.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>수업 시간</Label><Input type="number" min="0" step="0.01" value={payrollHours} onChange={(event) => setPayrollHours(event.target.value)} /></div>
                    <div><Label>시급</Label><Input type="number" min="0" step="1" value={payrollHourlyRate} onChange={(event) => setPayrollHourlyRate(event.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>추가금</Label><Input type="number" min="0" step="1" value={payrollAdditionalAmount} onChange={(event) => setPayrollAdditionalAmount(event.target.value)} placeholder="보너스·교통비 등" /></div>
                    <div><Label>차감액</Label><Input type="number" min="0" step="1" value={payrollDeductionAmount} onChange={(event) => setPayrollDeductionAmount(event.target.value)} placeholder="조정·공제액" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>원천징수</Label>
                      <SelectField value={payrollWithholdingType} onChange={(event) => setPayrollWithholdingType(event.target.value as WithholdingType)}>
                        <option value="freelance_3.3">
                          프리랜서 {payrollTaxSettings.payrollIncomeTaxRate + payrollTaxSettings.payrollLocalTaxRate}%
                        </option>
                        <option value="none">없음</option>
                        <option value="custom">직접 계산</option>
                      </SelectField>
                    </div>
                    <div><Label>지급수단</Label><Input value={payrollMethod} onChange={(event) => setPayrollMethod(event.target.value)} /></div>
                  </div>
                  {payrollWithholdingType === 'custom' && (
                    <div><Label>원천징수율 (%)</Label><Input type="number" step="0.1" min="0" value={payrollWithholdingRate} onChange={(event) => setPayrollWithholdingRate(event.target.value)} /></div>
                  )}
                  <div><Label>메모</Label><Input value={payrollNotes} onChange={(event) => setPayrollNotes(event.target.value)} /></div>
                  <div className="space-y-2 rounded-xl bg-muted/60 p-4 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">수업급</span><strong>{currency(payrollPreview.baseAmount)}</strong></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">추가·차감</span><strong>{currency(payrollPreview.additionalAmount - payrollPreview.deductionAmount)}</strong></div>
                    <div className="flex justify-between border-t pt-2"><span>세전 지급액</span><strong>{currency(payrollPreview.grossAmount)}</strong></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">원천징수</span><span>-{currency(payrollPreview.withholdingTax + payrollPreview.localTax)}</span></div>
                    <div className="flex justify-between text-base"><span>실지급액</span><strong>{currency(payrollPreview.netAmount)}</strong></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setPayrollDialogOpen(false)}>취소</Button>
                    <Button type="submit" disabled={payrollPreview.grossAmount <= 0 || (!payrollInstructorId && !payrollRecipientName.trim())}>지급 저장</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            </>)}
          </div>

          <div className="space-y-5">
            {view === 'payments' && (
            <Card>
              <CardHeader><CardTitle>최근 입금</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {payments.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                    <div>
                      <strong>{row.studentName}</strong>
                      <div className="text-xs text-muted-foreground">{row.paymentDate} · {row.paymentMethod || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{currency(row.amount)}</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>
                ))}
                {payments.length === 0 && <p className="py-8 text-center text-muted-foreground">입금 기록이 없습니다.</p>}
              </CardContent>
            </Card>
            )}

            {view === 'expenses' && (
            <Card>
              <CardHeader><CardTitle>최근 지출</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {expenses.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                    <div>
                      <strong>{row.category}</strong>
                      <div className="text-xs text-muted-foreground">{row.expenseDate} · {row.recipient || row.description || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{currency(row.amount)}</div>
                      <div className="text-xs text-muted-foreground">{row.hasReceipt ? '증빙 있음' : '증빙 없음'}</div>
                    </div>
                  </div>
                ))}
                {expenses.length === 0 && <p className="py-8 text-center text-muted-foreground">지출 기록이 없습니다.</p>}
              </CardContent>
            </Card>
            )}

            {view === 'payroll' && (
            <Card>
              <CardHeader><CardTitle>강사 지급 내역</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {payroll.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                    <div>
                      <strong>{row.recipientName || row.instructorName || '-'}</strong>
                      <div className="text-xs text-muted-foreground">
                        {row.paymentDate} · 수업급 {currency(row.baseAmount)} · 추가 {currency(row.additionalAmount)} · 차감 {currency(row.deductionAmount)}
                      </div>
                      <div className="text-xs text-muted-foreground">원천 {currency(row.withholdingTax + row.localTax)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{currency(row.netAmount)}</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>
                ))}
                {payroll.length === 0 && <p className="py-8 text-center text-muted-foreground">지급 기록이 없습니다.</p>}
              </CardContent>
            </Card>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

export function AccountingReportsPage({ initialMonth }: { initialMonth: string }) {
  const academyId = useAcademyId();
  const { profile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const initialRange = useMemo(() => accountingMonthRange(initialMonth), [initialMonth]);
  const [month, setMonth] = useState(initialMonth);
  const [taxIncomeRate, setTaxIncomeRate] = useState('3');
  const [taxLocalRate, setTaxLocalRate] = useState('0.3');
  const [vatRate, setVatRate] = useState('0');
  const [loadingTaxSettings, setLoadingTaxSettings] = useState(true);
  const [savingTax, setSavingTax] = useState(false);
  const [exportType, setExportType] = useState<AdminExportType>('tax');
  const [exportStartDate, setExportStartDate] = useState(initialRange.startDate);
  const [exportEndDate, setExportEndDate] = useState(initialRange.endDate);
  const [includeRevenue, setIncludeRevenue] = useState(true);
  const [includePayroll, setIncludePayroll] = useState(true);
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [includeProfitLoss, setIncludeProfitLoss] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const canViewReports = profile?.role === 'owner' || profile?.role === 'admin';

  useEffect(() => {
    const range = accountingMonthRange(initialMonth);
    setMonth(initialMonth);
    setExportStartDate(range.startDate);
    setExportEndDate(range.endDate);
    setPendingAdminAction(null);
  }, [initialMonth]);

  const loadTaxSettings = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId) return;
    if (!options.background) setLoadingTaxSettings(true);
    try {
      const settings = await loadAccountingTaxSettings(academyId, { force: options.force });
      setTaxIncomeRate(String(settings.payrollIncomeTaxRate));
      setTaxLocalRate(String(settings.payrollLocalTaxRate));
      setVatRate(String(settings.salesVatRate));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '세금 기준을 불러오지 못했습니다.');
    } finally {
      if (!options.background) setLoadingTaxSettings(false);
    }
  }, [academyId]);

  useEffect(() => {
    void loadTaxSettings();
  }, [loadTaxSettings]);

  useEffect(() => {
    if (!academyId) return undefined;
    return addLmsInvalidationListener((payload) => {
      if (payload.academyId && payload.academyId !== academyId) return;
      const domain = payload.domain || 'lms';
      if (!['accounting', 'admin', 'lms'].includes(domain)) return;
      void loadTaxSettings({ force: true, background: true });
    });
  }, [academyId, loadTaxSettings]);

  if (!academyId) return <MissingAcademy />;

  const changeMonth = (nextMonth: string) => {
    const range = accountingMonthRange(nextMonth);
    setMonth(nextMonth);
    setExportStartDate(range.startDate);
    setExportEndDate(range.endDate);
    setPendingAdminAction(null);
    router.replace(`${pathname}?month=${encodeURIComponent(nextMonth)}`, { scroll: false });
  };

  const executeTaxSettingsSave = async () => {
    setSavingTax(true);
    try {
      await updateTaxSettings(academyId, {
        payroll_income_tax_rate: taxIncomeRate,
        payroll_local_tax_rate: taxLocalRate,
        sales_vat_rate: vatRate,
      });
      toast.success('세금 기준을 저장했습니다.');
      await loadTaxSettings({ force: true, background: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '세금 기준 저장에 실패했습니다.');
    } finally {
      setSavingTax(false);
    }
  };

  const requestTaxSettingsSave = (event: React.FormEvent) => {
    event.preventDefault();
    setPendingAdminAction({
      title: '세금·급여 기준 저장',
      description: '세금과 급여 기준은 회계 내역과 내보내기에 영향을 줍니다. 계속하려면 비밀번호를 입력하세요.',
      confirmLabel: '기준 저장',
      onConfirm: executeTaxSettingsSave,
    });
  };

  const executeExport = async () => {
    setExporting(true);
    try {
      const output = await exportAdminCsv(academyId, exportType, {
        startDate: exportStartDate,
        endDate: exportEndDate,
        includeRevenue,
        includePayroll,
        includeExpenses,
        includeProfitLoss,
      });
      downloadCsv(output.filename, output.csv);
      toast.success('CSV 파일을 생성했습니다.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CSV 내보내기에 실패했습니다.');
    } finally {
      setExporting(false);
    }
  };

  const requestExport = () => {
    setPendingAdminAction({
      title: 'CSV 내보내기',
      description: '회계·급여 CSV에는 민감한 운영 데이터가 포함됩니다. 계속하려면 비밀번호를 입력하세요.',
      confirmLabel: 'CSV 생성',
      onConfirm: executeExport,
    });
  };

  return (
    <PageShell
      title="세무·내보내기"
      icon={ReceiptText}
      action={<Input aria-label="회계 기준 월" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="w-40" />}
    >
      <AccountingMobileNavigation current="reports" month={month} canViewReports={canViewReports} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>세금·급여 기준</CardTitle></CardHeader>
          <CardContent>
            {loadingTaxSettings ? <SkeletonPanel className="h-40" /> : (
              <form onSubmit={requestTaxSettingsSave} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label>원천세율 (%)</Label>
                    <Input type="number" step="0.1" min="0" value={taxIncomeRate} onChange={(event) => setTaxIncomeRate(event.target.value)} />
                  </div>
                  <div>
                    <Label>지방세율 (%)</Label>
                    <Input type="number" step="0.1" min="0" value={taxLocalRate} onChange={(event) => setTaxLocalRate(event.target.value)} />
                  </div>
                  <div>
                    <Label>부가세율 (%)</Label>
                    <Input type="number" step="0.1" min="0" value={vatRate} onChange={(event) => setVatRate(event.target.value)} />
                  </div>
                </div>
                <Button type="submit" disabled={savingTax}>
                  {savingTax ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  기준 저장
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>CSV 내보내기</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>유형</Label>
                <SelectField value={exportType} onChange={(event) => setExportType(event.target.value as AdminExportType)}>
                  <option value="tax">세무 리포트</option>
                  <option value="payroll">강사 급여</option>
                </SelectField>
              </div>
              <div>
                <Label>시작일</Label>
                <Input type="date" value={exportStartDate} onChange={(event) => setExportStartDate(event.target.value)} />
              </div>
              <div>
                <Label>종료일</Label>
                <Input type="date" value={exportEndDate} onChange={(event) => setExportEndDate(event.target.value)} />
              </div>
            </div>
            {exportType === 'tax' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  <Checkbox checked={includeRevenue} onCheckedChange={(checked) => setIncludeRevenue(checked === true)} />
                  매출 포함
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  <Checkbox checked={includePayroll} onCheckedChange={(checked) => setIncludePayroll(checked === true)} />
                  급여 포함
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  <Checkbox checked={includeExpenses} onCheckedChange={(checked) => setIncludeExpenses(checked === true)} />
                  비용 포함
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                  <Checkbox checked={includeProfitLoss} onCheckedChange={(checked) => setIncludeProfitLoss(checked === true)} />
                  손익 요약 포함
                </label>
              </div>
            )}
            <Button type="button" onClick={requestExport} disabled={exporting || exportStartDate > exportEndDate}>
              {exporting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              CSV 생성
            </Button>
          </CardContent>
        </Card>
      </div>

      <PasswordConfirmDialog
        open={Boolean(pendingAdminAction)}
        onOpenChange={(open) => {
          if (!open) setPendingAdminAction(null);
        }}
        title={pendingAdminAction?.title || ''}
        description={pendingAdminAction?.description || ''}
        confirmLabel={pendingAdminAction?.confirmLabel || '확인'}
        onConfirm={async () => {
          await pendingAdminAction?.onConfirm();
        }}
      />
    </PageShell>
  );
}

const resetTargets: Array<{ value: AdminResetTarget; label: string; description: string }> = [
  { value: 'schedules', label: '일정/출결', description: '수업 발생 일정과 출결 기록을 삭제합니다.' },
  { value: 'classes', label: '반/수업', description: '반, 반 프로필, 일정, 출결을 삭제합니다.' },
  { value: 'students', label: '학생/청구 계약', description: '학생 원장과 청구 계약, 청구서, 납부 기록을 삭제합니다.' },
  { value: 'instructors', label: '강사/직원', description: '강사와 직원 원장을 삭제합니다.' },
  { value: 'accounting', label: '회계', description: '청구서, 납부, 지출, 강사 지급 기록을 삭제합니다.' },
  { value: 'classrooms', label: '강의실', description: '강의실 원장을 삭제합니다.' },
  { value: 'courses', label: '과목', description: 'LMS 과목 원장을 삭제합니다.' },
  { value: 'all', label: '전체 LMS 운영 데이터', description: 'LMS 운영 데이터 전체를 삭제합니다. 교재/문제 데이터는 포함하지 않습니다.' },
];

export function SettingsOperationsPage() {
  const academyId = useAcademyId();
  const [resetTarget, setResetTarget] = useState<AdminResetTarget>('schedules');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  if (!academyId) return <MissingAcademy />;

  const selectedResetTarget = resetTargets.find((target) => target.value === resetTarget) || resetTargets[0];
  const canReset = resetConfirm.trim() === '초기화' && !resetting;

  const executeReset = async (target: AdminResetTarget, confirmText: string, label: string) => {
    setResetting(true);
    try {
      const { confirmToken } = await prepareAdminReset(academyId, target, confirmText);
      await resetAdminData(academyId, target, confirmToken);
      setResetConfirm('');
      toast.success(`${label} 데이터를 초기화했습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '초기화에 실패했습니다.');
    } finally {
      setResetting(false);
    }
  };

  const requestReset = () => {
    if (!canReset) return;
    const target = resetTarget;
    const confirmText = resetConfirm;
    const label = selectedResetTarget.label;
    setPendingAdminAction({
      title: `${label} 초기화`,
      description: '초기화는 되돌릴 수 없습니다. 계속하려면 비밀번호를 입력하세요.',
      confirmLabel: '초기화 실행',
      onConfirm: () => executeReset(target, confirmText, label),
    });
  };

  return (
    <PageShell title="설정" icon={Settings}>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>현재 연결</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/60 p-3">
                <span>Academy ID</span>
                <code className="break-all text-right text-xs">{academyId}</code>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span>학생/반 기준</span>
                <strong>core.students / core.classes</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span>교재 권한</span>
                <strong>learning.book_assignments</strong>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-soft p-3 text-primary-strong">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>민감한 관리 작업은 서버에서 같은 academy 권한과 최근 로그인 여부를 다시 확인합니다.</p>
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="space-y-5">
          <Card className="border-destructive/30">
            <CardHeader><CardTitle>운영 데이터 초기화</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                초기화는 되돌릴 수 없습니다. 원격 `nextum-data` 전환 전에는 교재/문제 데이터 백업과 범위를 먼저 확정해야 합니다.
              </div>
              <div>
                <Label>초기화 범위</Label>
                <SelectField value={resetTarget} onChange={(event) => setResetTarget(event.target.value as AdminResetTarget)}>
                  {resetTargets.map((target) => (
                    <option key={target.value} value={target.value}>{target.label}</option>
                  ))}
                </SelectField>
                <p className="mt-2 text-sm text-muted-foreground">{selectedResetTarget.description}</p>
              </div>
              <div>
                <Label>확인 문구</Label>
                <Input value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} placeholder="초기화" />
              </div>
              <Button type="button" variant="destructive" onClick={requestReset} disabled={!canReset}>
                {resetting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                선택 범위 초기화
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>개발용 관리자</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>개발 DB에서만 `admin / 1234` 계정을 생성합니다. 실수 방지를 위해 명시 플래그가 필요합니다.</p>
              <pre className="overflow-x-auto rounded-xl bg-foreground p-3 text-xs text-primary-foreground">{"$env:LMS_DEV_SEED_ALLOW='true'; npm run seed:dev-admin"}</pre>
            </CardContent>
          </Card>
        </div>
      </div>
      <PasswordConfirmDialog
        open={Boolean(pendingAdminAction)}
        onOpenChange={(open) => {
          if (!open) setPendingAdminAction(null);
        }}
        title={pendingAdminAction?.title || ''}
        description={pendingAdminAction?.description || ''}
        confirmLabel={pendingAdminAction?.confirmLabel || '확인'}
        onConfirm={async () => {
          await pendingAdminAction?.onConfirm();
        }}
      />
    </PageShell>
  );
}
