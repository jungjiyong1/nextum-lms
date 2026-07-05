'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
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
  generateMonthlyInvoices,
  getDashboardData,
  listBilling,
  listClassSummaries,
  listSchedule,
  listStaff,
  listStudents,
  listWeakTypes,
} from './service';
import type {
  BillingMode,
  BillingRow,
  ClassSummary,
  DashboardData,
  ScheduleItem,
  StaffSummary,
  StudentSummary,
  WeakTypeRow,
} from './types';

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

function academyIdOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function useAcademyId() {
  const { profile } = useAuth();
  return academyIdOf(profile?.current_academy_id);
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
    partial: '부분납',
    overdue: '연체',
    not_issued: '미발행',
    scheduled: '예정',
    completed: '완료',
    cancelled: '휴강',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
        ['weak', 'overdue', 'cancelled'].includes(status) && 'bg-red-50 text-red-700',
        ['watch', 'partial', 'issued'].includes(status) && 'bg-amber-50 text-amber-700',
        ['active', 'paid', 'ok', 'completed', 'scheduled'].includes(status) && 'bg-emerald-50 text-emerald-700',
        ['not_issued', 'inactive', 'archived', 'insufficient'].includes(status) && 'bg-slate-100 text-slate-600',
      )}
    >
      {label[status] || status}
    </span>
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
  const unpaid = data?.billing.filter((row) => !['paid'].includes(row.status) && row.invoicedAmount > 0).length || 0;

  return (
    <PageShell
      title="학습 성과 대시보드"
      description="채점앱 데이터 기반 약한 유형과 운영 리스크를 먼저 확인합니다."
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
            <MetricCard label="운영 반" value={`${data.classes.length}개`} hint="core.classes 기준" icon={BookOpen} />
            <MetricCard label="활성 학생" value={`${data.students.length}명`} hint="반 등록과 청구 계약 연결" icon={GraduationCap} />
            <MetricCard label="취약 유형" value={`${weakCount}개`} hint="첫 시도 기준 weak 판정" icon={AlertTriangle} />
            <MetricCard label="AI 질문" value={`${data.aiConversationCount}건`} hint="최근 30일 저장 대화" icon={Activity} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>우선 확인할 약한 유형</CardTitle>
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
                            아직 표시할 취약 유형 데이터가 없습니다.
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
                  <span className="text-slate-600">미완납 또는 미발행</span>
                  <strong>{unpaid}명</strong>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-600">학습 위험 학생</span>
                  <strong>{new Set(data.weakTypes.map((row) => row.studentId)).size}명</strong>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-600">평균 반별 약점 유형</span>
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
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('18:00');
  const [startDate, setStartDate] = useState(today());

  const load = useCallback(async () => {
    if (!academyId) return;
    setLoading(true);
    try {
      const [classRows, scheduleRows] = await Promise.all([
        listClassSummaries(academyId),
        listSchedule(academyId, today(), addDaysString(today(), 14)),
      ]);
      setClasses(classRows);
      setSchedule(scheduleRows);
      if (!selectedClassId && classRows[0]) setSelectedClassId(classRows[0].id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [academyId, selectedClassId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!academyId) return <MissingAcademy />;

  const submitClass = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createClass(academyId, { name, grade: grade || null });
      setName('');
      setGrade('');
      toast.success('반을 추가했습니다.');
      await load();
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
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시간표 추가 실패');
    }
  };

  return (
    <PageShell title="반 / 시간표" description="학생 등록, 교재 배정, 출결과 청구의 기준이 되는 운영 반입니다." icon={CalendarDays}>
      {loading && <LoadingBlock />}
      {!loading && (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>반 목록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {classes.map((row) => (
                <div key={row.id} className="flex items-center justify-between rounded-lg border bg-white p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{row.name}</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {row.grade || '학년 미지정'} · 학생 {row.studentCount}명 · 약점 유형 {row.weakTypeCount}개
                    </p>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <div>{row.instructorName || '강사 미지정'}</div>
                    <div>{row.classroomName || '강의실 미지정'}</div>
                  </div>
                </div>
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
                    <Input id="class-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="중2 A반" />
                  </div>
                  <div>
                    <Label htmlFor="class-grade">학년/레벨</Label>
                    <Input id="class-grade" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중2" />
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
                <CardTitle>반 반복 시간표 추가</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitRule} className="space-y-3">
                  <div>
                    <Label>반</Label>
                    <select value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} className="h-10 w-full rounded-md bg-[#e7e5e4] px-3 text-sm">
                      {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label>요일</Label>
                      <select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))} className="h-10 w-full rounded-md bg-[#e7e5e4] px-3 text-sm">
                        {dayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
                      </select>
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
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());

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
    try {
      await createStudent(academyId, {
        name,
        phone,
        parentPhone,
        grade,
        classIds: [...selectedClassIds],
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

  return (
    <PageShell title="학생" description="반 등록과 청구 계약을 학생 원장에 함께 연결합니다." icon={GraduationCap}>
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
                  </tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td className="px-4 py-3 font-medium">{student.name}<div className="text-xs text-slate-400">{student.grade || '-'}</div></td>
                      <td className="px-4 py-3 text-slate-600">{student.classNames.join(', ') || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{student.billingMode === 'usage_based' ? `시간제 ${currency(student.hourlyRate)}` : currency(student.baseMonthlyFee)}</td>
                      <td className="px-4 py-3 text-slate-500">{student.phone || '-'}<div className="text-xs">{student.parentPhone || '-'}</div></td>
                    </tr>
                  ))}
                  {students.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">등록된 학생이 없습니다.</td></tr>}
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
                <div><Label>학년/메모</Label><Input value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중2" /></div>
                <div>
                  <Label>반 등록</Label>
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
                  <select value={billingMode} onChange={(event) => setBillingMode(event.target.value as BillingMode)} className="h-10 w-full rounded-md bg-[#e7e5e4] px-3 text-sm">
                    <option value="monthly_plus_classes">월 기본금 + 추가반</option>
                    <option value="usage_based">시간제</option>
                    <option value="manual">수동 청구</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>월 기본금</Label><Input type="number" value={baseFee} onChange={(event) => setBaseFee(event.target.value)} /></div>
                  <div><Label>시간당 금액</Label><Input type="number" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></div>
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

  type CreateStaffRole = 'admin' | 'teacher' | 'instructor' | 'staff';

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
    <PageShell title="강사 / 직원" description="강사 급여와 반 기본 배정을 위한 staff 원장입니다." icon={Users}>
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
                  <select value={role} onChange={(event) => setRole(event.target.value as CreateStaffRole)} className="h-10 w-full rounded-md bg-[#e7e5e4] px-3 text-sm">
                    <option value="instructor">강사</option>
                    <option value="teacher">교사</option>
                    <option value="staff">직원</option>
                    <option value="admin">관리자</option>
                  </select>
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
      description="청구월, 입금일, 부분납을 분리해 학생별 월 청구 상태를 관리합니다."
      icon={CreditCard}
      action={<div className="flex gap-2"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" /><Button onClick={generate}>청구서 생성</Button></div>}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="예상 청구" value={currency(totals.expected)} hint="학생 계약 기준" icon={CreditCard} />
        <MetricCard label="발행 청구" value={currency(totals.invoiced)} hint="invoice 기준" icon={BookOpen} />
        <MetricCard label="입금" value={currency(totals.paid)} hint="payments 기준" icon={Activity} />
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
                  <th className="px-4 py-3 font-medium">청구액</th>
                  <th className="px-4 py-3 font-medium">입금액</th>
                  <th className="px-4 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-white">
                {rows.map((row) => (
                  <tr key={row.studentId}>
                    <td className="px-4 py-3 font-medium">{row.studentName}</td>
                    <td className="px-4 py-3 text-slate-500">{row.billingMode || '-'}</td>
                    <td className="px-4 py-3 tabular-nums">{currency(row.invoicedAmount)}</td>
                    <td className="px-4 py-3 tabular-nums">{currency(row.paidAmount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">학생 청구 데이터가 없습니다.</td></tr>}
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
    <PageShell title="설정" description="새 LMS baseline 기준의 운영 설정과 개발용 초기화를 확인합니다." icon={Settings}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>현재 연결</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span>Academy ID</span>
              <code className="text-xs">{academyId || '-'}</code>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span>DB 원장</span>
              <strong>core.classes / core.students</strong>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-50 p-3">
              <span>학생 앱</span>
              <strong>grade-app 연동 예정</strong>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>개발용 관리자</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>운영 DB에는 기본 비밀번호 계정을 넣지 않습니다. 로컬/개발 DB에서만 아래 스크립트로 `admin / 1234`를 생성합니다.</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">npm run seed:dev-admin</pre>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
