'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  CreditCard,
  Download,
  GraduationCap,
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
import { EmptyState, ErrorState } from '@/components/ui/state';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  addLmsInvalidationListener,
  exportAdminCsv,
  generateMonthlyInvoices,
  getDashboardData,
  loadAccountingOperationsOverview,
  prepareAdminReset,
  recordPayment,
  resetAdminData,
  updateTaxSettings,
  createExpense,
  createInstructorPayment,
} from './service';
import { calculatePayrollDraft } from './payroll';
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

const DEFAULT_CLASS_COLOR = '#059669';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthRange(): { startDate: string; endDate: string } {
  const month = currentMonth();
  return serviceMonthRange(month);
}

function serviceMonthRange(month: string): { startDate: string; endDate: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    startDate: `${month}-01`,
    endDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`,
  };
}

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
    weekday: 'short',
  }).format(new Date(`${value}T00:00:00`));
}

function formatDueDate(value: string | null): string {
  if (!value) return '마감 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border bg-card p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="mt-5 h-2 w-full" />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClassMetric({ label, value, tone }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
      {tone && <div className={`mt-2 h-1 rounded-full ${tone === 'danger' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning' : tone === 'success' ? 'bg-success' : 'bg-primary'}`} />}
    </div>
  );
}

function lessonTimeText(classRow: DashboardData['classes'][number]): string {
  if (classRow.lessons.length === 0) return '수업 시간 없음';
  return classRow.lessons
    .map((lesson) => `${lesson.startTime}-${lesson.endTime}`)
    .join(', ');
}

function ActionStudentRow({ student }: { student: DashboardData['classes'][number]['actionStudents'][number] }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">{student.studentName}</p>
        <div className="flex flex-wrap gap-1.5">
          {student.missingAssignmentCount > 0 && <StatusBadge tone="warning" label={`과제 ${student.missingAssignmentCount}`} />}
          {student.weakTypeCount > 0 && <StatusBadge tone="danger" label={`취약 ${student.weakTypeCount}`} />}
          {student.attendanceIssueCount > 0 && <StatusBadge tone="info" label={`출결 ${student.attendanceIssueCount}`} />}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {student.assignmentTitles.length > 0 && <p>미완료 과제: {student.assignmentTitles.join(', ')}</p>}
        {student.weakTypes.length > 0 && <p>취약 유형: {student.weakTypes.map((row) => `${row.typeName}${row.score === null ? '' : ` ${row.score}%`}`).join(', ')}</p>}
        {student.attendanceStatuses.length > 0 && <p>출결 확인: {student.attendanceStatuses.join(', ')}</p>}
      </div>
    </div>
  );
}

