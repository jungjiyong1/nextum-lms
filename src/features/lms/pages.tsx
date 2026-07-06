'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  CreditCard,
  Download,
  GraduationCap,
  Plus,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canManageScheduleRules, requiresAssignedClassScope } from '@/core/auth/roles';
import { cn } from '@/lib/utils';
import { applyAssignedClassScope } from './classScope';
import {
  createClass,
  createBook,
  createScheduleRule,
  createClassroom,
  createStaff,
  createStudent,
  createStudentInvitation,
  exportAdminCsv,
  generateMonthlyInvoices,
  getDashboardData,
  listAttendance,
  listBilling,
  listBooks,
  listClassBooks,
  listClassStudents,
  listClassSummaries,
  listClassrooms,
  listExpenses,
  listInstructorPayments,
  listPayments,
  listSchedule,
  listScheduleRules,
  listStaff,
  listStudents,
  listWeakTypes,
  prepareAdminReset,
  recordAttendance,
  recordPayment,
  resetAdminData,
  setClassBook,
  updateClass,
  updateBook,
  updateClassroom,
  updateLessonOccurrence,
  updateScheduleRule,
  updateStudent,
  updateStaff,
  updateTaxSettings,
  createExpense,
  createInstructorPayment,
} from './service';
import { isPaidInvoiceStatus } from './status';
import type {
  AdminExportType,
  AdminResetTarget,
  AttendanceRow,
  AttendanceStatus,
  BillingMode,
  BillingRow,
  BookSummary,
  ClassStatus,
  ClassBookSummary,
  ClassStudentSummary,
  ClassSummary,
  ClassroomSummary,
  DashboardData,
  ExpenseRow,
  InstructorPaymentRow,
  LessonOccurrenceStatus,
  PaymentRow,
  ScheduleItem,
  ScheduleRuleSummary,
  StaffRole,
  StaffSummary,
  StaffStatus,
  StudentStatus,
  StudentSummary,
  WithholdingType,
} from './types';

type CreateStaffRole = StaffRole;

const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];

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

function addDaysString(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currency(value: number | null | undefined): string {
  return `${Math.round(value || 0).toLocaleString()}원`;
}

function durationMinutes(item: ScheduleItem | null): number {
  if (!item) return 0;
  const [startHour, startMinute] = item.startTime.split(':').map(Number);
  const [endHour, endMinute] = item.endTime.split(':').map(Number);
  return Math.max(0, endHour * 60 + endMinute - (startHour * 60 + startMinute));
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

function attendanceStatusLabel(status: AttendanceStatus): string {
  const labels: Record<AttendanceStatus, string> = {
    present: '출석',
    late: '지각',
    absent: '결석',
    excused: '인정 결석',
    makeup: '보강',
  };
  return labels[status];
}

function lessonStatusLabel(status: LessonOccurrenceStatus): string {
  const labels: Record<LessonOccurrenceStatus, string> = {
    scheduled: '예정',
    completed: '완료',
    cancelled: '취소',
    makeup: '보강',
    substitute: '대강',
  };
  return labels[status];
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

function PageShell({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 lg:p-8">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
            <p className="text-sm text-slate-500">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed bg-white">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        데이터를 불러오는 중입니다.
      </div>
    </div>
  );
}

function MissingAcademy() {
  return (
    <div className="mx-auto flex h-full max-w-xl items-center justify-center p-8">
      <Card>
        <CardHeader>
          <CardTitle>학원 연결이 필요합니다</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          현재 계정에 연결된 academy가 없습니다. 개발 환경에서는 `npm run seed:dev-admin`으로 관리자 계정을 먼저 생성하세요.
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-6 text-center">
      <AlertTriangle className="h-7 w-7 text-red-600" />
      <p className="text-sm font-medium text-red-800">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
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
  return (
    <Card className="border-slate-200">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{hint}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    active: '운영',
    inactive: '중지',
    on_leave: '휴원',
    graduated: '졸업',
    dropped: '퇴원',
    archived: '보관',
    weak: '취약',
    watch: '관찰',
    insufficient: '표본 부족',
    ok: '양호',
    issued: '청구',
    paid: '완납',
    partial: '부분 납부',
    overdue: '연체',
    not_issued: '미발행',
    scheduled: '예정',
    completed: '완료',
    pending: '대기',
    failed: '실패',
    refunded: '환불',
    cancelled: '취소',
    present: '출석',
    late: '지각',
    absent: '결석',
    excused: '인정 결석',
    makeup: '보강',
  };

  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
        ['weak', 'overdue', 'cancelled', 'absent', 'failed', 'dropped'].includes(status) && 'bg-red-50 text-red-700',
        ['watch', 'partial', 'issued', 'late', 'makeup'].includes(status) && 'bg-amber-50 text-amber-700',
        ['active', 'paid', 'ok', 'completed', 'scheduled', 'present'].includes(status) && 'bg-emerald-50 text-emerald-700',
        ['not_issued', 'inactive', 'archived', 'insufficient', 'excused', 'pending', 'refunded', 'on_leave', 'graduated'].includes(status) && 'bg-slate-100 text-slate-600',
      )}
    >
      {label[status] || status}
    </span>
  );
}

function SelectBox(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn('h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring', props.className)}
    />
  );
}

