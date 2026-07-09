'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Plus,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/data-table';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageShell, PageStatusBar } from '@/components/ui/page-shell';
import { SelectField } from '@/components/ui/select-field';
import { SelectableCard } from '@/components/ui/selectable-card';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { canManageScheduleRules } from '@/core/auth/roles';
import {
  addLmsInvalidationListener,
  createBook,
  createClass,
  createClassroom,
  createScheduleRule,
  loadClassOperationsDetail,
  loadClassOperationsOverview,
  recordAttendance,
  setClassBook,
  updateBook,
  updateClass,
  updateClassroom,
  updateLessonOccurrence,
  updateScheduleRule,
} from './service';
import type {
  AttendanceRow,
  AttendanceStatus,
  BookSummary,
  ClassBookSummary,
  ClassStatus,
  ClassStudentSummary,
  ClassSummary,
  ClassroomSummary,
  LessonOccurrenceStatus,
  ScheduleItem,
  ScheduleRuleSummary,
  StaffSummary,
} from './types';

type ClassroomsView = 'overview' | 'schedule' | 'attendance' | 'settings';
type LmsPageLoadOptions = { force?: boolean; background?: boolean };

const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
const attendanceStatuses: AttendanceStatus[] = ['present', 'late', 'absent', 'excused', 'makeup'];
const lessonStatuses: LessonOccurrenceStatus[] = ['scheduled', 'completed', 'cancelled', 'makeup', 'substitute'];
const classStatuses: ClassStatus[] = ['active', 'inactive', 'archived'];

const classStatusLabels: Record<ClassStatus, string> = {
  active: '운영',
  inactive: '중지',
  archived: '보관',
};

const attendanceStatusLabels: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
  excused: '인정 결석',
  makeup: '보강',
};

const lessonStatusLabels: Record<LessonOccurrenceStatus, string> = {
  scheduled: '예정',
  completed: '완료',
  cancelled: '취소',
  makeup: '보강',
  substitute: '대강',
};

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDaysString(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function readInitialQuery() {
  if (typeof window === 'undefined') {
    return { classId: '', lessonId: '', date: today() };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    classId: params.get('classId') || '',
    lessonId: params.get('lessonId') || '',
    date: params.get('date') || today(),
  };
}

function replaceQuery(next: Record<string, string | null | undefined>) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(next)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
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
          현재 계정에 연결된 학원을 찾지 못했습니다. 운영 설정에서 학원 연결 상태를 확인하세요.
        </CardContent>
      </Card>
    </div>
  );
}

function swatchColor(value: string | null | undefined) {
  return value || 'hsl(var(--muted-foreground))';
}

function classSummaryHint(row: ClassSummary) {
  return `${row.grade || '학년 미지정'} · 학생 ${row.studentCount}명 · 정원 ${row.capacity ?? '-'}명`;
}