function HomeClassCard({ classRow }: { classRow: DashboardData['classes'][number] }) {
  const [expanded, setExpanded] = useState(false);
  const progress = classRow.assignmentProgress;
  const hasAssignments = progress.assignmentCount > 0;
  const tone = completionTone(progress.completionRate, hasAssignments);
  const attendanceIssueCount = classRow.attendance.missing + classRow.attendance.absent + classRow.attendance.late + classRow.attendance.makeup;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: classRow.color || DEFAULT_CLASS_COLOR }} />
              <CardTitle className="truncate text-lg">{classRow.className}</CardTitle>
              {classRow.grade && <StatusBadge tone="neutral" label={classRow.grade} />}
              <StatusBadge tone={tone} label={hasAssignments ? `과제 ${progress.completionRate}%` : '과제 없음'} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{lessonTimeText(classRow)}</span>
              {classRow.instructorName && <span>강사 {classRow.instructorName}</span>}
              {classRow.classroomName && <span>강의실 {classRow.classroomName}</span>}
              <span>{classRow.studentCount}명</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/assignments">과제 현황</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/classrooms">
                반 운영
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">과제 완료율</span>
            <span className="tabular-nums text-muted-foreground">
              {progress.completedCount}/{progress.targetStudentCount}명 과제
            </span>
          </div>
          <ProgressBar value={progress.completionRate} tone={tone} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>진행 과제 {progress.assignmentCount}개</span>
            <span>미시작 {progress.notStartedCount}명</span>
            <span>진행중 {progress.inProgressCount}명</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ClassMetric label="조치 필요" value={`${classRow.actionStudents.length}명`} tone={classRow.actionStudents.length > 0 ? 'warning' : 'success'} />
          <ClassMetric label="취약 학생" value={`${classRow.weakStudentCount}명 / ${classRow.weakTypeCount}개`} tone={classRow.weakStudentCount > 0 ? 'danger' : 'success'} />
          <ClassMetric label="출결 확인" value={`${attendanceIssueCount}건`} tone={attendanceIssueCount > 0 ? 'warning' : 'success'} />
        </div>

        {classRow.assignments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">확인할 과제</p>
            <div className="grid gap-2 lg:grid-cols-2">
              {classRow.assignments.map((assignment) => (
                <div key={assignment.id} className="rounded-lg border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{assignment.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{assignment.bookTitle || '교재 미지정'} · {formatDueDate(assignment.dueAt)}</p>
                    </div>
                    <StatusBadge tone={assignment.overdue ? 'danger' : assignment.dueSoon ? 'warning' : 'primary'} label={`${assignment.completionRate}%`} />
                  </div>
                  <ProgressBar value={assignment.completionRate} tone={assignment.overdue ? 'danger' : assignment.dueSoon ? 'warning' : 'primary'} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            조치 학생 {classRow.actionStudents.length}명
          </Button>
          <Button asChild variant="link" size="sm">
            <Link href="/students">학생 상세 보기</Link>
          </Button>
        </div>

        {expanded && (
          <div className="space-y-2">
            {classRow.actionStudents.length === 0 ? (
              <div className="rounded-lg border bg-success-soft p-3 text-sm text-success-foreground">
                오늘 바로 확인할 과제/취약/출결 이슈가 없습니다.
              </div>
            ) : (
              classRow.actionStudents.map((student) => (
                <ActionStudentRow key={student.studentId} student={student} />
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminAlertsPanel({ alerts }: { alerts: NonNullable<DashboardData['adminAlerts']> }) {
  if (alerts.unpaidBillingCount === 0) {
    return (
      <Card>
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">관리자 알림</CardTitle>
          <StatusBadge tone="warning" label={`${alerts.unpaidBillingCount}건`} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-warning-soft p-3 text-sm text-warning-foreground">
          미납/미발행 합계 {currency(alerts.unpaidBillingAmount)}
        </div>
        <div className="space-y-2">
          {alerts.unpaidBillingStudents.map((student) => (
            <div key={student.studentId} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm">
              <span className="truncate font-medium">{student.studentName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{currency(student.amount)}</span>
            </div>
          ))}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/accounting">회계에서 확인</Link>
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
      title="오늘 수업 대시보드"
      icon={BarChart3}
      action={
        <div className="flex items-center gap-2">
          <Input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || today())} className="w-40" />
          <Button variant="outline" onClick={() => setSelectedDate(today())}>
            오늘
          </Button>
          <Button variant="outline" onClick={() => void load({ force: true })}>
            <RefreshCw className="mr-2 h-4 w-4" />
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
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="오늘 수업" value={`${data.summary.todayLessonCount}회`} hint={`${formatShortDate(data.date)} · ${data.summary.todayClassCount}개 반`} icon={CalendarDays} />
            <MetricCard label="대상 학생" value={`${data.summary.activeStudentCount}명`} hint="오늘 수업 반 재원생" icon={GraduationCap} />
            <MetricCard label="조치 필요" value={`${data.summary.actionStudentCount}명`} hint="과제/취약/출결 확인" icon={AlertTriangle} />
            <MetricCard label="관리 알림" value={`${data.summary.unpaidBillingCount}건`} hint="관리자 전용 회계 알림" icon={ClipboardList} />
          </div>

          {data.classes.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="오늘 예정된 수업이 없습니다"
              description="날짜를 바꾸거나 반/시간표에서 반복 수업과 실제 수업 일정을 확인하세요."
              action={<Button asChild variant="outline"><Link href="/classrooms">반/시간표 확인</Link></Button>}
            />
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                {data.classes.map((classRow) => (
                  <HomeClassCard key={classRow.classId} classRow={classRow} />
                ))}
              </div>
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">오늘 운영 흐름</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center gap-2 rounded-lg bg-primary-soft p-3 text-primary-strong">
                      <Clock className="h-4 w-4" />
                      {data.classes[0]?.lessons[0]?.startTime || '-'} 첫 수업 시작
                    </div>
                    <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                      <span className="text-muted-foreground">과제 확인 반</span>
                      <strong>{data.classes.filter((row) => row.assignmentProgress.assignmentCount > 0).length}개</strong>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                      <span className="text-muted-foreground">출결 확인 필요</span>
                      <strong>{data.classes.reduce((sum, row) => sum + row.attendance.missing + row.attendance.absent + row.attendance.late + row.attendance.makeup, 0)}건</strong>
                    </div>
                  </CardContent>
                </Card>
                {data.adminAlerts && <AdminAlertsPanel alerts={data.adminAlerts} />}
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

export function AccountingOperationsPage() {
  const academyId = useAcademyId();
  const [month, setMonth] = useState(currentMonth());
  const [accountingTab, setAccountingTab] = useState<'payments' | 'payroll' | 'expenses'>('payments');
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payroll, setPayroll] = useState<InstructorPaymentRow[]>([]);
  const [payrollEstimates, setPayrollEstimates] = useState<InstructorPayrollEstimate[]>([]);
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

  const load = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId) return;
    if (options.background) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await loadAccountingOperationsOverview(academyId, month, { force: options.force });
      setRows(data.billing);
      setPayments(data.payments);
      setExpenses(data.expenses);
      setPayroll(data.payroll);
      setPayrollEstimates(data.payrollEstimates || []);
      setStaff(data.staff);
      setSelectedStudentId((current) => data.billing.some((row) => row.studentId === current) ? current : data.billing[0]?.studentId || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '청구 정보를 불러오지 못했습니다.');
    } finally {
      if (options.background) setRefreshing(false);
      else setLoading(false);
    }
  }, [academyId, month]);

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
    estimatedGrossAmount: payrollEstimates.reduce((sum, row) => sum + row.estimatedGrossAmount, 0),
    paidGrossAmount: payroll.filter((row) => row.status === 'paid').reduce((sum, row) => sum + row.grossAmount, 0),
    remainingEstimatedAmount: payrollEstimates.reduce((sum, row) => sum + row.remainingEstimatedAmount, 0),
  }), [payroll, payrollEstimates]);
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
  }), [
    payrollAdditionalAmount,
    payrollDeductionAmount,
    payrollHourlyRate,
    payrollHours,
    payrollWithholdingRate,
    payrollWithholdingType,
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
    setPayrollHours(estimate && estimate.completedMinutes > 0 ? String(hoursFromMinutes(estimate.completedMinutes)) : '');
    setPayrollHourlyRate(hourlyRate ? String(hourlyRate) : '');
    setPayrollDeductionAmount(estimate && estimate.paidGrossAmount > 0 ? String(estimate.paidGrossAmount) : '');
  };

  const changeMonth = (nextMonth: string) => {
    setMonth(nextMonth);
    setPaymentAmount('');
    resetPayrollDraft();
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
        withholdingType: payrollWithholdingType,
        withholdingRate: payrollWithholdingRate ? Number(payrollWithholdingRate) : undefined,
        hoursWorked: payrollHours ? Number(payrollHours) : null,
        hourlyRate: payrollHourlyRate ? Number(payrollHourlyRate) : instructor?.hourlyRate ?? null,
        paymentMethod: payrollMethod,
        status: 'paid',
        notes,
      });
      resetPayrollDraft();
      toast.success('강사 지급 기록을 저장했습니다.');
      await load({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강사 지급 기록 저장 실패');
    }
  };

  return (
    <PageShell
      title="회계"
      icon={CreditCard}
      action={<Input aria-label="회계 기준 월" type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="w-40" />}
    >
      <Tabs value={accountingTab} onValueChange={(value) => setAccountingTab(value as typeof accountingTab)} variant="underline">
        <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="payments"><CreditCard className="mr-2 h-4 w-4" />학생 수납</TabsTrigger>
          <TabsTrigger value="payroll"><Users className="mr-2 h-4 w-4" />강사 급여</TabsTrigger>
          <TabsTrigger value="expenses"><ReceiptText className="mr-2 h-4 w-4" />지출</TabsTrigger>
        </TabsList>
        <TabsContent value={accountingTab} className="space-y-5">

      {accountingTab === 'payments' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="예상 청구" value={currency(studentTotals.expected)} hint="계약·출결 기준" icon={CreditCard} />
          <MetricCard label="발행 청구" value={currency(studentTotals.invoiced)} hint="이번 달 청구서" icon={BookOpen} />
          <MetricCard label="수납" value={currency(studentTotals.paid)} hint="납부 반영액" icon={Activity} />
          <MetricCard label="미수" value={currency(studentTotals.outstanding)} hint="남은 청구액" icon={AlertTriangle} />
        </div>
      )}
      {accountingTab === 'payroll' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="완료 수업" value={hoursLabel(payrollTotals.completedMinutes)} hint={`${payrollTotals.completedLessonCount}회`} icon={Clock} />
          <MetricCard label="예상 총급여" value={currency(payrollTotals.estimatedGrossAmount)} hint="완료 시간 × 시급" icon={Users} />
          <MetricCard label="지급 총액" value={currency(payrollTotals.paidGrossAmount)} hint="세전 지급 기록" icon={CheckCircle2} />
          <MetricCard label="남은 예상액" value={currency(payrollTotals.remainingEstimatedAmount)} hint="예상액 - 지급액" icon={AlertTriangle} />
        </div>
      )}
      {accountingTab === 'expenses' && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="지출 합계" value={currency(expenseTotals.total)} hint="이번 달" icon={ReceiptText} />
          <MetricCard label="세무 반영" value={currency(expenseTotals.deductible)} hint="공제 대상 표시" icon={CheckCircle2} />
          <MetricCard label="증빙 미확인" value={`${expenseTotals.missingReceiptCount}건`} hint="영수증 확인 필요" icon={AlertTriangle} />
        </div>
      )}
      {loading ? <LoadingBlock /> : (
        <div className="space-y-5">
          {accountingTab === 'payments' && (
          <div className="grid gap-5 xl:grid-cols-[1.3fr_0.9fr]">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>학생별 청구 상태</CardTitle>
                <Button onClick={generate}>청구서 생성</Button>
              </CardHeader>
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
                            입금
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

            <Card>
              <CardHeader><CardTitle>입금 기록</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={submitPayment} className="space-y-3">
                  <div>
                    <Label>학생</Label>
                    <SelectField value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>
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
                  <Button type="submit" className="w-full" disabled={!selectedBillingRow}>입금 저장</Button>
                </form>
              </CardContent>
            </Card>
          </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[1.3fr_0.9fr]">
            {accountingTab === 'expenses' && (
            <Card>
              <CardHeader><CardTitle>지출 기록</CardTitle></CardHeader>
              <CardContent>
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
                  <Button type="submit" className="w-full">지출 저장</Button>
                </form>
              </CardContent>
            </Card>
            )}

            {accountingTab === 'payroll' && (<>
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
                        <TableHead className="px-4 py-3 font-medium">예상 급여</TableHead>
                        <TableHead className="px-4 py-3 font-medium">지급</TableHead>
                        <TableHead className="px-4 py-3 font-medium">남은 예상액</TableHead>
                        <TableHead className="px-4 py-3 font-medium">처리</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollEstimates.map((row) => (
                        <TableRow key={row.instructorId}>
                          <TableCell className="px-4 py-3 font-medium">{row.instructorName}</TableCell>
                          <TableCell className="px-4 py-3">
                            <div className="font-medium">완료 {row.completedLessonCount}/{row.scheduledLessonCount}회</div>
                            <div className="text-xs text-muted-foreground">{hoursLabel(row.completedMinutes)} / {hoursLabel(row.scheduledMinutes)}</div>
                          </TableCell>
                          <TableCell className="px-4 py-3 tabular-nums">
                            {row.hourlyRate ? currency(row.hourlyRate) : <span className="text-warning-foreground">시급 미설정</span>}
                          </TableCell>
                          <TableCell className="px-4 py-3 tabular-nums">{row.hourlyRate ? currency(row.estimatedGrossAmount) : '-'}</TableCell>
                          <TableCell className="px-4 py-3 tabular-nums">{currency(row.paidGrossAmount)}</TableCell>
                          <TableCell className="px-4 py-3 tabular-nums font-medium">{row.hourlyRate ? currency(row.remainingEstimatedAmount) : '-'}</TableCell>
                          <TableCell className="px-4 py-3">
                            <Button type="button" size="sm" variant="outline" onClick={() => selectPayrollInstructor(row.instructorId)}>
                              지급 작성
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {payrollEstimates.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="px-4 py-8 text-center text-muted-foreground">이번 달 강사 수업이나 시급 정보가 없습니다.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </DataTable>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>강사 지급</CardTitle></CardHeader>
              <CardContent>
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
                    <div><Label>차감·기지급</Label><Input type="number" min="0" step="1" value={payrollDeductionAmount} onChange={(event) => setPayrollDeductionAmount(event.target.value)} placeholder="기지급액·선지급·조정" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>원천징수</Label>
                      <SelectField value={payrollWithholdingType} onChange={(event) => setPayrollWithholdingType(event.target.value as WithholdingType)}>
                        <option value="freelance_3.3">프리랜서 3.3%</option>
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
                  <Button type="submit" className="w-full" disabled={payrollPreview.grossAmount <= 0 || (!payrollInstructorId && !payrollRecipientName.trim())}>지급 저장</Button>
                </form>
              </CardContent>
            </Card>
            </>)}
          </div>

          <div className="space-y-5">
            {accountingTab === 'payments' && (
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

            {accountingTab === 'expenses' && (
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

            {accountingTab === 'payroll' && (
            <Card>
              <CardHeader><CardTitle>강사 지급 내역</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {payroll.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-3">
                    <div>
                      <strong>{row.recipientName || row.instructorName || '-'}</strong>
                      <div className="text-xs text-muted-foreground">{row.paymentDate} · 원천 {currency(row.withholdingTax + row.localTax)}</div>
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
        </TabsContent>
      </Tabs>
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
  const defaultRange = useMemo(() => currentMonthRange(), []);
  const [taxIncomeRate, setTaxIncomeRate] = useState('3');
  const [taxLocalRate, setTaxLocalRate] = useState('0.3');
  const [vatRate, setVatRate] = useState('0');
  const [savingTax, setSavingTax] = useState(false);
  const [exportType, setExportType] = useState<AdminExportType>('tax');
  const [exportStartDate, setExportStartDate] = useState(defaultRange.startDate);
  const [exportEndDate, setExportEndDate] = useState(defaultRange.endDate);
  const [includeRevenue, setIncludeRevenue] = useState(true);
  const [includePayroll, setIncludePayroll] = useState(true);
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [includeProfitLoss, setIncludeProfitLoss] = useState(true);
  const [exporting, setExporting] = useState(false);
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

  const executeTaxSettingsSave = async () => {
    setSavingTax(true);
    try {
      await updateTaxSettings(academyId, {
        payroll_income_tax_rate: taxIncomeRate,
        payroll_local_tax_rate: taxLocalRate,
        sales_vat_rate: vatRate,
      });
      toast.success('세금 기준을 저장했습니다.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '세금 기준 저장에 실패했습니다.');
    } finally {
      setSavingTax(false);
    }
  };

  const requestTaxSettingsSave = (event: React.FormEvent) => {
    event.preventDefault();
    setPendingAdminAction({
      title: '세금/급여 기준 저장',
      description: '세금과 급여 기준은 회계 리포트에 영향을 줍니다. 계속하려면 비밀번호를 입력하세요.',
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
      description: '회계/급여 CSV에는 민감한 운영 데이터가 포함됩니다. 계속하려면 비밀번호를 입력하세요.',
      confirmLabel: 'CSV 생성',
      onConfirm: executeExport,
    });
  };

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
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
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

          <Card>
            <CardHeader><CardTitle>세금/급여 기준</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={requestTaxSettingsSave} className="space-y-3">
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
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
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
              <Button type="button" onClick={requestExport} disabled={exporting}>
                {exporting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                CSV 생성
              </Button>
            </CardContent>
          </Card>

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