export function LearningHomePage() {
  const academyId = useAcademyId();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getDashboardData(academyId, month));
    } catch (err) {
      const message = err instanceof Error ? err.message : '대시보드를 불러오지 못했습니다.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [academyId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!academyId) return <MissingAcademy />;

  const weakCount = data?.weakTypes.filter((row) => row.status === 'weak').length || 0;
  const unpaid = data?.billing.filter((row) => !isPaidInvoiceStatus(row.status) && row.invoicedAmount > 0).length || 0;

  return (
    <PageShell
      title="운영 대시보드"
      description="반, 학생, 학습 취약점, 청구 상태를 한 화면에서 확인합니다."
      icon={BarChart3}
      action={
        <div className="flex items-center gap-2">
          <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" />
          <Button variant="outline" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" />
            새로고침
          </Button>
        </div>
      }
    >
      {loading && <LoadingBlock />}
      {error && !loading && <ErrorBlock message={error} onRetry={load} />}
      {data && !loading && !error && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="운영 반" value={`${data.classes.length}개`} hint="활성 class 기준" icon={BookOpen} />
            <MetricCard label="등록 학생" value={`${data.students.length}명`} hint="학생 원장 기준" icon={GraduationCap} />
            <MetricCard label="취약 유형" value={`${weakCount}개`} hint="채점 데이터 기반" icon={AlertTriangle} />
            <MetricCard label="AI 대화" value={`${data.aiConversationCount}건`} hint="최근 30일" icon={Activity} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>우선 확인할 취약 유형</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">학생</th>
                        <th className="px-4 py-3 font-medium">유형</th>
                        <th className="px-4 py-3 font-medium">점수</th>
                        <th className="px-4 py-3 font-medium">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y bg-white">
                      {data.weakTypes.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                            표시할 취약 유형 데이터가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        data.weakTypes.map((row) => (
                          <tr key={`${row.studentId}-${row.typeName}`} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium">{row.studentName}</td>
                            <td className="px-4 py-3 text-slate-600">{row.typeName}</td>
                            <td className="px-4 py-3 tabular-nums">{row.score === null ? '-' : `${row.score}%`}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={row.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>이번 달 운영 알림</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-600">미납 또는 미발행</span>
                  <strong>{unpaid}명</strong>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-600">학습 위험 학생</span>
                  <strong>{new Set(data.weakTypes.map((row) => row.studentId)).size}명</strong>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-600">반별 취약 유형 합계</span>
                  <strong>{data.classes.reduce((sum, row) => sum + row.weakTypeCount, 0)}개</strong>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}

export function ClassesPage() {
  const academyId = useAcademyId();
  const { profile } = useAuth();
  const staffMemberId = profile?.staff_member_id ?? null;
  const shouldUseAssignedClassScope = requiresAssignedClassScope(profile?.role);
  const canManageClassSetup = canManageScheduleRules(profile?.role);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [scheduleRules, setScheduleRules] = useState<ScheduleRuleSummary[]>([]);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [classBooks, setClassBooks] = useState<ClassBookSummary[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudentSummary[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingClassId, setEditingClassId] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [classStatus, setClassStatus] = useState<ClassStatus>('active');
  const [capacity, setCapacity] = useState('');
  const [classColor, setClassColor] = useState('#059669');
  const [defaultInstructorId, setDefaultInstructorId] = useState('');
  const [defaultClassroomId, setDefaultClassroomId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [editingClassroomId, setEditingClassroomId] = useState('');
  const [classroomName, setClassroomName] = useState('');
  const [classroomCapacity, setClassroomCapacity] = useState('');
  const [classroomColor, setClassroomColor] = useState('#64748b');
  const [classroomActive, setClassroomActive] = useState(true);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [ruleActive, setRuleActive] = useState(true);
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('18:00');
  const [startDate, setStartDate] = useState(today());
  const [ruleEndDate, setRuleEndDate] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [editingBookId, setEditingBookId] = useState('');
  const [bookKey, setBookKey] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [bookSubject, setBookSubject] = useState('');
  const [bookGrade, setBookGrade] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [lessonStatus, setLessonStatus] = useState<LessonOccurrenceStatus>('scheduled');
  const [lessonCancelReason, setLessonCancelReason] = useState('');
  const [attendanceStudentId, setAttendanceStudentId] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>('present');
  const [attendedMinutes, setAttendedMinutes] = useState('');
  const [billableMinutes, setBillableMinutes] = useState('');
  const [attendanceNotes, setAttendanceNotes] = useState('');

  const loadBase = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      const rangeStart = today();
      const rangeEnd = addDaysString(rangeStart, 14);
      const [classRows, scheduleRows, ruleRows, bookRows, attendanceRows, staffRows, classroomRows] = await Promise.all([
        listClassSummaries(academyId),
        listSchedule(academyId, rangeStart, rangeEnd),
        listScheduleRules(academyId),
        listBooks(academyId),
        listAttendance(academyId, rangeStart, rangeEnd),
        listStaff(academyId),
        listClassrooms(academyId),
      ]);
      const scoped = shouldUseAssignedClassScope
        ? applyAssignedClassScope({
          staffMemberId,
          classes: classRows,
          schedule: scheduleRows,
          scheduleRules: ruleRows,
          attendance: attendanceRows,
        })
        : {
          classes: classRows,
          schedule: scheduleRows,
          scheduleRules: ruleRows,
          attendance: attendanceRows,
        };

      setClasses(scoped.classes);
      setSchedule(scoped.schedule);
      setScheduleRules(scoped.scheduleRules);
      setBooks(bookRows);
      setAttendance(scoped.attendance);
      setStaff(staffRows);
      setClassrooms(classroomRows);
      setSelectedClassId((current) => (current && scoped.classes.some((row) => row.id === current) ? current : scoped.classes[0]?.id || ''));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [academyId, shouldUseAssignedClassScope, staffMemberId]);

  const loadClassDetail = useCallback(async () => {
    if (!academyId || !selectedClassId) {
      setClassStudents([]);
      setClassBooks([]);
      return;
    }
    setDetailLoading(true);
    try {
      const [studentsRows, bookRows] = await Promise.all([
        listClassStudents(academyId, selectedClassId),
        listClassBooks(selectedClassId),
      ]);
      setClassStudents(studentsRows);
      setClassBooks(bookRows);
      setAttendanceStudentId((current) => current || studentsRows[0]?.id || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 상세 정보를 불러오지 못했습니다.');
    } finally {
      setDetailLoading(false);
    }
  }, [academyId, selectedClassId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadClassDetail();
  }, [loadClassDetail]);

  const selectedClass = classes.find((row) => row.id === selectedClassId) || null;
  const classSchedule = useMemo(
    () => schedule.filter((item) => item.classId === selectedClassId),
    [schedule, selectedClassId],
  );
  const classRules = useMemo(
    () => scheduleRules.filter((item) => item.classId === selectedClassId),
    [scheduleRules, selectedClassId],
  );
  const selectedSchedule = classSchedule.find((item) => item.id === selectedScheduleId) || classSchedule[0] || null;
  const selectedDuration = durationMinutes(selectedSchedule);
  const classAttendance = attendance.filter((row) => row.classId === selectedClassId);

  useEffect(() => {
    if (!classSchedule.some((item) => item.id === selectedScheduleId)) {
      setSelectedScheduleId(classSchedule[0]?.id || '');
    }
  }, [classSchedule, selectedScheduleId]);

  useEffect(() => {
    if (selectedSchedule) {
      setLessonStatus(selectedSchedule.status);
      setLessonCancelReason(selectedSchedule.cancelReason || '');
    } else {
      setLessonStatus('scheduled');
      setLessonCancelReason('');
    }
  }, [selectedSchedule]);

  useEffect(() => {
    if (!classStudents.some((student) => student.id === attendanceStudentId)) {
      setAttendanceStudentId(classStudents[0]?.id || '');
    }
  }, [attendanceStudentId, classStudents]);

  if (!academyId) return <MissingAcademy />;

  const resetClassForm = () => {
    setEditingClassId('');
    setName('');
    setGrade('');
    setClassStatus('active');
    setCapacity('');
    setClassColor('#059669');
    setDefaultInstructorId('');
    setDefaultClassroomId('');
  };

  const editClass = (row: ClassSummary) => {
    setEditingClassId(row.id);
    setSelectedClassId(row.id);
    setName(row.name);
    setGrade(row.grade || '');
    setClassStatus((row.status as ClassStatus) || (row.active ? 'active' : 'inactive'));
    setCapacity(row.capacity === null ? '' : String(row.capacity));
    setClassColor(row.color || '#059669');
    setDefaultInstructorId(row.defaultInstructorId || '');
    setDefaultClassroomId(row.defaultClassroomId || '');
  };

  const resetClassroomForm = () => {
    setEditingClassroomId('');
    setClassroomName('');
    setClassroomCapacity('');
    setClassroomColor('#64748b');
    setClassroomActive(true);
  };

  const editClassroom = (row: ClassroomSummary) => {
    setEditingClassroomId(row.id);
    setClassroomName(row.name);
    setClassroomCapacity(row.capacity === null ? '' : String(row.capacity));
    setClassroomColor(row.color || '#64748b');
    setClassroomActive(row.active);
  };

  const submitClassroom = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        name: classroomName,
        capacity: classroomCapacity ? Number(classroomCapacity) : null,
        color: classroomColor || null,
      };
      if (editingClassroomId) {
        await updateClassroom(academyId, editingClassroomId, { ...payload, active: classroomActive });
        toast.success('강의실을 수정했습니다.');
      } else {
        await createClassroom(academyId, payload);
        toast.success('강의실을 추가했습니다.');
      }
      resetClassroomForm();
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강의실 저장 실패');
    }
  };

  const resetRuleForm = () => {
    setEditingRuleId('');
    setRuleActive(true);
    setDayOfWeek(0);
    setStartTime('16:00');
    setEndTime('18:00');
    setStartDate(today());
    setRuleEndDate('');
  };

  const editRule = (row: ScheduleRuleSummary) => {
    setEditingRuleId(row.id);
    setSelectedClassId(row.classId);
    setRuleActive(row.active);
    setDayOfWeek(row.dayOfWeek);
    setStartTime(row.startTime);
    setEndTime(row.endTime);
    setStartDate(row.startDate);
    setRuleEndDate(row.endDate || '');
  };

  const stopRule = async (row: ScheduleRuleSummary) => {
    try {
      await updateScheduleRule(academyId, row.id, {
        classId: row.classId,
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
        startDate: row.startDate,
        endDate: row.endDate,
        active: false,
      });
      toast.success('반복 시간표를 중지했습니다.');
      if (editingRuleId === row.id) resetRuleForm();
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반복 시간표 중지 실패');
    }
  };

  const submitClass = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        name,
        grade: grade || null,
        capacity: capacity ? Number(capacity) : null,
        color: classColor || null,
        defaultInstructorId: defaultInstructorId || null,
        defaultClassroomId: defaultClassroomId || null,
      };
      if (editingClassId) {
        await updateClass(academyId, editingClassId, {
          ...payload,
          status: classStatus,
          active: classStatus === 'active',
        });
        toast.success('반 정보를 수정했습니다.');
      } else {
        await createClass(academyId, payload);
        toast.success('반을 추가했습니다.');
      }
      resetClassForm();
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 저장 실패');
    }
  };

  const submitRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedClassId) {
      toast.error('시간표를 추가할 반을 선택하세요.');
      return;
    }
    try {
      const payload = {
        classId: selectedClassId,
        dayOfWeek,
        startTime,
        endTime,
        startDate,
        endDate: ruleEndDate || null,
      };
      if (editingRuleId) {
        await updateScheduleRule(academyId, editingRuleId, { ...payload, active: ruleActive });
        resetRuleForm();
      } else {
        await createScheduleRule(academyId, payload);
        resetRuleForm();
      }
      toast.success('반 시간표를 추가했습니다.');
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시간표 추가 실패');
    }
  };

  const submitBook = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await setClassBook(academyId, selectedClassId, selectedBookId, true);
      toast.success('교재를 배정했습니다.');
      setSelectedBookId('');
      await loadClassDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '교재 배정 실패');
    }
  };

  const removeBook = async (bookId: string) => {
    try {
      await setClassBook(academyId, selectedClassId, bookId, false);
      toast.success('교재 배정을 해제했습니다.');
      await loadClassDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '교재 배정 해제 실패');
    }
  };

  const resetBookForm = () => {
    setEditingBookId('');
    setBookKey('');
    setBookTitle('');
    setBookSubject('');
    setBookGrade('');
  };

  const editBook = (book: BookSummary) => {
    setEditingBookId(book.id);
    setBookKey(book.bookKey);
    setBookTitle(book.title);
    setBookSubject(book.subject || '');
    setBookGrade(book.grade || '');
  };

  const submitBookRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        title: bookTitle,
        subject: bookSubject || null,
        grade: bookGrade || null,
      };
      if (editingBookId) {
        await updateBook(academyId, editingBookId, payload);
        toast.success('교재 정보를 수정했습니다.');
      } else {
        await createBook(academyId, { ...payload, bookKey: bookKey || null });
        toast.success('교재를 추가했습니다.');
      }
      resetBookForm();
      await loadBase();
      await loadClassDetail();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '교재 저장 실패');
    }
  };

  const submitAttendance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchedule || !attendanceStudentId) {
      toast.error('수업과 학생을 선택하세요.');
      return;
    }
    try {
      await recordAttendance(academyId, {
        occurrenceId: selectedSchedule.actualId,
        classId: selectedSchedule.classId,
        ruleId: selectedSchedule.ruleId,
        date: selectedSchedule.date,
        startTime: selectedSchedule.startTime,
        endTime: selectedSchedule.endTime,
        studentId: attendanceStudentId,
        status: attendanceStatus,
        attendedMinutes: attendedMinutes ? Number(attendedMinutes) : null,
        billableMinutes: billableMinutes ? Number(billableMinutes) : null,
        notes: attendanceNotes || null,
      });
      toast.success('출결을 기록했습니다.');
      setAttendanceNotes('');
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '출결 기록 실패');
    }
  };

  const submitLessonStatus = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchedule) {
      toast.error('수업을 선택하세요.');
      return;
    }
    try {
      await updateLessonOccurrence(academyId, {
        occurrenceId: selectedSchedule.actualId,
        classId: selectedSchedule.classId,
        ruleId: selectedSchedule.ruleId,
        date: selectedSchedule.date,
        startTime: selectedSchedule.startTime,
        endTime: selectedSchedule.endTime,
        status: lessonStatus,
        cancelReason: lessonCancelReason || null,
      });
      toast.success('수업 상태를 저장했습니다.');
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수업 상태 저장 실패');
    }
  };

  return (
    <PageShell title="반 / 시간표" description="반, 교재, 수업 일정, 출결을 같은 흐름에서 관리합니다." icon={CalendarDays}>
      {loading && <LoadingBlock />}
      {!loading && (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle>반 목록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {classes.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedClassId(row.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg border bg-white p-4 text-left transition hover:border-emerald-300',
                    selectedClassId === row.id && 'border-emerald-500 bg-emerald-50/50',
                  )}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: row.color || '#d1d5db' }} />
                      <span className="font-semibold">{row.name}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {row.grade || '학년 미지정'} · 학생 {row.studentCount}명 · 정원 {row.capacity ?? '-'}명 · 취약 유형 {row.weakTypeCount}개
                    </p>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <div>{row.instructorName || '강사 미지정'}</div>
                    <div>{row.classroomName || '강의실 미지정'}</div>
                  </div>
                </button>
              ))}
              {classes.length === 0 && <p className="py-8 text-center text-sm text-slate-400">등록된 반이 없습니다.</p>}
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{editingClassId ? '반 수정' : '반 추가'}</CardTitle>
              </CardHeader>
              <CardContent>
                {canManageClassSetup && selectedClass && !editingClassId && (
                  <Button type="button" variant="outline" className="mb-3 w-full" onClick={() => editClass(selectedClass)}>
                    선택한 반 수정
                  </Button>
                )}
                <form onSubmit={submitClass} className="space-y-3">
                  <div>
                    <Label htmlFor="class-name">반 이름</Label>
                    <Input id="class-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="중1 A반" />
                  </div>
                  <div>
                    <Label htmlFor="class-grade">학년/레벨</Label>
                    <Input id="class-grade" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중1" />
                  </div>
                  {editingClassId && (
                    <div>
                      <Label>상태</Label>
                      <SelectBox value={classStatus} onChange={(event) => setClassStatus(event.target.value as ClassStatus)}>
                        <option value="active">운영</option>
                        <option value="inactive">중지</option>
                        <option value="archived">보관</option>
                      </SelectBox>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>정원</Label>
                      <Input type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
                    </div>
                    <div>
                      <Label>색상</Label>
                      <Input type="color" value={classColor} onChange={(event) => setClassColor(event.target.value)} className="h-10 p-1" />
                    </div>
                  </div>
                  <div>
                    <Label>담당강사</Label>
                    <SelectBox value={defaultInstructorId} onChange={(event) => setDefaultInstructorId(event.target.value)}>
                      <option value="">미지정</option>
                      {staff.filter((row) => row.status === 'active').map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </SelectBox>
                  </div>
                  <div>
                    <Label>기본 강의실</Label>
                    <SelectBox value={defaultClassroomId} onChange={(event) => setDefaultClassroomId(event.target.value)}>
                      <option value="">미지정</option>
                      {classrooms.filter((row) => row.active).map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </SelectBox>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="submit" className="w-full" disabled={!canManageClassSetup}>
                      <Plus className="mr-2 h-4 w-4" />
                      {editingClassId ? '수정 저장' : '반 생성'}
                    </Button>
                    <Button type="button" variant="outline" className="w-full" onClick={resetClassForm}>
                      새 입력
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{editingClassroomId ? '강의실 수정' : '강의실 추가'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitClassroom} className="space-y-3">
                  <div>
                    <Label>강의실명</Label>
                    <Input value={classroomName} onChange={(event) => setClassroomName(event.target.value)} placeholder="1강의실" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>정원</Label>
                      <Input type="number" min="0" value={classroomCapacity} onChange={(event) => setClassroomCapacity(event.target.value)} />
                    </div>
                    <div>
                      <Label>색상</Label>
                      <Input type="color" value={classroomColor} onChange={(event) => setClassroomColor(event.target.value)} className="h-10 p-1" />
                    </div>
                  </div>
                  {editingClassroomId && (
                    <div>
                      <Label>상태</Label>
                      <SelectBox value={classroomActive ? 'active' : 'inactive'} onChange={(event) => setClassroomActive(event.target.value === 'active')}>
                        <option value="active">운영</option>
                        <option value="inactive">중지</option>
                      </SelectBox>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="submit" className="w-full" disabled={!canManageClassSetup}>{editingClassroomId ? '강의실 수정' : '강의실 추가'}</Button>
                    <Button type="button" variant="outline" className="w-full" onClick={resetClassroomForm}>새 입력</Button>
                  </div>
                </form>
                <div className="mt-4 space-y-2">
                  {classrooms.map((room) => (
                    <div key={room.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm">
                      <div>
                        <div className="flex items-center gap-2 font-medium">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: room.color || '#94a3b8' }} />
                          {room.name}
                        </div>
                        <div className="text-xs text-slate-500">정원 {room.capacity ?? '-'}명</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={room.active ? 'active' : 'inactive'} />
                        {canManageClassSetup && <Button type="button" variant="outline" size="sm" onClick={() => editClassroom(room)}>수정</Button>}
                      </div>
                    </div>
                  ))}
                  {classrooms.length === 0 && (
                    <p className="rounded-lg border bg-white p-3 text-sm text-slate-400">등록된 강의실이 없습니다.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>반복 시간표 추가</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitRule} className="space-y-3">
                  <div>
                    <Label>반</Label>
                    <SelectBox value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)}>
                      {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                    </SelectBox>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label>요일</Label>
                      <SelectBox value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>
                        {dayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
                      </SelectBox>
                    </div>
                    <div>
                      <Label>시작</Label>
                      <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                    </div>
                    <div>
                      <Label>종료</Label>
                      <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label>시작일</Label>
                    <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>종료일</Label>
                      <Input type="date" value={ruleEndDate} onChange={(event) => setRuleEndDate(event.target.value)} />
                    </div>
                    <div>
                      <Label>상태</Label>
                      <SelectBox value={ruleActive ? 'active' : 'inactive'} onChange={(event) => setRuleActive(event.target.value === 'active')}>
                        <option value="active">운영</option>
                        <option value="inactive">중지</option>
                      </SelectBox>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="submit" className="w-full" disabled={!canManageClassSetup}>{editingRuleId ? '시간표 수정' : '시간표 추가'}</Button>
                    <Button type="button" variant="outline" className="w-full" onClick={resetRuleForm}>새 입력</Button>
                  </div>
                </form>
                <div className="mt-4 space-y-2">
                  {classRules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm">
                      <div>
                        <div className="font-medium">
                          {dayLabels[rule.dayOfWeek]} {rule.startTime}-{rule.endTime}
                        </div>
                        <div className="text-xs text-slate-500">
                          {rule.startDate}부터{rule.endDate ? ` ${rule.endDate}까지` : ''} · {rule.instructorName || '-'} · {rule.classroomName || '-'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={rule.active ? 'active' : 'inactive'} />
                        {canManageClassSetup && <Button type="button" variant="outline" size="sm" onClick={() => editRule(rule)}>수정</Button>}
                        {canManageClassSetup && rule.active && <Button type="button" variant="outline" size="sm" onClick={() => stopRule(rule)}>중지</Button>}
                      </div>
                    </div>
                  ))}
                  {classRules.length === 0 && (
                    <p className="rounded-lg border bg-white p-3 text-sm text-slate-400">등록된 반복 시간표가 없습니다.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>{selectedClass ? `${selectedClass.name} 운영` : '반 운영'}</CardTitle>
            </CardHeader>
            <CardContent>
              {detailLoading ? (
                <LoadingBlock />
              ) : (
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-slate-700">재원 학생</div>
                    <div className="rounded-lg border bg-white">
                      {classStudents.length === 0 ? (
                        <p className="p-4 text-sm text-slate-400">배정된 학생이 없습니다.</p>
                      ) : (
                        classStudents.map((student) => (
                          <div key={student.id} className="flex items-center justify-between border-b px-4 py-3 last:border-0">
                            <span className="text-sm font-medium">{student.name}</span>
                            <StatusBadge status={student.status} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-medium text-slate-700">교재 배정</div>
                    <form onSubmit={submitBook} className="flex gap-2">
                      <SelectBox value={selectedBookId} onChange={(event) => setSelectedBookId(event.target.value)}>
                        <option value="">교재 선택</option>
                        {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
                      </SelectBox>
                      <Button type="submit" disabled={!canManageClassSetup || !selectedClassId || !selectedBookId}>배정</Button>
                    </form>
                    <form onSubmit={submitBookRecord} className="space-y-2 rounded-lg border bg-white p-3">
                      <div className="text-sm font-medium text-slate-700">{editingBookId ? '교재 수정' : '교재 추가'}</div>
                      <Input value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder="교재명" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={bookSubject} onChange={(event) => setBookSubject(event.target.value)} placeholder="과목" />
                        <Input value={bookGrade} onChange={(event) => setBookGrade(event.target.value)} placeholder="학년" />
                      </div>
                      <Input
                        value={bookKey}
                        onChange={(event) => setBookKey(event.target.value)}
                        placeholder="book key 자동 생성"
                        disabled={Boolean(editingBookId)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="submit" className="w-full" disabled={!canManageClassSetup}>{editingBookId ? '교재 수정' : '교재 추가'}</Button>
                        <Button type="button" variant="outline" className="w-full" onClick={resetBookForm}>새 입력</Button>
                      </div>
                    </form>
                    <div className="rounded-lg border bg-white">
                      {classBooks.length === 0 ? (
                        <p className="p-4 text-sm text-slate-400">배정된 교재가 없습니다.</p>
                      ) : (
                        classBooks.map((book) => (
                          <div key={book.id} className="flex items-center justify-between border-b px-4 py-3 last:border-0">
                            <div>
                              <div className="text-sm font-medium">{book.title}</div>
                              <div className="text-xs text-slate-400">{book.subject || '-'} · {book.grade || '-'}</div>
                            </div>
                            <div className="flex gap-2">
                              {canManageClassSetup && <Button type="button" variant="outline" size="sm" onClick={() => editBook(book)}>수정</Button>}
                              {canManageClassSetup && (
                                <Button type="button" variant="outline" size="sm" onClick={() => removeBook(book.id)}>
                                  해제
                                </Button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-sm font-medium text-slate-700">출결 기록</div>
                    <form onSubmit={submitAttendance} className="space-y-2 rounded-lg border bg-white p-3">
                      <SelectBox value={selectedSchedule?.id || ''} onChange={(event) => setSelectedScheduleId(event.target.value)}>
                        {classSchedule.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.date} {item.startTime}-{item.endTime}
                          </option>
                        ))}
                      </SelectBox>
                      <SelectBox value={attendanceStudentId} onChange={(event) => setAttendanceStudentId(event.target.value)}>
                        {classStudents.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                      </SelectBox>
                      <div className="grid grid-cols-3 gap-2">
                        <SelectBox value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value as AttendanceStatus)}>
                          {(['present', 'late', 'absent', 'excused', 'makeup'] as AttendanceStatus[]).map((status) => (
                            <option key={status} value={status}>{attendanceStatusLabel(status)}</option>
                          ))}
                        </SelectBox>
                        <Input
                          type="number"
                          min="0"
                          placeholder={`출석 ${selectedDuration}`}
                          value={attendedMinutes}
                          onChange={(event) => setAttendedMinutes(event.target.value)}
                        />
                        <Input
                          type="number"
                          min="0"
                          placeholder={`청구 ${selectedDuration}`}
                          value={billableMinutes}
                          onChange={(event) => setBillableMinutes(event.target.value)}
                        />
                      </div>
                      <Input value={attendanceNotes} onChange={(event) => setAttendanceNotes(event.target.value)} placeholder="메모" />
                      <Button type="submit" className="w-full" disabled={!selectedSchedule || !attendanceStudentId}>출결 저장</Button>
                    </form>
                    <form onSubmit={submitLessonStatus} className="space-y-2 rounded-lg border bg-white p-3">
                      <div className="text-sm font-medium text-slate-700">수업 상태</div>
                      <SelectBox value={lessonStatus} onChange={(event) => setLessonStatus(event.target.value as LessonOccurrenceStatus)}>
                        {(['scheduled', 'completed', 'cancelled', 'makeup', 'substitute'] as LessonOccurrenceStatus[]).map((status) => (
                          <option key={status} value={status}>{lessonStatusLabel(status)}</option>
                        ))}
                      </SelectBox>
                      <Input
                        value={lessonCancelReason}
                        onChange={(event) => setLessonCancelReason(event.target.value)}
                        placeholder="취소 사유 또는 운영 메모"
                      />
                      <Button type="submit" variant="outline" className="w-full" disabled={!selectedSchedule}>수업 상태 저장</Button>
                    </form>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>앞으로 2주 수업</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">일자</th>
                      <th className="px-4 py-3 font-medium">시간</th>
                      <th className="px-4 py-3 font-medium">반</th>
                      <th className="px-4 py-3 font-medium">강사/강의실</th>
                      <th className="px-4 py-3 font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y bg-white">
                    {schedule.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">{item.date}</td>
                        <td className="px-4 py-3 tabular-nums">{item.startTime} - {item.endTime}</td>
                        <td className="px-4 py-3 font-medium">{item.className}</td>
                        <td className="px-4 py-3 text-slate-500">{item.instructorName || '-'} · {item.classroomName || '-'}</td>
                        <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                      </tr>
                    ))}
                    {schedule.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">예정된 수업이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>최근 출결</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">일자</th>
                      <th className="px-4 py-3 font-medium">학생</th>
                      <th className="px-4 py-3 font-medium">상태</th>
                      <th className="px-4 py-3 font-medium">출석/청구</th>
                      <th className="px-4 py-3 font-medium">메모</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y bg-white">
                    {classAttendance.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3">{row.date}</td>
                        <td className="px-4 py-3 font-medium">{row.studentName}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-4 py-3 text-slate-600">{row.attendedMinutes ?? 0}분 / {row.billableMinutes ?? 0}분</td>
                        <td className="px-4 py-3 text-slate-500">{row.notes || '-'}</td>
                      </tr>
                    ))}
                    {classAttendance.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">기록된 출결이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

export function StudentsOperationsPage() {
  const academyId = useAcademyId();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingStudentId, setEditingStudentId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [grade, setGrade] = useState('');
  const [studentStatus, setStudentStatus] = useState<StudentStatus>('active');
  const [billingMode, setBillingMode] = useState<BillingMode>('monthly_plus_classes');
  const [baseFee, setBaseFee] = useState('0');
  const [hourlyRate, setHourlyRate] = useState('');
  const [extraClassFee, setExtraClassFee] = useState('0');
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [inviteCodes, setInviteCodes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      const [studentRows, classRows] = await Promise.all([listStudents(academyId), listClassSummaries(academyId)]);
      setStudents(studentRows);
      setClasses(classRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '학생 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [academyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!academyId) return <MissingAcademy />;

  const resetStudentForm = () => {
    setEditingStudentId('');
    setName('');
    setPhone('');
    setParentPhone('');
    setGrade('');
    setStudentStatus('active');
    setBillingMode('monthly_plus_classes');
    setBaseFee('0');
    setHourlyRate('');
    setExtraClassFee('0');
    setSelectedClassIds(new Set());
  };

  const editStudent = (student: StudentSummary) => {
    setEditingStudentId(student.id);
    setName(student.name);
    setPhone(student.phone || '');
    setParentPhone(student.parentPhone || '');
    setGrade(student.grade || '');
    setStudentStatus(student.status);
    setBillingMode(student.billingMode || 'monthly_plus_classes');
    setBaseFee(String(student.baseMonthlyFee || 0));
    setHourlyRate(student.hourlyRate === null ? '' : String(student.hourlyRate));
    setExtraClassFee(String(student.extraClassFee || 0));
    setSelectedClassIds(new Set(student.classIds));
  };

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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

    try {
      const payload = {
        name,
        phone,
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
      } else {
        await createStudent(academyId, payload);
        toast.success('학생을 등록했습니다.');
      }
      resetStudentForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '학생 저장 실패');
    }
  };

  const issueInvite = async (studentId: string) => {
    try {
      const invite = await createStudentInvitation(academyId, studentId);
      setInviteCodes((current) => ({ ...current, [studentId]: invite.code }));
      toast.success('학생 초대코드를 발급했습니다.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '초대코드 발급 실패');
    }
  };

  return (
    <PageShell title="학생" description="학생 원장, 반 배정, 청구 계약을 한 번에 연결합니다." icon={GraduationCap}>
      {loading && <LoadingBlock />}
      {!loading && (
        <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
          <Card>
            <CardHeader><CardTitle>학생 목록</CardTitle></CardHeader>
            <CardContent className="overflow-hidden rounded-lg border p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">학생</th>
                    <th className="px-4 py-3 font-medium">상태</th>
                    <th className="px-4 py-3 font-medium">반</th>
                    <th className="px-4 py-3 font-medium">청구</th>
                    <th className="px-4 py-3 font-medium">연락처</th>
                    <th className="px-4 py-3 font-medium">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td className="px-4 py-3 font-medium">{student.name}<div className="text-xs text-slate-400">{student.grade || '-'}</div></td>
                      <td className="px-4 py-3"><StatusBadge status={student.status} /></td>
                      <td className="px-4 py-3 text-slate-600">{student.classNames.join(', ') || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {student.billingMode === 'usage_based' ? `시간제 ${currency(student.hourlyRate)}` : currency(student.baseMonthlyFee)}
                        <div className="text-xs text-slate-400">{billingModeLabel(student.billingMode)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{student.phone || '-'}<div className="text-xs">{student.parentPhone || '-'}</div></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => editStudent(student)}>
                            수정
                          </Button>
                        {inviteCodes[student.id] ? (
                          <code className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{inviteCodes[student.id]}</code>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => issueInvite(student.id)} disabled={student.status !== 'active'}>
                            초대코드
                          </Button>
                        )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">등록된 학생이 없습니다.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{editingStudentId ? '학생 수정' : '학생 등록'}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-3">
                <div><Label>이름</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>학생 연락처</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
                  <div><Label>보호자 연락처</Label><Input value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} /></div>
                </div>
                <div><Label>학년/메모</Label><Input value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중1" /></div>
                {editingStudentId && (
                  <div>
                    <Label>상태</Label>
                    <SelectBox value={studentStatus} onChange={(event) => setStudentStatus(event.target.value as StudentStatus)}>
                      <option value="active">재원</option>
                      <option value="on_leave">휴원</option>
                      <option value="inactive">비활성</option>
                      <option value="graduated">졸업</option>
                      <option value="dropped">퇴원</option>
                    </SelectBox>
                  </div>
                )}
                <div>
                  <Label>반 배정</Label>
                  <div className="mt-2 grid gap-2">
                    {classes.map((row) => (
                      <label key={row.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                        <input type="checkbox" checked={selectedClassIds.has(row.id)} onChange={() => toggleClass(row.id)} />
                        {row.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>청구 방식</Label>
                  <SelectBox value={billingMode} onChange={(event) => setBillingMode(event.target.value as BillingMode)}>
                    <option value="monthly_plus_classes">월 기본료 + 추가반</option>
                    <option value="usage_based">시간제</option>
                    <option value="manual">수동 청구</option>
                  </SelectBox>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>월 기본료</Label><Input type="number" value={baseFee} onChange={(event) => setBaseFee(event.target.value)} /></div>
                  <div><Label>시간당 금액</Label><Input type="number" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></div>
                  <div><Label>추가반 금액</Label><Input type="number" value={extraClassFee} onChange={(event) => setExtraClassFee(event.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="submit" className="w-full">{editingStudentId ? '학생 수정' : '학생 등록'}</Button>
                  <Button type="button" variant="outline" className="w-full" onClick={resetStudentForm}>새 입력</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

export function StaffOperationsPage() {
  const academyId = useAcademyId();
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingStaffId, setEditingStaffId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<CreateStaffRole>('instructor');
  const [staffStatus, setStaffStatus] = useState<StaffStatus>('active');
  const [hourlyRate, setHourlyRate] = useState('');

  const load = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      setStaff(await listStaff(academyId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강사 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [academyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!academyId) return <MissingAcademy />;

  const resetStaffForm = () => {
    setEditingStaffId('');
    setName('');
    setPhone('');
    setRole('instructor');
    setStaffStatus('active');
    setHourlyRate('');
  };

  const editStaff = (row: StaffSummary) => {
    if (row.role === 'owner') {
      toast.error('소유자 권한은 이 화면에서 수정하지 않습니다.');
      return;
    }
    setEditingStaffId(row.id);
    setName(row.name);
    setPhone(row.phone || '');
    setRole(row.role as CreateStaffRole);
    setStaffStatus(row.status);
    setHourlyRate(row.hourlyRate === null ? '' : String(row.hourlyRate));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = { name, phone, role, hourlyRate: hourlyRate ? Number(hourlyRate) : null };
      if (editingStaffId) {
        await updateStaff(academyId, editingStaffId, { ...payload, status: staffStatus });
        toast.success('강사/직원 정보를 수정했습니다.');
      } else {
        await createStaff(academyId, payload);
        toast.success('강사/직원을 등록했습니다.');
      }
      resetStaffForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
  };

  return (
    <PageShell title="강사 / 직원" description="강사 급여와 반 배정의 기준이 되는 staff 정보를 관리합니다." icon={Users}>
      {loading && <LoadingBlock />}
      {!loading && (
        <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
          <Card>
            <CardHeader><CardTitle>강사/직원 목록</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {staff.map((row) => (
                <div key={row.id} className="rounded-lg border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <strong>{row.name}</strong>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{row.role} · {row.phone || '-'}</p>
                  <p className="mt-2 text-sm font-medium">{row.hourlyRate ? `${currency(row.hourlyRate)} / 시간` : '시급 미설정'}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => editStaff(row)} disabled={row.role === 'owner'}>
                    수정
                  </Button>
                </div>
              ))}
              {staff.length === 0 && <p className="py-8 text-center text-sm text-slate-400 md:col-span-2">등록된 강사/직원이 없습니다.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{editingStaffId ? '강사/직원 수정' : '강사/직원 등록'}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-3">
                <div><Label>이름</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
                <div><Label>연락처</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
                <div>
                  <Label>역할</Label>
                  <SelectBox value={role} onChange={(event) => setRole(event.target.value as CreateStaffRole)}>
                    <option value="instructor">강사</option>
                    <option value="teacher">교사</option>
                    <option value="staff">직원</option>
                    <option value="admin">관리자</option>
                  </SelectBox>
                </div>
                {editingStaffId && (
                  <div>
                    <Label>상태</Label>
                    <SelectBox value={staffStatus} onChange={(event) => setStaffStatus(event.target.value as StaffStatus)}>
                      <option value="active">재직</option>
                      <option value="on_leave">휴직</option>
                      <option value="inactive">퇴직/비활성</option>
                    </SelectBox>
                  </div>
                )}
                <div><Label>시급</Label><Input type="number" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="submit" className="w-full">{editingStaffId ? '수정 저장' : '등록'}</Button>
                  <Button type="button" variant="outline" className="w-full" onClick={resetStaffForm}>새 입력</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

export function AccountingOperationsPage() {
  const academyId = useAcademyId();
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payroll, setPayroll] = useState<InstructorPaymentRow[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [payrollGrossAmount, setPayrollGrossAmount] = useState('');
  const [payrollWithholdingType, setPayrollWithholdingType] = useState<WithholdingType>('freelance_3.3');
  const [payrollWithholdingRate, setPayrollWithholdingRate] = useState('');
  const [payrollHours, setPayrollHours] = useState('');
  const [payrollHourlyRate, setPayrollHourlyRate] = useState('');
  const [payrollMethod, setPayrollMethod] = useState('계좌이체');
  const [payrollNotes, setPayrollNotes] = useState('');

  const load = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      const range = serviceMonthRange(month);
      const [billingRows, paymentRows, expenseRows, payrollRows, staffRows] = await Promise.all([
        listBilling(academyId, month),
        listPayments(academyId, range.startDate, range.endDate),
        listExpenses(academyId, range.startDate, range.endDate),
        listInstructorPayments(academyId, month),
        listStaff(academyId),
      ]);
      setRows(billingRows);
      setPayments(paymentRows);
      setExpenses(expenseRows);
      setPayroll(payrollRows);
      setStaff(staffRows);
      setSelectedStudentId((current) => billingRows.some((row) => row.studentId === current) ? current : billingRows[0]?.studentId || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '청구 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [academyId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!academyId) return <MissingAcademy />;

  const selectedBillingRow = rows.find((row) => row.studentId === selectedStudentId) || rows[0] || null;
  const outstandingAmount = selectedBillingRow
    ? Math.max(0, selectedBillingRow.invoicedAmount - selectedBillingRow.paidAmount)
    : 0;

  const generate = async () => {
    try {
      await generateMonthlyInvoices(academyId, month);
      toast.success(`${month} 청구서를 생성했습니다.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '청구서 생성 실패');
    }
  };

  const selectPaymentTarget = (row: BillingRow) => {
    setSelectedStudentId(row.studentId);
    setPaymentAmount(String(Math.max(0, row.invoicedAmount - row.paidAmount) || row.invoicedAmount || row.expectedAmount));
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
      await load();
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
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지출 기록 저장 실패');
    }
  };

  const submitPayroll = async (event: React.FormEvent) => {
    event.preventDefault();
    const instructor = staff.find((row) => row.id === payrollInstructorId) || null;
    try {
      await createInstructorPayment(academyId, {
        instructorId: payrollInstructorId || null,
        recipientName: payrollRecipientName || instructor?.name || null,
        serviceMonth: month,
        paymentDate: payrollPaymentDate,
        grossAmount: Number(payrollGrossAmount) || 0,
        withholdingType: payrollWithholdingType,
        withholdingRate: payrollWithholdingRate ? Number(payrollWithholdingRate) : undefined,
        hoursWorked: payrollHours ? Number(payrollHours) : null,
        hourlyRate: payrollHourlyRate ? Number(payrollHourlyRate) : instructor?.hourlyRate ?? null,
        paymentMethod: payrollMethod,
        status: 'paid',
        notes: payrollNotes || null,
      });
      setPayrollGrossAmount('');
      setPayrollHours('');
      setPayrollHourlyRate('');
      setPayrollWithholdingRate('');
      setPayrollRecipientName('');
      setPayrollNotes('');
      toast.success('강사 지급 기록을 저장했습니다.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강사 지급 기록 저장 실패');
    }
  };

  const totals = useMemo(() => ({
    expected: rows.reduce((sum, row) => sum + row.expectedAmount, 0),
    invoiced: rows.reduce((sum, row) => sum + row.invoicedAmount, 0),
    paid: rows.reduce((sum, row) => sum + row.paidAmount, 0),
    expenses: expenses.reduce((sum, row) => sum + row.amount, 0),
    payroll: payroll.reduce((sum, row) => sum + row.netAmount, 0),
  }), [expenses, payroll, rows]);

  return (
    <PageShell
      title="회계 / 청구"
      description="청구서 생성 이후 입금, 지출, 강사 지급까지 한 달 운영 흐름을 관리합니다."
      icon={CreditCard}
      action={<div className="flex gap-2"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" /><Button onClick={generate}>청구서 생성</Button></div>}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="예상 청구" value={currency(totals.expected)} hint="계약과 출결 기준" icon={CreditCard} />
        <MetricCard label="발행 청구" value={currency(totals.invoiced)} hint="invoice 기준" icon={BookOpen} />
        <MetricCard label="입금" value={currency(totals.paid)} hint="납부 반영액" icon={Activity} />
        <MetricCard label="지출" value={currency(totals.expenses)} hint="운영 비용" icon={ReceiptText} />
        <MetricCard label="강사 지급" value={currency(totals.payroll)} hint="net 기준" icon={Users} />
      </div>
      {loading ? <LoadingBlock /> : (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1.3fr_0.9fr]">
            <Card>
              <CardHeader><CardTitle>학생별 청구 상태</CardTitle></CardHeader>
              <CardContent className="overflow-hidden rounded-lg border p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">학생</th>
                      <th className="px-4 py-3 font-medium">방식</th>
                      <th className="px-4 py-3 font-medium">예상액</th>
                      <th className="px-4 py-3 font-medium">청구액</th>
                      <th className="px-4 py-3 font-medium">입금액</th>
                      <th className="px-4 py-3 font-medium">상태</th>
                      <th className="px-4 py-3 font-medium">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y bg-white">
                    {rows.map((row) => (
                      <tr key={row.studentId}>
                        <td className="px-4 py-3 font-medium">{row.studentName}</td>
                        <td className="px-4 py-3 text-slate-500">{billingModeLabel(row.billingMode)}</td>
                        <td className="px-4 py-3 tabular-nums">{currency(row.expectedAmount)}</td>
                        <td className="px-4 py-3 tabular-nums">{currency(row.invoicedAmount)}</td>
                        <td className="px-4 py-3 tabular-nums">{currency(row.paidAmount)}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                        <td className="px-4 py-3">
                          <Button type="button" size="sm" variant="outline" onClick={() => selectPaymentTarget(row)}>
                            입금
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">학생 청구 데이터가 없습니다.</td></tr>}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>입금 기록</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={submitPayment} className="space-y-3">
                  <div>
                    <Label>학생</Label>
                    <SelectBox value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>
                      {rows.map((row) => (
                        <option key={row.studentId} value={row.studentId}>{row.studentName}</option>
                      ))}
                    </SelectBox>
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

          <div className="grid gap-5 xl:grid-cols-2">
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
                    <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                      <input type="checkbox" checked={expenseTaxDeductible} onChange={(event) => setExpenseTaxDeductible(event.target.checked)} />
                      세무 반영
                    </label>
                    <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                      <input type="checkbox" checked={expenseHasReceipt} onChange={(event) => setExpenseHasReceipt(event.target.checked)} />
                      증빙 있음
                    </label>
                  </div>
                  <Button type="submit" className="w-full">지출 저장</Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>강사 지급</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={submitPayroll} className="space-y-3">
                  <div>
                    <Label>강사/직원</Label>
                    <SelectBox value={payrollInstructorId} onChange={(event) => setPayrollInstructorId(event.target.value)}>
                      <option value="">직접 입력</option>
                      {staff.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </SelectBox>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>수령인명</Label><Input value={payrollRecipientName} onChange={(event) => setPayrollRecipientName(event.target.value)} placeholder="직접 입력 시 필요" /></div>
                    <div><Label>지급일</Label><Input type="date" value={payrollPaymentDate} onChange={(event) => setPayrollPaymentDate(event.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>총액</Label><Input type="number" value={payrollGrossAmount} onChange={(event) => setPayrollGrossAmount(event.target.value)} /></div>
                    <div><Label>시간</Label><Input type="number" value={payrollHours} onChange={(event) => setPayrollHours(event.target.value)} /></div>
                    <div><Label>시급</Label><Input type="number" value={payrollHourlyRate} onChange={(event) => setPayrollHourlyRate(event.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>원천징수</Label>
                      <SelectBox value={payrollWithholdingType} onChange={(event) => setPayrollWithholdingType(event.target.value as WithholdingType)}>
                        <option value="freelance_3.3">프리랜서 3.3%</option>
                        <option value="none">없음</option>
                        <option value="custom">직접 계산</option>
                      </SelectBox>
                    </div>
                    <div><Label>지급수단</Label><Input value={payrollMethod} onChange={(event) => setPayrollMethod(event.target.value)} /></div>
                  </div>
                  {payrollWithholdingType === 'custom' && (
                    <div><Label>원천징수율 (%)</Label><Input type="number" step="0.1" min="0" value={payrollWithholdingRate} onChange={(event) => setPayrollWithholdingRate(event.target.value)} /></div>
                  )}
                  <div><Label>메모</Label><Input value={payrollNotes} onChange={(event) => setPayrollNotes(event.target.value)} /></div>
                  <Button type="submit" className="w-full">지급 저장</Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>최근 입금</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {payments.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                    <div>
                      <strong>{row.studentName}</strong>
                      <div className="text-xs text-slate-500">{row.paymentDate} · {row.paymentMethod || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{currency(row.amount)}</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>
                ))}
                {payments.length === 0 && <p className="py-8 text-center text-slate-400">입금 기록이 없습니다.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>최근 지출</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {expenses.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                    <div>
                      <strong>{row.category}</strong>
                      <div className="text-xs text-slate-500">{row.expenseDate} · {row.recipient || row.description || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{currency(row.amount)}</div>
                      <div className="text-xs text-slate-500">{row.hasReceipt ? '증빙 있음' : '증빙 없음'}</div>
                    </div>
                  </div>
                ))}
                {expenses.length === 0 && <p className="py-8 text-center text-slate-400">지출 기록이 없습니다.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>강사 지급 내역</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {payroll.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                    <div>
                      <strong>{row.recipientName || row.instructorName || '-'}</strong>
                      <div className="text-xs text-slate-500">{row.paymentDate} · 원천 {currency(row.withholdingTax + row.localTax)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{currency(row.netAmount)}</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>
                ))}
                {payroll.length === 0 && <p className="py-8 text-center text-slate-400">지급 기록이 없습니다.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
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
    <PageShell title="설정" description="학원 연결, 세금 기준, 운영 데이터 내보내기와 초기화를 관리합니다." icon={Settings}>
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>현재 연결</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 p-3">
                <span>Academy ID</span>
                <code className="break-all text-right text-xs">{academyId}</code>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                <span>학생/반 기준</span>
                <strong>core.students / core.classes</strong>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                <span>교재 권한</span>
                <strong>core.class_books</strong>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-emerald-800">
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
                  <SelectBox value={exportType} onChange={(event) => setExportType(event.target.value as AdminExportType)}>
                    <option value="tax">세무 리포트</option>
                    <option value="payroll">강사 급여</option>
                  </SelectBox>
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
                  <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={includeRevenue} onChange={(event) => setIncludeRevenue(event.target.checked)} />
                    매출 포함
                  </label>
                  <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={includePayroll} onChange={(event) => setIncludePayroll(event.target.checked)} />
                    급여 포함
                  </label>
                  <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={includeExpenses} onChange={(event) => setIncludeExpenses(event.target.checked)} />
                    비용 포함
                  </label>
                  <label className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={includeProfitLoss} onChange={(event) => setIncludeProfitLoss(event.target.checked)} />
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

          <Card className="border-red-200">
            <CardHeader><CardTitle>운영 데이터 초기화</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                초기화는 되돌릴 수 없습니다. 원격 `nextum-data` 전환 전에는 교재/문제 데이터 백업과 범위를 먼저 확정해야 합니다.
              </div>
              <div>
                <Label>초기화 범위</Label>
                <SelectBox value={resetTarget} onChange={(event) => setResetTarget(event.target.value as AdminResetTarget)}>
                  {resetTargets.map((target) => (
                    <option key={target.value} value={target.value}>{target.label}</option>
                  ))}
                </SelectBox>
                <p className="mt-2 text-sm text-slate-500">{selectedResetTarget.description}</p>
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
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>개발 DB에서만 `admin / 1234` 계정을 생성합니다. 실수 방지를 위해 명시 플래그가 필요합니다.</p>
              <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">$env:LMS_DEV_SEED_ALLOW='true'; npm run seed:dev-admin</pre>
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