function ClassPicker({
  classes,
  selectedClassId,
  onSelectClass,
}: {
  classes: ClassSummary[];
  selectedClassId: string;
  onSelectClass: (classId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>반 목록</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {classes.map((row) => (
          <SelectableCard
            key={row.id}
            selected={selectedClassId === row.id}
            onClick={() => onSelectClass(row.id)}
            className="flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: swatchColor(row.color) }} />
                <span className="truncate font-semibold">{row.name}</span>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{classSummaryHint(row)}</p>
            </div>
            <div className="hidden shrink-0 text-right text-sm text-muted-foreground sm:block">
              <div>{row.instructorName || '강사 미지정'}</div>
              <div>{row.classroomName || '강의실 미지정'}</div>
            </div>
          </SelectableCard>
        ))}
        {classes.length === 0 && (
          <EmptyState title="등록된 반이 없습니다" description="운영 설정에서 반을 먼저 추가하세요." />
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleTable({ schedule }: { schedule: ScheduleItem[] }) {
  return (
    <DataTable>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4 py-3 font-medium">날짜</TableHead>
            <TableHead className="px-4 py-3 font-medium">시간</TableHead>
            <TableHead className="px-4 py-3 font-medium">반</TableHead>
            <TableHead className="px-4 py-3 font-medium">강사/강의실</TableHead>
            <TableHead className="px-4 py-3 font-medium">상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="px-4 py-3">{item.date}</TableCell>
              <TableCell className="px-4 py-3 tabular-nums">{item.startTime} - {item.endTime}</TableCell>
              <TableCell className="px-4 py-3 font-medium">{item.className}</TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">{item.instructorName || '-'} · {item.classroomName || '-'}</TableCell>
              <TableCell className="px-4 py-3"><StatusBadge status={item.status} label={lessonStatusLabels[item.status]} /></TableCell>
            </TableRow>
          ))}
          {schedule.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                표시할 수업이 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </DataTable>
  );
}

function AttendanceTable({ attendance }: { attendance: AttendanceRow[] }) {
  return (
    <DataTable>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4 py-3 font-medium">날짜</TableHead>
            <TableHead className="px-4 py-3 font-medium">반</TableHead>
            <TableHead className="px-4 py-3 font-medium">학생</TableHead>
            <TableHead className="px-4 py-3 font-medium">상태</TableHead>
            <TableHead className="px-4 py-3 font-medium">출석/청구</TableHead>
            <TableHead className="px-4 py-3 font-medium">메모</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attendance.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="px-4 py-3">{row.date}</TableCell>
              <TableCell className="px-4 py-3 font-medium">{row.className}</TableCell>
              <TableCell className="px-4 py-3">{row.studentName}</TableCell>
              <TableCell className="px-4 py-3"><StatusBadge status={row.status} label={attendanceStatusLabels[row.status]} /></TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">{row.attendedMinutes ?? 0}분 / {row.billableMinutes ?? 0}분</TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">{row.notes || '-'}</TableCell>
            </TableRow>
          ))}
          {attendance.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                기록된 출결이 없습니다.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </DataTable>
  );
}

export function ClassroomsOperationsPage({ view }: { view: ClassroomsView }) {
  const academyId = useAcademyId();
  const { profile } = useAuth();
  const canManageClassSetup = canManageScheduleRules(profile?.role);
  const initialQuery = useMemo(readInitialQuery, []);

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
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(initialQuery.classId);
  const [scheduleClassFilter, setScheduleClassFilter] = useState(initialQuery.classId);
  const [selectedScheduleId, setSelectedScheduleId] = useState(initialQuery.lessonId);
  const [selectedDate, setSelectedDate] = useState(initialQuery.date);

  const [editingClassId, setEditingClassId] = useState('');
  const [className, setClassName] = useState('');
  const [grade, setGrade] = useState('');
  const [classStatus, setClassStatus] = useState<ClassStatus>('active');
  const [capacity, setCapacity] = useState('');
  const [classColor, setClassColor] = useState('#059669');
  const [defaultInstructorId, setDefaultInstructorId] = useState('');
  const [defaultClassroomId, setDefaultClassroomId] = useState('');

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
  const [ruleStartDate, setRuleStartDate] = useState(today());
  const [ruleEndDate, setRuleEndDate] = useState('');

  const [selectedBookId, setSelectedBookId] = useState('');
  const [editingBookId, setEditingBookId] = useState('');
  const [bookKey, setBookKey] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [bookSubject, setBookSubject] = useState('');
  const [bookGrade, setBookGrade] = useState('');

  const [lessonStatus, setLessonStatus] = useState<LessonOccurrenceStatus>('scheduled');
  const [lessonCancelReason, setLessonCancelReason] = useState('');
  const [attendanceStudentId, setAttendanceStudentId] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>('present');
  const [attendedMinutes, setAttendedMinutes] = useState('');
  const [billableMinutes, setBillableMinutes] = useState('');
  const [attendanceNotes, setAttendanceNotes] = useState('');

  const loadBase = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId) return;
    if (options.background) setRefreshing(true);
    else setLoading(true);
    try {
      const rangeStart = view === 'attendance' ? selectedDate : today();
      const rangeEnd = view === 'attendance' ? selectedDate : addDaysString(rangeStart, 14);
      const data = await loadClassOperationsOverview(academyId, rangeStart, rangeEnd, { force: options.force });

      setClasses(data.classes);
      setSchedule(data.schedule);
      setScheduleRules(data.scheduleRules);
      setBooks(data.books);
      setAttendance(data.attendance);
      setStaff(data.staff);
      setClassrooms(data.classrooms);
      setSelectedClassId((current) => (
        current && data.classes.some((row) => row.id === current) ? current : data.classes[0]?.id || ''
      ));
      setScheduleClassFilter((current) => (
        current && data.classes.some((row) => row.id === current) ? current : ''
      ));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 정보를 불러오지 못했습니다.');
    } finally {
      if (options.background) setRefreshing(false);
      else setLoading(false);
    }
  }, [academyId, selectedDate, view]);

  const loadClassDetail = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId || !selectedClassId) {
      setClassStudents([]);
      setClassBooks([]);
      return;
    }
    if (!options.background) setDetailLoading(true);
    try {
      const data = await loadClassOperationsDetail(academyId, selectedClassId, { force: options.force });
      setClassStudents(data.students);
      setClassBooks(data.books);
      setAttendanceStudentId((current) => (
        current && data.students.some((student) => student.id === current) ? current : data.students[0]?.id || ''
      ));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 상세 정보를 불러오지 못했습니다.');
    } finally {
      if (!options.background) setDetailLoading(false);
    }
  }, [academyId, selectedClassId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadClassDetail();
  }, [loadClassDetail]);

  useEffect(() => {
    if (!academyId) return undefined;
    return addLmsInvalidationListener((payload) => {
      if (payload.academyId && payload.academyId !== academyId) return;
      const domain = payload.domain || 'lms';
      if (!['classes', 'students', 'assignments', 'learning', 'lms', 'admin'].includes(domain)) return;
      void loadBase({ force: true, background: true });
      void loadClassDetail({ force: true, background: true });
    });
  }, [academyId, loadBase, loadClassDetail]);

  const selectedClass = classes.find((row) => row.id === selectedClassId) || null;
  const selectedSchedule = schedule.find((item) => item.id === selectedScheduleId) || null;
  const selectedDuration = durationMinutes(selectedSchedule);
  const daySchedule = useMemo(() => (
    schedule.filter((item) => item.date === selectedDate && (!scheduleClassFilter || item.classId === scheduleClassFilter))
  ), [schedule, scheduleClassFilter, selectedDate]);
  const filteredSchedule = useMemo(() => (
    schedule.filter((item) => !scheduleClassFilter || item.classId === scheduleClassFilter)
  ), [schedule, scheduleClassFilter]);
  const selectedClassSchedule = useMemo(() => (
    schedule.filter((item) => item.classId === selectedClassId)
  ), [schedule, selectedClassId]);
  const classRules = useMemo(() => (
    scheduleRules.filter((item) => item.classId === selectedClassId)
  ), [scheduleRules, selectedClassId]);
  const visibleAttendance = useMemo(() => (
    attendance.filter((row) => {
      if (view === 'attendance') {
        return row.date === selectedDate && (!scheduleClassFilter || row.classId === scheduleClassFilter);
      }
      return row.classId === selectedClassId;
    })
  ), [attendance, scheduleClassFilter, selectedClassId, selectedDate, view]);

  const todayLessons = schedule.filter((item) => item.date === today()).length;
  const activeClassCount = classes.filter((row) => row.status === 'active' || row.active).length;
  const totalStudents = classes.reduce((sum, row) => sum + row.studentCount, 0);
  const recordedAttendanceCount = visibleAttendance.length;

  useEffect(() => {
    if (view !== 'attendance') return;
    if (selectedScheduleId && daySchedule.some((item) => item.id === selectedScheduleId)) return;
    const next = daySchedule[0] || null;
    setSelectedScheduleId(next?.id || '');
    if (next) {
      setSelectedClassId(next.classId);
      replaceQuery({ lessonId: next.id, classId: next.classId });
    }
  }, [daySchedule, selectedScheduleId, view]);

  useEffect(() => {
    if (!selectedSchedule) {
      setLessonStatus('scheduled');
      setLessonCancelReason('');
      return;
    }
    setLessonStatus(selectedSchedule.status);
    setLessonCancelReason(selectedSchedule.cancelReason || '');
    if (selectedSchedule.classId !== selectedClassId) {
      setSelectedClassId(selectedSchedule.classId);
    }
  }, [selectedClassId, selectedSchedule]);

  if (!academyId) return <MissingAcademy />;

  const selectClass = (classId: string) => {
    setSelectedClassId(classId);
    replaceQuery({ classId });
  };

  const changeScheduleClassFilter = (classId: string) => {
    setScheduleClassFilter(classId);
    replaceQuery({ classId: classId || null, lessonId: null });
  };

  const changeDate = (date: string) => {
    const nextDate = date || today();
    setSelectedDate(nextDate);
    setSelectedScheduleId('');
    replaceQuery({ date: nextDate, lessonId: null });
  };

  const selectSchedule = (item: ScheduleItem) => {
    setSelectedScheduleId(item.id);
    setSelectedClassId(item.classId);
    setSelectedDate(item.date);
    replaceQuery({ lessonId: item.id, classId: item.classId, date: item.date });
  };

  const resetClassForm = () => {
    setEditingClassId('');
    setClassName('');
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
    setClassName(row.name);
    setGrade(row.grade || '');
    setClassStatus((row.status as ClassStatus) || (row.active ? 'active' : 'inactive'));
    setCapacity(row.capacity === null ? '' : String(row.capacity));
    setClassColor(row.color || '#059669');
    setDefaultInstructorId(row.defaultInstructorId || '');
    setDefaultClassroomId(row.defaultClassroomId || '');
  };

  const submitClass = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        name: className,
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
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 저장에 실패했습니다.');
    }
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
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강의실 저장에 실패했습니다.');
    }
  };

  const resetRuleForm = () => {
    setEditingRuleId('');
    setRuleActive(true);
    setDayOfWeek(0);
    setStartTime('16:00');
    setEndTime('18:00');
    setRuleStartDate(today());
    setRuleEndDate('');
  };

  const editRule = (row: ScheduleRuleSummary) => {
    setEditingRuleId(row.id);
    setSelectedClassId(row.classId);
    setRuleActive(row.active);
    setDayOfWeek(row.dayOfWeek);
    setStartTime(row.startTime);
    setEndTime(row.endTime);
    setRuleStartDate(row.startDate);
    setRuleEndDate(row.endDate || '');
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
        startDate: ruleStartDate,
        endDate: ruleEndDate || null,
      };
      if (editingRuleId) {
        await updateScheduleRule(academyId, editingRuleId, { ...payload, active: ruleActive });
        toast.success('반복 시간표를 수정했습니다.');
      } else {
        await createScheduleRule(academyId, payload);
        toast.success('반복 시간표를 추가했습니다.');
      }
      resetRuleForm();
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시간표 저장에 실패했습니다.');
    }
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
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반복 시간표 중지에 실패했습니다.');
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
      await loadBase({ force: true });
      await loadClassDetail({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '교재 저장에 실패했습니다.');
    }
  };

  const submitClassBook = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedClassId || !selectedBookId) return;
    try {
      await setClassBook(academyId, selectedClassId, selectedBookId, true);
      toast.success('교재를 배정했습니다.');
      setSelectedBookId('');
      await loadClassDetail({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '교재 배정에 실패했습니다.');
    }
  };

  const removeClassBook = async (bookId: string) => {
    try {
      await setClassBook(academyId, selectedClassId, bookId, false);
      toast.success('교재 배정을 해제했습니다.');
      await loadClassDetail({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '교재 배정 해제에 실패했습니다.');
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
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '출결 기록에 실패했습니다.');
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
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수업 상태 저장에 실패했습니다.');
    }
  };

  const pageMeta = {
    overview: {
      title: '반 운영',
      description: '반별 학생, 교재, 운영 상태를 한 화면에서 확인합니다.',
      icon: Users,
    },
    schedule: {
      title: '시간표',
      description: '다가오는 수업을 날짜, 반, 강사, 강의실 기준으로 확인합니다.',
      icon: CalendarRange,
    },
    attendance: {
      title: '출결',
      description: '날짜와 수업을 선택한 뒤 학생 출결과 수업 상태를 기록합니다.',
      icon: ClipboardCheck,
    },
    settings: {
      title: '반 운영 설정',
      description: '반, 강의실, 반복 시간표, 교재 기준 정보를 관리합니다.',
      icon: Settings,
    },
  }[view];

  const actions = (
    <Button type="button" variant="outline" onClick={() => loadBase({ force: true })}>
      <RefreshCw className="mr-2 h-4 w-4" />
      새로고침
    </Button>
  );

  const status = refreshing ? (
    <PageStatusBar tone="info">최신 반/시간표 데이터를 다시 불러오는 중입니다.</PageStatusBar>
  ) : undefined;

  const renderOverview = () => (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="운영 반" value={`${activeClassCount}개`} hint={`전체 ${classes.length}개 반`} icon={Users} tone="primary" />
        <StatCard label="배정 학생" value={`${totalStudents}명`} hint="반별 중복 포함" icon={CheckCircle2} tone="success" />
        <StatCard label="오늘 수업" value={`${todayLessons}회`} hint="오늘 예정/진행 수업" icon={CalendarDays} tone="info" />
        <StatCard label="주의 유형" value={`${classes.reduce((sum, row) => sum + row.weakTypeCount, 0)}개`} hint="반별 취약 유형 합계" icon={BookOpen} tone="warning" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <ClassPicker classes={classes} selectedClassId={selectedClassId} onSelectClass={selectClass} />
        <Card>
          <CardHeader>
            <CardTitle>{selectedClass ? `${selectedClass.name} 운영 요약` : '반 운영 요약'}</CardTitle>
          </CardHeader>
          <CardContent>
            {detailLoading ? (
              <LoadingBlock />
            ) : selectedClass ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">재원 학생</div>
                  <div className="rounded-lg border bg-card">
                    {classStudents.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">배정된 학생이 없습니다.</p>
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
                  <div className="text-sm font-medium text-foreground">배정 교재</div>
                  {canManageClassSetup && (
                    <form onSubmit={submitClassBook} className="flex gap-2">
                      <SelectField value={selectedBookId} onChange={(event) => setSelectedBookId(event.target.value)}>
                        <option value="">교재 선택</option>
                        {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
                      </SelectField>
                      <Button type="submit" disabled={!selectedBookId}>배정</Button>
                    </form>
                  )}
                  <div className="rounded-lg border bg-card">
                    {classBooks.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">배정된 교재가 없습니다.</p>
                    ) : (
                      classBooks.map((book) => (
                        <div key={book.id} className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-0">
                          <div>
                            <div className="text-sm font-medium">{book.title}</div>
                            <div className="text-xs text-muted-foreground">{book.subject || '-'} · {book.grade || '-'}</div>
                          </div>
                          {canManageClassSetup && (
                            <Button type="button" variant="outline" size="sm" onClick={() => removeClassBook(book.id)}>
                              해제
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <div className="mb-3 text-sm font-medium text-foreground">다가오는 수업</div>
                  <ScheduleTable schedule={selectedClassSchedule.slice(0, 6)} />
                </div>
              </div>
            ) : (
              <EmptyState title="반을 선택하세요" description="왼쪽 목록에서 운영 정보를 볼 반을 선택하세요." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderSchedule = () => (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="표시 수업" value={`${filteredSchedule.length}회`} hint="선택 필터 기준" icon={CalendarDays} tone="primary" />
        <StatCard label="완료" value={`${filteredSchedule.filter((item) => item.status === 'completed').length}회`} hint="수업 상태 기준" icon={CheckCircle2} tone="success" />
        <StatCard label="변경/취소" value={`${filteredSchedule.filter((item) => item.status === 'cancelled' || item.status === 'substitute').length}회`} hint="취소와 대강 포함" icon={Clock} tone="warning" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>수업 일정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[240px_1fr]">
            <div>
              <Label>반 필터</Label>
              <SelectField value={scheduleClassFilter} onChange={(event) => changeScheduleClassFilter(event.target.value)}>
                <option value="">전체 반</option>
                {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
            </div>
          </div>
          <ScheduleTable schedule={filteredSchedule} />
        </CardContent>
      </Card>
    </div>
  );

  const renderAttendance = () => (
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>수업 선택</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>날짜</Label>
                <Input type="date" value={selectedDate} onChange={(event) => changeDate(event.target.value)} />
              </div>
              <div>
                <Label>반 필터</Label>
                <SelectField value={scheduleClassFilter} onChange={(event) => changeScheduleClassFilter(event.target.value)}>
                  <option value="">전체 반</option>
                  {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectField>
              </div>
            </div>
            <div className="space-y-2">
              {daySchedule.map((item) => (
                <SelectableCard
                  key={item.id}
                  selected={selectedScheduleId === item.id}
                  onClick={() => selectSchedule(item)}
                  className="flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold">{item.className}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{item.startTime} - {item.endTime} · {item.instructorName || '-'} · {item.classroomName || '-'}</div>
                  </div>
                  <StatusBadge status={item.status} label={lessonStatusLabels[item.status]} />
                </SelectableCard>
              ))}
              {daySchedule.length === 0 && (
                <EmptyState title="선택한 날짜의 수업이 없습니다" description="다른 날짜나 반 필터를 선택하세요." />
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>선택일 출결 기록</CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceTable attendance={visibleAttendance} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{selectedSchedule ? `${selectedSchedule.className} 출결 처리` : '출결 처리'}</CardTitle>
        </CardHeader>
        <CardContent>
          {detailLoading ? (
            <LoadingBlock />
          ) : selectedSchedule ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <form onSubmit={submitAttendance} className="space-y-3 rounded-lg border bg-card p-4">
                <div className="text-sm font-medium text-foreground">학생 출결</div>
                <div>
                  <Label>학생</Label>
                  <SelectField value={attendanceStudentId} onChange={(event) => setAttendanceStudentId(event.target.value)}>
                    {classStudents.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                  </SelectField>
                </div>
                <div>
                  <Label>상태</Label>
                  <SelectField value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value as AttendanceStatus)}>
                    {attendanceStatuses.map((status) => (
                      <option key={status} value={status}>{attendanceStatusLabels[status]}</option>
                    ))}
                  </SelectField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>출석 분</Label>
                    <Input type="number" min="0" placeholder={String(selectedDuration)} value={attendedMinutes} onChange={(event) => setAttendedMinutes(event.target.value)} />
                  </div>
                  <div>
                    <Label>청구 분</Label>
                    <Input type="number" min="0" placeholder={String(selectedDuration)} value={billableMinutes} onChange={(event) => setBillableMinutes(event.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>메모</Label>
                  <Input value={attendanceNotes} onChange={(event) => setAttendanceNotes(event.target.value)} placeholder="출결 메모" />
                </div>
                <Button type="submit" className="w-full" disabled={!attendanceStudentId}>출결 저장</Button>
              </form>
              <form onSubmit={submitLessonStatus} className="space-y-3 rounded-lg border bg-card p-4">
                <div className="text-sm font-medium text-foreground">수업 상태</div>
                <div>
                  <Label>상태</Label>
                  <SelectField value={lessonStatus} onChange={(event) => setLessonStatus(event.target.value as LessonOccurrenceStatus)}>
                    {lessonStatuses.map((status) => (
                      <option key={status} value={status}>{lessonStatusLabels[status]}</option>
                    ))}
                  </SelectField>
                </div>
                <div>
                  <Label>취소/운영 메모</Label>
                  <Input value={lessonCancelReason} onChange={(event) => setLessonCancelReason(event.target.value)} />
                </div>
                <Button type="submit" variant="outline" className="w-full">수업 상태 저장</Button>
              </form>
            </div>
          ) : (
            <EmptyState title="수업을 선택하세요" description="왼쪽에서 출결을 기록할 수업을 선택하세요." />
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderSettings = () => {
    if (!canManageClassSetup) {
      return (
        <ErrorState
          title="운영 설정 권한이 없습니다"
          description="반, 강의실, 시간표, 교재 기준 정보는 관리자 또는 직원만 수정할 수 있습니다."
        />
      );
    }

    return (
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{editingClassId ? '반 수정' : '반 추가'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitClass} className="space-y-3">
              <div>
                <Label htmlFor="class-name">반 이름</Label>
                <Input id="class-name" value={className} onChange={(event) => setClassName(event.target.value)} placeholder="중1 A반" />
              </div>
              <div>
                <Label htmlFor="class-grade">학년/레벨</Label>
                <Input id="class-grade" value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중1" />
              </div>
              {editingClassId && (
                <div>
                  <Label>상태</Label>
                  <SelectField value={classStatus} onChange={(event) => setClassStatus(event.target.value as ClassStatus)}>
                    {classStatuses.map((status) => <option key={status} value={status}>{classStatusLabels[status]}</option>)}
                  </SelectField>
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
                <Label>담당 강사</Label>
                <SelectField value={defaultInstructorId} onChange={(event) => setDefaultInstructorId(event.target.value)}>
                  <option value="">미지정</option>
                  {staff.filter((row) => row.status === 'active').map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </SelectField>
              </div>
              <div>
                <Label>기본 강의실</Label>
                <SelectField value={defaultClassroomId} onChange={(event) => setDefaultClassroomId(event.target.value)}>
                  <option value="">미지정</option>
                  {classrooms.filter((row) => row.active).map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </SelectField>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  {editingClassId ? '반 수정' : '반 생성'}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={resetClassForm}>입력 초기화</Button>
              </div>
            </form>
            <div className="mt-4 space-y-2">
              {classes.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: swatchColor(row.color) }} />
                      {row.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{classSummaryHint(row)}</div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => editClass(row)}>수정</Button>
                </div>
              ))}
            </div>
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
                  <SelectField value={classroomActive ? 'active' : 'inactive'} onChange={(event) => setClassroomActive(event.target.value === 'active')}>
                    <option value="active">운영</option>
                    <option value="inactive">중지</option>
                  </SelectField>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" className="w-full">{editingClassroomId ? '강의실 수정' : '강의실 추가'}</Button>
                <Button type="button" variant="outline" className="w-full" onClick={resetClassroomForm}>입력 초기화</Button>
              </div>
            </form>
            <div className="mt-4 space-y-2">
              {classrooms.map((room) => (
                <div key={room.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: swatchColor(room.color) }} />
                      {room.name}
                    </div>
                    <div className="text-xs text-muted-foreground">정원 {room.capacity ?? '-'}명</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={room.active ? 'active' : 'inactive'} />
                    <Button type="button" variant="outline" size="sm" onClick={() => editClassroom(room)}>수정</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingRuleId ? '반복 시간표 수정' : '반복 시간표 추가'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitRule} className="space-y-3">
              <div>
                <Label>반</Label>
                <SelectField value={selectedClassId} onChange={(event) => selectClass(event.target.value)}>
                  {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectField>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>요일</Label>
                  <SelectField value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>
                    {dayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
                  </SelectField>
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>시작일</Label>
                  <Input type="date" value={ruleStartDate} onChange={(event) => setRuleStartDate(event.target.value)} />
                </div>
                <div>
                  <Label>종료일</Label>
                  <Input type="date" value={ruleEndDate} onChange={(event) => setRuleEndDate(event.target.value)} />
                </div>
              </div>
              {editingRuleId && (
                <div>
                  <Label>상태</Label>
                  <SelectField value={ruleActive ? 'active' : 'inactive'} onChange={(event) => setRuleActive(event.target.value === 'active')}>
                    <option value="active">운영</option>
                    <option value="inactive">중지</option>
                  </SelectField>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" className="w-full">{editingRuleId ? '시간표 수정' : '시간표 추가'}</Button>
                <Button type="button" variant="outline" className="w-full" onClick={resetRuleForm}>입력 초기화</Button>
              </div>
            </form>
            <div className="mt-4 space-y-2">
              {classRules.map((rule) => (
                <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
                  <div>
                    <div className="font-medium">{dayLabels[rule.dayOfWeek]} {rule.startTime}-{rule.endTime}</div>
                    <div className="text-xs text-muted-foreground">
                      {rule.startDate}부터{rule.endDate ? ` ${rule.endDate}까지` : ''} · {rule.instructorName || '-'} · {rule.classroomName || '-'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={rule.active ? 'active' : 'inactive'} />
                    <Button type="button" variant="outline" size="sm" onClick={() => editRule(rule)}>수정</Button>
                    {rule.active && <Button type="button" variant="outline" size="sm" onClick={() => stopRule(rule)}>중지</Button>}
                  </div>
                </div>
              ))}
              {classRules.length === 0 && (
                <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">선택한 반의 반복 시간표가 없습니다.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingBookId ? '교재 수정' : '교재 추가'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitBookRecord} className="space-y-3">
              <div>
                <Label>교재명</Label>
                <Input value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder="교재명" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>과목</Label>
                  <Input value={bookSubject} onChange={(event) => setBookSubject(event.target.value)} />
                </div>
                <div>
                  <Label>학년</Label>
                  <Input value={bookGrade} onChange={(event) => setBookGrade(event.target.value)} />
                </div>
              </div>
              <div>
                <Label>Book key</Label>
                <Input value={bookKey} onChange={(event) => setBookKey(event.target.value)} placeholder="비워두면 자동 생성" disabled={Boolean(editingBookId)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" className="w-full">{editingBookId ? '교재 수정' : '교재 추가'}</Button>
                <Button type="button" variant="outline" className="w-full" onClick={resetBookForm}>입력 초기화</Button>
              </div>
            </form>
            <div className="mt-4 space-y-2">
              {books.map((book) => (
                <div key={book.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
                  <div>
                    <div className="font-medium">{book.title}</div>
                    <div className="text-xs text-muted-foreground">{book.subject || '-'} · {book.grade || '-'}</div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => editBook(book)}>수정</Button>
                </div>
              ))}
              {books.length === 0 && (
                <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">등록된 교재가 없습니다.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <PageShell title={pageMeta.title} description={pageMeta.description} icon={pageMeta.icon} actions={actions} status={status}>
      {loading && <LoadingBlock />}
      {!loading && view === 'overview' && renderOverview()}
      {!loading && view === 'schedule' && renderSchedule()}
      {!loading && view === 'attendance' && renderAttendance()}
      {!loading && view === 'settings' && renderSettings()}
    </PageShell>
  );
}
