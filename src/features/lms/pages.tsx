'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  GraduationCap,
  Plus,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  createClass,
  createScheduleRule,
  createStaff,
  createStudent,
  createStudentInvitation,
  generateMonthlyInvoices,
  getDashboardData,
  listAttendance,
  listBilling,
  listBooks,
  listClassBooks,
  listClassStudents,
  listClassSummaries,
  listSchedule,
  listStaff,
  listStudents,
  listWeakTypes,
  recordAttendance,
  setClassBook,
} from './service';
import type {
  AttendanceRow,
  AttendanceStatus,
  BillingMode,
  BillingRow,
  BookSummary,
  ClassBookSummary,
  ClassStudentSummary,
  ClassSummary,
  DashboardData,
  ScheduleItem,
  StaffSummary,
  StudentSummary,
} from './types';

type CreateStaffRole = 'admin' | 'teacher' | 'instructor' | 'staff';

const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
        ['weak', 'overdue', 'cancelled', 'absent'].includes(status) && 'bg-red-50 text-red-700',
        ['watch', 'partial', 'issued', 'late', 'makeup'].includes(status) && 'bg-amber-50 text-amber-700',
        ['active', 'paid', 'ok', 'completed', 'scheduled', 'present'].includes(status) && 'bg-emerald-50 text-emerald-700',
        ['not_issued', 'inactive', 'archived', 'insufficient', 'excused'].includes(status) && 'bg-slate-100 text-slate-600',
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
  const unpaid = data?.billing.filter((row) => row.status !== 'paid' && row.invoicedAmount > 0).length || 0;

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
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [classBooks, setClassBooks] = useState<ClassBookSummary[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudentSummary[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('18:00');
  const [startDate, setStartDate] = useState(today());
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
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
      const [classRows, scheduleRows, bookRows, attendanceRows] = await Promise.all([
        listClassSummaries(academyId),
        listSchedule(academyId, rangeStart, rangeEnd),
        listBooks(academyId),
        listAttendance(academyId, rangeStart, rangeEnd),
      ]);
      setClasses(classRows);
      setSchedule(scheduleRows);
      setBooks(bookRows);
      setAttendance(attendanceRows);
      setSelectedClassId((current) => current || classRows[0]?.id || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [academyId]);

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
  const selectedSchedule = classSchedule.find((item) => item.id === selectedScheduleId) || classSchedule[0] || null;
  const selectedDuration = durationMinutes(selectedSchedule);
  const classAttendance = attendance.filter((row) => row.classId === selectedClassId);

  useEffect(() => {
    if (!classSchedule.some((item) => item.id === selectedScheduleId)) {
      setSelectedScheduleId(classSchedule[0]?.id || '');
    }
  }, [classSchedule, selectedScheduleId]);

  useEffect(() => {
    if (!classStudents.some((student) => student.id === attendanceStudentId)) {
      setAttendanceStudentId(classStudents[0]?.id || '');
    }
  }, [attendanceStudentId, classStudents]);

  if (!academyId) return <MissingAcademy />;

  const submitClass = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createClass(academyId, { name, grade: grade || null });
      setName('');
      setGrade('');
      toast.success('반을 추가했습니다.');
      await loadBase();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 추가 실패');
    }
  };

  const submitRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedClassId) {
      toast.error('시간표를 추가할 반을 선택하세요.');
      return;
    }
    try {
      await createScheduleRule(academyId, { classId: selectedClassId, dayOfWeek, startTime, endTime, startDate });
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
                      <span className="font-semibold">{row.name}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {row.grade || '학년 미지정'} · 학생 {row.studentCount}명 · 취약 유형 {row.weakTypeCount}개
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
                <CardTitle>반 추가</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitClass} className="space-y-3">
                  <div>
                    <Label htmlFor="class-name">반 이름</Label>
                    <Input id="class-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="중1 A반" />
                  </div>
                  <div>
                    <Label htmlFor="class-grade">학년/레벨</Label>
                    <Input id="class-grade" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중1" />
                  </div>
                  <Button type="submit" className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    반 생성
                  </Button>
                </form>
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
                  <Button type="submit" className="w-full">시간표 추가</Button>
                </form>
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
                      <Button type="submit" disabled={!selectedClassId || !selectedBookId}>배정</Button>
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
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [grade, setGrade] = useState('');
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
      await createStudent(academyId, {
        name,
        phone,
        parentPhone,
        grade,
        classIds,
        classBillingRules,
        billingMode,
        baseMonthlyFee: Number(baseFee) || 0,
        hourlyRate: hourlyRate ? Number(hourlyRate) : null,
      });
      setName('');
      setPhone('');
      setParentPhone('');
      setGrade('');
      setSelectedClassIds(new Set());
      toast.success('학생을 등록했습니다.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '학생 등록 실패');
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
                    <th className="px-4 py-3 font-medium">반</th>
                    <th className="px-4 py-3 font-medium">청구</th>
                    <th className="px-4 py-3 font-medium">연락처</th>
                    <th className="px-4 py-3 font-medium">가입</th>
                  </tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td className="px-4 py-3 font-medium">{student.name}<div className="text-xs text-slate-400">{student.grade || '-'}</div></td>
                      <td className="px-4 py-3 text-slate-600">{student.classNames.join(', ') || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {student.billingMode === 'usage_based' ? `시간제 ${currency(student.hourlyRate)}` : currency(student.baseMonthlyFee)}
                        <div className="text-xs text-slate-400">{billingModeLabel(student.billingMode)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{student.phone || '-'}<div className="text-xs">{student.parentPhone || '-'}</div></td>
                      <td className="px-4 py-3">
                        {inviteCodes[student.id] ? (
                          <code className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{inviteCodes[student.id]}</code>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => issueInvite(student.id)}>
                            초대코드
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">등록된 학생이 없습니다.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>학생 등록</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-3">
                <div><Label>이름</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>학생 연락처</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
                  <div><Label>보호자 연락처</Label><Input value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} /></div>
                </div>
                <div><Label>학년/메모</Label><Input value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중1" /></div>
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
                <Button type="submit" className="w-full">학생 등록</Button>
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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<CreateStaffRole>('instructor');
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createStaff(academyId, { name, phone, role, hourlyRate: hourlyRate ? Number(hourlyRate) : null });
      setName('');
      setPhone('');
      setHourlyRate('');
      toast.success('강사/직원을 등록했습니다.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '등록 실패');
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
                </div>
              ))}
              {staff.length === 0 && <p className="py-8 text-center text-sm text-slate-400 md:col-span-2">등록된 강사/직원이 없습니다.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>강사/직원 등록</CardTitle></CardHeader>
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
                <div><Label>시급</Label><Input type="number" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></div>
                <Button type="submit" className="w-full">등록</Button>
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      setRows(await listBilling(academyId, month));
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

  const generate = async () => {
    try {
      await generateMonthlyInvoices(academyId, month);
      toast.success(`${month} 청구서를 생성했습니다.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '청구서 생성 실패');
    }
  };

  const totals = useMemo(() => ({
    expected: rows.reduce((sum, row) => sum + row.expectedAmount, 0),
    invoiced: rows.reduce((sum, row) => sum + row.invoicedAmount, 0),
    paid: rows.reduce((sum, row) => sum + row.paidAmount, 0),
  }), [rows]);

  return (
    <PageShell
      title="회계 / 청구"
      description="학생별 청구 예정액, 발행액, 납부 상태를 관리합니다."
      icon={CreditCard}
      action={<div className="flex gap-2"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" /><Button onClick={generate}>청구서 생성</Button></div>}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="예상 청구" value={currency(totals.expected)} hint="계약과 출결 기준" icon={CreditCard} />
        <MetricCard label="발행 청구" value={currency(totals.invoiced)} hint="invoice 기준" icon={BookOpen} />
        <MetricCard label="입금" value={currency(totals.paid)} hint="납부 반영액" icon={Activity} />
      </div>
      {loading ? <LoadingBlock /> : (
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
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">학생 청구 데이터가 없습니다.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

export function SettingsOperationsPage() {
  const academyId = useAcademyId();
  return (
    <PageShell title="설정" description="현재 연결 상태와 개발용 초기화 기준을 확인합니다." icon={Settings}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>현재 연결</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span>Academy ID</span>
              <code className="text-xs">{academyId || '-'}</code>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span>학생/반 기준</span>
              <strong>core.students / core.classes</strong>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span>교재 권한</span>
              <strong>core.class_books</strong>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>개발용 관리자</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>개발 DB에서만 아래 스크립트로 `admin / 1234` 계정을 생성합니다.</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">npm run seed:dev-admin</pre>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
