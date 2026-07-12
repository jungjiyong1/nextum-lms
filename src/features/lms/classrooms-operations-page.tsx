'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  CalendarRange,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Edit3,
  List,
  Plus,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
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
import { EmptyState, ErrorState } from '@/components/ui/state';
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
import { SelectField } from '@/components/ui/select-field';
import { SelectableCard } from '@/components/ui/selectable-card';
import { SkeletonPanel } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  canCreateClass as canCreateClassForRole,
  canManageGlobalClassResources,
} from '@/core/auth/roles';
import {
  addLmsInvalidationListener,
  createBook,
  createClass,
  createClassroom,
  loadClassDirectory,
  loadClassOperationsDetail,
  loadClassOperationsOverview,
  setClassBook,
  updateBook,
  updateClass,
  updateClassroom,
  updateLessonOccurrence,
} from './service';
import type {
  AttendanceRow,
  AttendanceStatus,
  BookSummary,
  ClassBookSummary,
  ClassCourseOption,
  ClassDirectoryFacetOption,
  ClassOperationsTruncation,
  ClassOperationsPermissions,
  ClassStatus,
  ClassStudentSummary,
  ClassSummary,
  ClassroomSummary,
  ScheduleItem,
  ScheduleRuleSummary,
  StaffSummary,
} from './types';
import {
  canCreateSchedule,
  canOperateClass,
  canUpdateOccurrenceStatus,
  NO_CLASS_OPERATIONS_PERMISSIONS,
} from './classrooms/class-operation-permissions';
import { toggleClassInstructorId } from './class-instructors';
import { LessonSpecialStatusBadge } from './classrooms/lesson-special-status-badge';
import {
  addDateValue,
  lessonSpecialStatusSelection,
  resolveLessonOccurrenceStatus,
  safeScheduleClassColor,
  scheduleClassTint,
  specialLessonStatusLabels,
  specialLessonStatuses,
  startOfWeekValue,
  type LessonSpecialStatusSelection,
} from './classrooms/schedule-utils';

const AttendanceRoster = dynamic(
  () => import('./classrooms/attendance-roster').then((module) => module.AttendanceRoster),
  { loading: () => <SkeletonPanel className="min-h-[320px]" rows={6} /> },
);
const ClassMemberDialog = dynamic(
  () => import('./classrooms/class-member-dialog').then((module) => module.ClassMemberDialog),
  { loading: () => null },
);
const ScheduleEditorDialog = dynamic(
  () => import('./classrooms/schedule-editor-dialog').then((module) => module.ScheduleEditorDialog),
  { loading: () => null },
);
const ScheduleWeekView = dynamic(
  () => import('./classrooms/schedule-week-view').then((module) => module.ScheduleWeekView),
  { loading: () => <SkeletonPanel className="min-h-[420px]" rows={7} /> },
);

type ClassroomsView = 'overview' | 'schedule' | 'attendance' | 'settings';
type ClassDetailSection = 'students' | 'materials' | 'settings';
type LmsPageLoadOptions = { force?: boolean; background?: boolean };

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

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDaysString(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
    return { classId: '', lessonId: '', date: today(), week: startOfWeekValue(today()), mode: 'week' as const };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    classId: params.get('classId') || '',
    lessonId: params.get('lessonId') || '',
    date: params.get('date') || today(),
    week: startOfWeekValue(params.get('week') || params.get('date') || today()),
    mode: params.get('mode') === 'list' ? 'list' as const : 'week' as const,
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
  onAddClass,
  canManage,
}: {
  classes: ClassSummary[];
  selectedClassId: string;
  onSelectClass: (classId: string) => void;
  onAddClass: () => void;
  canManage: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const filtered = classes.filter((row) => {
    const matchesQuery = !query.trim() || row.name.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR'));
    const matchesStatus = status === 'all' || row.status === status;
    return matchesQuery && matchesStatus;
  });
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>반 목록</CardTitle>
          {canManage && <Button type="button" size="sm" onClick={onAddClass}><Plus className="mr-1 h-4 w-4" />반 추가</Button>}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px] xl:grid-cols-1 2xl:grid-cols-[1fr_120px]">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="반 이름 검색" />
          <SelectField value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">운영 중</option>
            <option value="inactive">중지</option>
            <option value="archived">보관</option>
            <option value="all">전체</option>
          </SelectField>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filtered.map((row) => (
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
        {filtered.length === 0 && (
          <EmptyState
            title={classes.length === 0 ? '등록된 반이 없습니다' : '조건에 맞는 반이 없습니다'}
            description={classes.length === 0 ? '첫 반을 만들고 학생과 시간표를 연결하세요.' : '검색어나 상태 필터를 바꿔보세요.'}
            action={classes.length === 0 && canManage ? <Button type="button" onClick={onAddClass}>첫 반 만들기</Button> : undefined}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleTable({
  schedule,
  onSelect,
  canSelect = () => true,
}: {
  schedule: ScheduleItem[];
  onSelect?: (item: ScheduleItem) => void;
  canSelect?: (item: ScheduleItem) => boolean;
}) {
  const hasManageableRows = Boolean(onSelect && schedule.some((item) => canSelect(item)));
  return (
    <>
      <div className="space-y-2 lg:hidden">
        {schedule.map((item) => (
          <div
            key={item.id}
            className="space-y-3 rounded-xl border bg-card p-3"
            style={{
              borderLeftColor: safeScheduleClassColor(item.classColor),
              borderLeftWidth: 4,
              backgroundColor: scheduleClassTint(item.classColor, '0d'),
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{item.className}</p>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">{item.date} · {item.startTime}-{item.endTime}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.instructorName || '강사 미지정'} · {item.classroomName || '강의실 미지정'}</p>
              </div>
              <LessonSpecialStatusBadge status={item.status} />
            </div>
            {onSelect && canSelect(item) && <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => onSelect(item)}>보기·수정</Button>}
          </div>
        ))}
        {schedule.length === 0 && <EmptyState title="표시할 수업이 없습니다" />}
      </div>
      <div className="hidden lg:block">
        <DataTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">날짜</TableHead>
                <TableHead className="px-4 py-3 font-medium">시간</TableHead>
                <TableHead className="px-4 py-3 font-medium">반</TableHead>
                <TableHead className="px-4 py-3 font-medium">강사/강의실</TableHead>
                <TableHead className="px-4 py-3 font-medium">특이사항</TableHead>
                {hasManageableRows && <TableHead className="px-4 py-3 text-right font-medium">관리</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.map((item) => (
                <TableRow key={item.id} style={{ backgroundColor: scheduleClassTint(item.classColor, '08') }}>
                  <TableCell className="px-4 py-3">{item.date}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{item.startTime} - {item.endTime}</TableCell>
                  <TableCell className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: safeScheduleClassColor(item.classColor) }} />
                      {item.className}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{item.instructorName || '-'} · {item.classroomName || '-'}</TableCell>
                  <TableCell className="px-4 py-3"><LessonSpecialStatusBadge status={item.status} /></TableCell>
                  {hasManageableRows && (
                    <TableCell className="px-4 py-3 text-right">
                      {onSelect && canSelect(item) && <Button type="button" variant="outline" size="sm" onClick={() => onSelect(item)}>보기·수정</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {schedule.length === 0 && (
                <TableRow>
                  <TableCell colSpan={hasManageableRows ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
                    표시할 수업이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DataTable>
      </div>
    </>
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

export function ClassroomsOperationsPage({
  view,
  initialClassId,
  detailSection,
}: {
  view: ClassroomsView;
  initialClassId?: string;
  detailSection?: ClassDetailSection;
}) {
  const academyId = useAcademyId();
  const router = useRouter();
  const { profile } = useAuth();
  const roleCanManageGlobalResources = canManageGlobalClassResources(profile?.role);
  const roleCanCreateClass = canCreateClassForRole(profile?.role);
  const initialQuery = useMemo(() => {
    const query = readInitialQuery();
    return initialClassId ? { ...query, classId: initialClassId } : query;
  }, [initialClassId]);

  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [scheduleRules, setScheduleRules] = useState<ScheduleRuleSummary[]>([]);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [classBooks, setClassBooks] = useState<ClassBookSummary[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudentSummary[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [courseOptions, setCourseOptions] = useState<ClassCourseOption[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<ClassDirectoryFacetOption[]>([]);
  const [operationPermissions, setOperationPermissions] = useState<ClassOperationsPermissions>(NO_CLASS_OPERATIONS_PERMISSIONS);
  const [truncated, setTruncated] = useState<ClassOperationsTruncation>({
    classes: false,
    scheduleRules: false,
    occurrences: false,
    attendance: false,
    books: false,
    staff: false,
    classrooms: false,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState(initialQuery.classId);
  const [scheduleClassFilter, setScheduleClassFilter] = useState(initialQuery.classId);
  const [selectedScheduleId, setSelectedScheduleId] = useState(initialQuery.lessonId);
  const [selectedDate, setSelectedDate] = useState(initialQuery.date);
  const [weekStart, setWeekStart] = useState(initialQuery.week);
  const [scheduleMode, setScheduleMode] = useState<'week' | 'list'>(initialQuery.mode);
  const [scheduleInstructorFilter, setScheduleInstructorFilter] = useState('');
  const [scheduleClassroomFilter, setScheduleClassroomFilter] = useState('');
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState('');
  const [classDetailTab, setClassDetailTab] = useState('students');
  const [classDialogOpen, setClassDialogOpen] = useState(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('newClass') === '1'
  ));
  const [classroomDialogOpen, setClassroomDialogOpen] = useState(false);
  const [bookDialogOpen, setBookDialogOpen] = useState(false);
  const [resourceTab, setResourceTab] = useState('classrooms');
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleEditingLesson, setScheduleEditingLesson] = useState<ScheduleItem | null>(null);
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [pendingAttendanceTarget, setPendingAttendanceTarget] = useState<{ date?: string; lesson?: ScheduleItem } | null>(null);

  const [editingClassId, setEditingClassId] = useState('');
  const [className, setClassName] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [grade, setGrade] = useState('');
  const [additionalGrades, setAdditionalGrades] = useState('');
  const [classStatus, setClassStatus] = useState<ClassStatus>('active');
  const [capacity, setCapacity] = useState('');
  const [classColor, setClassColor] = useState('#059669');
  const [classInstructorIds, setClassInstructorIds] = useState<string[]>([]);
  const [defaultClassroomId, setDefaultClassroomId] = useState('');
  const [classNotes, setClassNotes] = useState('');

  const [editingClassroomId, setEditingClassroomId] = useState('');
  const [classroomName, setClassroomName] = useState('');
  const [classroomCapacity, setClassroomCapacity] = useState('');
  const [classroomColor, setClassroomColor] = useState('#64748b');
  const [classroomActive, setClassroomActive] = useState(true);

  const [selectedBookId, setSelectedBookId] = useState('');
  const [editingBookId, setEditingBookId] = useState('');
  const [bookKey, setBookKey] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [bookSubject, setBookSubject] = useState('');
  const [bookGrade, setBookGrade] = useState('');

  const [lessonSpecialStatus, setLessonSpecialStatus] = useState<LessonSpecialStatusSelection>('');
  const [lessonCancelReason, setLessonCancelReason] = useState('');
  const [lessonNotes, setLessonNotes] = useState('');

  const effectivePermissions = useMemo<ClassOperationsPermissions>(() => ({
    ...operationPermissions,
    canCreateClass: operationPermissions.canCreateClass || roleCanCreateClass,
    canManageGlobalResources: operationPermissions.canManageGlobalResources || roleCanManageGlobalResources,
  }), [operationPermissions, roleCanCreateClass, roleCanManageGlobalResources]);
  const canCreateNewClass = effectivePermissions.canCreateClass;
  const canManageGlobalResources = effectivePermissions.canManageGlobalResources;
  const canManageClassById = useCallback(
    (classId: string | null | undefined) => canOperateClass(effectivePermissions, classId),
    [effectivePermissions],
  );
  const canUpdateLessonByItem = useCallback(
    (item: ScheduleItem | null | undefined) => Boolean(item && canUpdateOccurrenceStatus(
      effectivePermissions,
      item.classId,
      item.actualId,
    )),
    [effectivePermissions],
  );

  const loadBase = useCallback(async (options: LmsPageLoadOptions = {}) => {
    if (!academyId) return;
    if (options.background) setRefreshing(true);
    else setLoading(true);
    try {
      const rangeStart = view === 'attendance' ? selectedDate : view === 'schedule' ? weekStart : today();
      const rangeEnd = view === 'attendance' ? selectedDate : addDaysString(rangeStart, view === 'schedule' ? 6 : 14);
      const [data, directoryPage] = await Promise.all([
        loadClassOperationsOverview(academyId, rangeStart, rangeEnd, view, { force: options.force }),
        initialClassId || view === 'settings' || detailSection === 'settings'
          ? loadClassDirectory(academyId, {
              classId: initialClassId || null,
              status: 'all',
              limit: 1,
              force: options.force,
            })
          : Promise.resolve(null),
      ]);

      const selectedSummary = initialClassId ? directoryPage?.classes[0] || null : null;
      const visibleClasses = selectedSummary
        ? data.classes.some((row) => row.id === selectedSummary.id)
          ? data.classes.map((row) => row.id === selectedSummary.id ? { ...row, ...selectedSummary } : row)
          : [selectedSummary, ...data.classes]
        : data.classes;

      setClasses(visibleClasses);
      setSchedule(data.schedule);
      setScheduleRules(data.scheduleRules);
      setBooks(data.books);
      setAttendance(data.attendance);
      setStaff(data.staff);
      setClassrooms(data.classrooms);
      setCourseOptions(data.courses || []);
      setOperationPermissions(data.permissions || NO_CLASS_OPERATIONS_PERMISSIONS);
      setSubjectOptions(directoryPage?.facets.subjects || []);
      setTruncated(data.truncated);
      setSelectedClassId((current) => (
        initialClassId && visibleClasses.some((row) => row.id === initialClassId)
          ? initialClassId
          : current && visibleClasses.some((row) => row.id === current) ? current : visibleClasses[0]?.id || ''
      ));
      setScheduleClassFilter((current) => (
        initialClassId && visibleClasses.some((row) => row.id === initialClassId)
          ? initialClassId
          : current && visibleClasses.some((row) => row.id === current) ? current : ''
      ));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 정보를 불러오지 못했습니다.');
    } finally {
      if (options.background) setRefreshing(false);
      else setLoading(false);
    }
  }, [academyId, detailSection, initialClassId, selectedDate, view, weekStart]);

  const loadClassDetail = useCallback(async (options: LmsPageLoadOptions = {}) => {
    const occurrenceId = view === 'attendance'
      ? schedule.find((item) => item.id === selectedScheduleId)?.actualId || null
      : null;
    const canLoadAttendanceRoster = canUpdateOccurrenceStatus(
      effectivePermissions,
      selectedClassId,
      occurrenceId,
    );
    if (!academyId || !selectedClassId || (!canManageClassById(selectedClassId) && !canLoadAttendanceRoster)) {
      setClassStudents([]);
      setClassBooks([]);
      return;
    }
    if (!options.background) setDetailLoading(true);
    try {
      const data = await loadClassOperationsDetail(academyId, selectedClassId, {
        force: options.force,
        occurrenceId,
      });
      setClassStudents(data.students);
      setClassBooks(data.books);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '반 상세 정보를 불러오지 못했습니다.');
    } finally {
      if (!options.background) setDetailLoading(false);
    }
  }, [academyId, canManageClassById, effectivePermissions, schedule, selectedClassId, selectedScheduleId, view]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadClassDetail();
  }, [loadClassDetail]);

  useEffect(() => {
    if (detailSection === 'students') setClassDetailTab('students');
    if (detailSection === 'materials') setClassDetailTab('books');
    if (detailSection === 'settings') setClassDetailTab('settings');
  }, [detailSection]);

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
  const canManageSelectedClass = canManageClassById(selectedClassId);
  const canCreateScheduleForView = canCreateSchedule(
    effectivePermissions,
    initialClassId || scheduleClassFilter || null,
  );
  const canManageScheduleItem = useCallback(
    (item: ScheduleItem) => canManageClassById(item.classId),
    [canManageClassById],
  );
  const canUpdateSelectedLesson = canUpdateLessonByItem(selectedSchedule);
  const daySchedule = useMemo(() => (
    schedule.filter((item) => item.date === selectedDate && (!scheduleClassFilter || item.classId === scheduleClassFilter))
  ), [schedule, scheduleClassFilter, selectedDate]);
  const filteredSchedule = useMemo(() => (
    schedule.filter((item) => (
      (!scheduleClassFilter || item.classId === scheduleClassFilter)
      && (!scheduleInstructorFilter || item.instructorId === scheduleInstructorFilter)
      && (!scheduleClassroomFilter || item.classroomId === scheduleClassroomFilter)
      && (!scheduleStatusFilter || item.status === scheduleStatusFilter)
    ))
  ), [schedule, scheduleClassFilter, scheduleClassroomFilter, scheduleInstructorFilter, scheduleStatusFilter]);
  const selectedClassSchedule = useMemo(() => (
    schedule.filter((item) => item.classId === selectedClassId)
  ), [schedule, selectedClassId]);
  const visibleAttendance = useMemo(() => (
    attendance.filter((row) => {
      if (view === 'attendance') {
        return row.date === selectedDate && (!scheduleClassFilter || row.classId === scheduleClassFilter);
      }
      return row.classId === selectedClassId;
    })
  ), [attendance, scheduleClassFilter, selectedClassId, selectedDate, view]);

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
      setLessonSpecialStatus('');
      setLessonCancelReason('');
      setLessonNotes('');
      return;
    }
    setLessonSpecialStatus(lessonSpecialStatusSelection(selectedSchedule.status));
    setLessonCancelReason(selectedSchedule.cancelReason || '');
    setLessonNotes(selectedSchedule.notes || '');
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

  const applyDateChange = (date: string) => {
    const nextDate = date || today();
    setSelectedDate(nextDate);
    setSelectedScheduleId('');
    replaceQuery({ date: nextDate, lessonId: null });
  };

  const changeDate = (date: string) => {
    if (attendanceDirty) {
      setPendingAttendanceTarget({ date: date || today() });
      return;
    }
    applyDateChange(date);
  };

  const applyScheduleSelection = (item: ScheduleItem) => {
    setSelectedScheduleId(item.id);
    setSelectedClassId(item.classId);
    setSelectedDate(item.date);
    replaceQuery({ lessonId: item.id, classId: item.classId, date: item.date });
  };

  const selectSchedule = (item: ScheduleItem) => {
    if (attendanceDirty && item.id !== selectedScheduleId) {
      setPendingAttendanceTarget({ lesson: item });
      return;
    }
    applyScheduleSelection(item);
  };

  const changeWeek = (nextWeek: string) => {
    const normalized = startOfWeekValue(nextWeek);
    setWeekStart(normalized);
    setSelectedScheduleId('');
    replaceQuery({ week: normalized, lessonId: null });
  };

  const changeScheduleMode = (mode: 'week' | 'list') => {
    setScheduleMode(mode);
    replaceQuery({ mode });
  };

  const openScheduleEditor = (item: ScheduleItem | null) => {
    if (item ? !canManageScheduleItem(item) : !canCreateScheduleForView) return;
    setScheduleEditingLesson(item);
    setScheduleDialogOpen(true);
  };

  const resetClassForm = () => {
    setEditingClassId('');
    setClassName('');
    setSubjectId('');
    setCourseId('');
    setGrade('');
    setAdditionalGrades('');
    setClassStatus('active');
    setCapacity('');
    setClassColor('#059669');
    setClassInstructorIds([]);
    setDefaultClassroomId('');
    setClassNotes('');
  };

  const editClass = (row: ClassSummary) => {
    if (!canManageClassById(row.id)) return;
    setEditingClassId(row.id);
    setSelectedClassId(row.id);
    setClassName(row.name);
    setSubjectId(row.subjectId || '');
    setCourseId(row.courseId || '');
    const primaryGrade = row.primaryTargetGrade || row.targetGrades?.[0] || row.grade || '';
    setGrade(primaryGrade);
    setAdditionalGrades((row.targetGrades || []).filter((value) => value !== primaryGrade).join(', '));
    setClassStatus((row.status as ClassStatus) || (row.active ? 'active' : 'inactive'));
    setCapacity(row.capacity === null ? '' : String(row.capacity));
    setClassColor(row.color || '#059669');
    const assignedInstructorIds = row.instructorIds?.length
      ? row.instructorIds
      : row.defaultInstructorId ? [row.defaultInstructorId] : [];
    setClassInstructorIds(row.defaultInstructorId
      ? [row.defaultInstructorId, ...assignedInstructorIds.filter((id) => id !== row.defaultInstructorId)]
      : assignedInstructorIds);
    setDefaultClassroomId(row.defaultClassroomId || '');
    setClassNotes(row.notes || '');
    setClassDialogOpen(true);
  };

  const submitClass = async (event: React.FormEvent) => {
    event.preventDefault();
    const primaryGrade = grade.trim();
    const targetGrades = [
      primaryGrade,
      ...additionalGrades.split(',').map((value) => value.trim()).filter(Boolean),
    ].filter((value, index, rows) => value && rows.indexOf(value) === index);
    if (!subjectId) {
      toast.error('과목을 선택하세요.');
      return;
    }
    if (!primaryGrade || targetGrades.length === 0) {
      toast.error('대표 대상 학년을 입력하세요.');
      return;
    }
    try {
      const creating = !editingClassId;
      const payload = {
        name: className,
        subjectId,
        courseId: courseId || null,
        targetGrades,
        grade: primaryGrade,
        capacity: capacity ? Number(capacity) : null,
        color: classColor || null,
        instructorIds: classInstructorIds,
        defaultInstructorId: classInstructorIds[0] || null,
        defaultClassroomId: defaultClassroomId || null,
        notes: classNotes || null,
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
      setClassDialogOpen(false);
      await loadBase({ force: true });
      if (creating) router.push('/classrooms');
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
    setClassroomDialogOpen(true);
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
      setClassroomDialogOpen(false);
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '강의실 저장에 실패했습니다.');
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
    setBookDialogOpen(true);
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
      setBookDialogOpen(false);
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

  const submitLessonStatus = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSchedule) {
      toast.error('수업을 선택하세요.');
      return;
    }
    if (attendanceDirty) {
      toast.warning('출결 변경사항을 먼저 저장하거나 취소하세요.');
      return;
    }
    if (lessonSpecialStatus === 'cancelled' && !lessonCancelReason.trim()) {
      toast.error('수업 취소 사유를 입력하세요.');
      return;
    }
    const status = resolveLessonOccurrenceStatus(lessonSpecialStatus);
    try {
      await updateLessonOccurrence(academyId, {
        occurrenceId: selectedSchedule.actualId,
        classId: selectedSchedule.classId,
        ruleId: selectedSchedule.ruleId,
        date: selectedSchedule.date,
        startTime: selectedSchedule.startTime,
        endTime: selectedSchedule.endTime,
        status,
        cancelReason: lessonSpecialStatus === 'cancelled' ? lessonCancelReason.trim() : null,
        notes: lessonSpecialStatus === 'cancelled' ? undefined : lessonNotes.trim() || null,
      });
      toast.success('수업 특이사항을 저장했습니다.');
      await loadBase({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수업 상태 저장에 실패했습니다.');
    }
  };

  const pageMeta = {
    overview: {
      title: '반 운영',
      icon: Users,
    },
    schedule: {
      title: '시간표',
      icon: CalendarRange,
    },
    attendance: {
      title: '출결',
      icon: ClipboardCheck,
    },
    settings: {
      title: '기준 정보',
      icon: Settings,
    },
  }[view];

  const startClassCreate = () => {
    if (!canCreateNewClass) return;
    resetClassForm();
    setClassDialogOpen(true);
  };

  const startClassroomCreate = () => {
    resetClassroomForm();
    setResourceTab('classrooms');
    setClassroomDialogOpen(true);
  };

  const startBookCreate = () => {
    resetBookForm();
    setResourceTab('books');
    setBookDialogOpen(true);
  };

  const actions = (
    <div className="flex flex-wrap gap-2">
      {view === 'overview' && !initialClassId && !detailSection && canManageGlobalResources && (
        <Button type="button" variant="outline" asChild><Link href="/classrooms/settings"><SlidersHorizontal className="mr-2 h-4 w-4" />기준 정보</Link></Button>
      )}
      {view === 'schedule' && canCreateScheduleForView && (
        <Button type="button" onClick={() => openScheduleEditor(null)}><Plus className="mr-2 h-4 w-4" />시간표 추가</Button>
      )}
      {view === 'settings' && canManageGlobalResources && (
        <>
          <Button type="button" onClick={startClassroomCreate}><Plus className="mr-2 h-4 w-4" />강의실 추가</Button>
          <Button type="button" variant="outline" onClick={startBookCreate}><Plus className="mr-2 h-4 w-4" />교재 추가</Button>
        </>
      )}
      <Button type="button" variant="outline" onClick={() => loadBase({ force: true })}>
        <RefreshCw className="mr-2 h-4 w-4" />새로고침
      </Button>
    </div>
  );

  const truncatedLabels = Object.entries({
    classes: '반',
    scheduleRules: '반복 시간표',
    occurrences: '수업 일정',
    attendance: '출결',
    books: '교재',
    staff: '강사/직원',
    classrooms: '강의실',
  }).filter(([key]) => truncated[key as keyof ClassOperationsTruncation]).map(([, label]) => label);

  const status = refreshing ? (
    <PageStatusBar tone="info">최신 반/시간표 데이터를 다시 불러오는 중입니다.</PageStatusBar>
  ) : truncatedLabels.length > 0 ? (
    <PageStatusBar tone="warning">
      {truncatedLabels.join(', ')} 데이터가 안전 한도를 넘어 일부만 표시됩니다. 반 또는 날짜 범위를 좁혀 확인하세요.
    </PageStatusBar>
  ) : undefined;

  const renderOverview = () => (
    <div className={initialClassId || detailSection ? 'block' : 'grid gap-5 xl:grid-cols-[0.9fr_1.1fr]'}>
      {!initialClassId && !detailSection && (
        <ClassPicker
          classes={classes}
          selectedClassId={selectedClassId}
          onSelectClass={selectClass}
          onAddClass={startClassCreate}
          canManage={canCreateNewClass}
        />
      )}
      <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{selectedClass ? selectedClass.name : '반 운영 요약'}</CardTitle>
                  {selectedClass && <StatusBadge status={selectedClass.status} />}
                </div>
                {selectedClass && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedClass.grade || '학년 미지정'} · 학생 {selectedClass.studentCount}명 / 정원 {selectedClass.capacity ?? '-'}명 · {selectedClass.instructorName || '강사 미지정'} · {selectedClass.classroomName || '강의실 미지정'}
                  </p>
                )}
              </div>
              {selectedClass && (
                <div className="flex flex-wrap gap-2">
                  {canManageSelectedClass && <Button type="button" variant="outline" size="sm" onClick={() => editClass(selectedClass)}><Edit3 className="mr-1 h-4 w-4" />수정</Button>}
                  <Button type="button" variant="outline" size="sm" asChild><Link href={initialClassId ? `/classrooms/${selectedClass.id}/schedule` : `/classrooms/schedule?classId=${selectedClass.id}&week=${weekStart}`}>시간표</Link></Button>
                  <Button type="button" variant="outline" size="sm" asChild><Link href={`/classrooms/attendance?classId=${selectedClass.id}&date=${today()}`}>출결</Link></Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {detailLoading ? (
              <LoadingBlock />
            ) : selectedClass ? (
              <Tabs value={classDetailTab} onValueChange={setClassDetailTab} variant="underline">
                <TabsList className={detailSection ? 'hidden' : 'w-full justify-start overflow-x-auto'}>
                  <TabsTrigger value="students">학생 {classStudents.filter((student) => student.status === 'active').length}</TabsTrigger>
                  <TabsTrigger value="books">교재 {classBooks.length}</TabsTrigger>
                  <TabsTrigger value="schedule">다가오는 수업 {selectedClassSchedule.length}</TabsTrigger>
                  <TabsTrigger value="settings">설정</TabsTrigger>
                </TabsList>
                <TabsContent value="students" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">재원 학생</p>
                    {canManageSelectedClass && <Button type="button" size="sm" onClick={() => setMemberDialogOpen(true)}><UserPlus className="mr-1 h-4 w-4" />학생 배정</Button>}
                  </div>
                  <div className="rounded-lg border bg-card">
                    {classStudents.length === 0 ? (
                      <EmptyState title="배정된 학생이 없습니다" description="학생을 검색해 이 반에 배정하세요." action={canManageSelectedClass ? <Button type="button" onClick={() => setMemberDialogOpen(true)}>학생 추가</Button> : undefined} className="border-0" />
                    ) : (
                      classStudents.map((student) => (
                        <div key={student.id} className="flex items-center justify-between border-b px-4 py-3 last:border-0">
                          <div>
                            <span className="text-sm font-medium">{student.name}</span>
                            <p className="mt-1 text-xs text-muted-foreground">{student.primaryClass ? '주 반' : '추가 반'}{student.joinedAt ? ` · ${student.joinedAt.slice(0, 10)} 배정` : ''}</p>
                          </div>
                          <StatusBadge status={student.status} label={student.status === 'active' ? '재원' : undefined} />
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="books" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">배정 교재</p>
                      <p className="mt-1 text-xs text-muted-foreground">기존 교재를 배정하거나 새 교재를 등록하세요.</p>
                    </div>
                    {canManageGlobalResources && (
                      <Button type="button" variant="outline" size="sm" onClick={startBookCreate}>
                        <Plus className="mr-1 h-4 w-4" />교재 추가
                      </Button>
                    )}
                  </div>
                  {canManageSelectedClass && (
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
                          {canManageSelectedClass && (
                            <Button type="button" variant="outline" size="sm" onClick={() => removeClassBook(book.id)}>
                              해제
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="schedule" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">다가오는 수업</p>
                    <Button type="button" variant="outline" size="sm" asChild><Link href={initialClassId ? `/classrooms/${selectedClass.id}/schedule` : `/classrooms/schedule?classId=${selectedClass.id}&week=${weekStart}`}>전체 시간표 보기</Link></Button>
                  </div>
                  <ScheduleTable schedule={selectedClassSchedule.slice(0, 8)} />
                </TabsContent>
                <TabsContent value="settings" className="space-y-4">
                  <dl className="grid gap-4 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">대상 학년</dt><dd className="mt-1 font-medium">{selectedClass.targetGrades?.join(', ') || selectedClass.grade || '미설정'}</dd></div>
                    <div><dt className="text-muted-foreground">과목</dt><dd className="mt-1 font-medium">{selectedClass.subjectName || '과목 미설정'}</dd></div>
                    <div><dt className="text-muted-foreground">세부 과정</dt><dd className="mt-1 font-medium">{selectedClass.courseTitle || '미설정'}</dd></div>
                    <div><dt className="text-muted-foreground">반 색상</dt><dd className="mt-1 flex items-center gap-2 font-medium"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedClass.color || '#64748b' }} />{selectedClass.color || '기본색'}</dd></div>
                  </dl>
                  {canManageSelectedClass && <Button type="button" onClick={() => editClass(selectedClass)}><Edit3 className="mr-2 h-4 w-4" />반 설정 수정</Button>}
                </TabsContent>
              </Tabs>
            ) : (
              <EmptyState title="반을 선택하세요" description="왼쪽 목록에서 운영 정보를 볼 반을 선택하세요." />
            )}
          </CardContent>
      </Card>
    </div>
  );

  const renderSchedule = () => (
    <Card>
      <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>주간 수업 일정</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{weekStart}부터 {addDateValue(weekStart, 6)}까지</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => changeWeek(addDateValue(weekStart, -7))} aria-label="이전 주"><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" size="sm" onClick={() => changeWeek(today())}>이번 주</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => changeWeek(addDateValue(weekStart, 7))} aria-label="다음 주"><ChevronRight className="h-4 w-4" /></Button>
              <span className="hidden gap-2 lg:flex">
                <Button type="button" variant={scheduleMode === 'week' ? 'default' : 'outline'} size="sm" onClick={() => changeScheduleMode('week')}><CalendarRange className="mr-1 h-4 w-4" />주간표</Button>
                <Button type="button" variant={scheduleMode === 'list' ? 'default' : 'outline'} size="sm" onClick={() => changeScheduleMode('list')}><List className="mr-1 h-4 w-4" />목록</Button>
              </span>
            </div>
          </div>
      </CardHeader>
      <CardContent className="space-y-4">
          <div className={initialClassId ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4'}>
            {!initialClassId && <div>
              <Label>반 필터</Label>
              <SelectField value={scheduleClassFilter} onChange={(event) => changeScheduleClassFilter(event.target.value)}>
                <option value="">전체 반</option>
                {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
            </div>}
            <div>
              <Label>강사</Label>
              <SelectField value={scheduleInstructorFilter} onChange={(event) => setScheduleInstructorFilter(event.target.value)}>
                <option value="">전체 강사</option>
                {staff.filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
            </div>
            <div>
              <Label>강의실</Label>
              <SelectField value={scheduleClassroomFilter} onChange={(event) => setScheduleClassroomFilter(event.target.value)}>
                <option value="">전체 강의실</option>
                {classrooms.filter((row) => row.active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
            </div>
            <div>
              <Label>특이사항</Label>
              <SelectField value={scheduleStatusFilter} onChange={(event) => setScheduleStatusFilter(event.target.value)}>
                <option value="">모든 수업</option>
                {specialLessonStatuses.map((value) => <option key={value} value={value}>{specialLessonStatusLabels[value]}</option>)}
              </SelectField>
            </div>
          </div>
          {scheduleMode === 'week' ? (
            <>
              <div className="hidden lg:block"><ScheduleWeekView weekStart={weekStart} schedule={filteredSchedule} onSelect={canCreateSchedule(effectivePermissions) ? openScheduleEditor : undefined} canSelect={canManageScheduleItem} /></div>
              <div className="lg:hidden"><ScheduleTable schedule={filteredSchedule} onSelect={canCreateSchedule(effectivePermissions) ? openScheduleEditor : undefined} canSelect={canManageScheduleItem} /></div>
            </>
          ) : <ScheduleTable schedule={filteredSchedule} onSelect={canCreateSchedule(effectivePermissions) ? openScheduleEditor : undefined} canSelect={canManageScheduleItem} />}
          {filteredSchedule.length === 0 && canCreateScheduleForView && (
            <div className="flex justify-center"><Button type="button" onClick={() => openScheduleEditor(null)}><Plus className="mr-2 h-4 w-4" />첫 시간표 추가</Button></div>
          )}
      </CardContent>
    </Card>
  );

  const renderAttendance = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>날짜와 수업 선택</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[auto_220px_1fr] sm:items-end">
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => changeDate(addDateValue(selectedDate, -1))} aria-label="이전 날짜"><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" size="sm" onClick={() => changeDate(today())}>오늘</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => changeDate(addDateValue(selectedDate, 1))} aria-label="다음 날짜"><ChevronRight className="h-4 w-4" /></Button>
            </div>
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
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                  <LessonSpecialStatusBadge status={item.status} />
                </SelectableCard>
            ))}
          </div>
          {daySchedule.length === 0 && <EmptyState title="선택한 날짜의 수업이 없습니다" description="다른 날짜나 반 필터를 선택하세요." />}
        </CardContent>
      </Card>

      {selectedSchedule && canUpdateSelectedLesson && (
        <Card>
          <CardHeader><CardTitle>수업 특이사항</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitLessonStatus} className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
              <div>
                <Label>구분</Label>
                <SelectField value={lessonSpecialStatus} onChange={(event) => setLessonSpecialStatus(event.target.value as LessonSpecialStatusSelection)}>
                  <option value="">없음</option>
                  {specialLessonStatuses.map((value) => <option key={value} value={value}>{specialLessonStatusLabels[value]}</option>)}
                </SelectField>
              </div>
              {lessonSpecialStatus === 'cancelled' ? (
                <div><Label>취소 사유</Label><Input required value={lessonCancelReason} onChange={(event) => setLessonCancelReason(event.target.value)} /></div>
              ) : (
                <div><Label>운영 메모</Label><Input value={lessonNotes} onChange={(event) => setLessonNotes(event.target.value)} /></div>
              )}
              <Button type="submit" variant="outline" disabled={attendanceDirty}>특이사항 저장</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {detailLoading ? <LoadingBlock /> : selectedSchedule && !canUpdateSelectedLesson ? (
        <EmptyState
          title="이 회차를 운영할 권한이 없습니다"
          description="정규 담당 강사 또는 이 회차의 실제 참여 강사만 출결을 관리할 수 있습니다."
        />
      ) : selectedSchedule?.status === 'cancelled' ? (
        <EmptyState title="취소된 수업은 출결을 입력할 수 없습니다" description="취소를 해제하거나 보강으로 변경한 뒤 출결을 입력하세요." />
      ) : (
        <AttendanceRoster
          key={selectedSchedule?.id || 'empty'}
          academyId={academyId}
          lesson={selectedSchedule}
          students={classStudents.filter((student) => student.status === 'active')}
          attendance={visibleAttendance}
          onDirtyChange={setAttendanceDirty}
          onSaved={async () => {
            await loadBase({ force: true });
            await loadClassDetail({ force: true });
          }}
        />
      )}

      <Card>
        <CardHeader><CardTitle>선택일 저장 기록</CardTitle></CardHeader>
        <CardContent><AttendanceTable attendance={visibleAttendance} /></CardContent>
      </Card>
    </div>
  );

  const renderSettings = () => {
    if (!canManageGlobalResources) {
      return (
        <ErrorState
          title="운영 설정 권한이 없습니다"
          description="반, 강의실, 시간표, 교재 기준 정보는 관리자 또는 직원만 수정할 수 있습니다."
        />
      );
    }

    return (
      <Tabs value={resourceTab} onValueChange={setResourceTab} variant="underline" className="space-y-5">
        <TabsList>
          <TabsTrigger value="classrooms">강의실 {classrooms.length}</TabsTrigger>
          <TabsTrigger value="books">교재 {books.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="classrooms">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div><CardTitle>강의실</CardTitle><p className="mt-1 text-sm text-muted-foreground">반 기본값과 시간표에서 선택하는 공간입니다.</p></div>
              <Button type="button" size="sm" onClick={startClassroomCreate}><Plus className="mr-2 h-4 w-4" />추가</Button>
            </CardHeader>
            <CardContent>
              {classrooms.length === 0 ? (
                <EmptyState title="등록된 강의실이 없습니다" description="첫 강의실을 추가하면 반과 시간표에서 선택할 수 있습니다." action={<Button type="button" onClick={startClassroomCreate}>강의실 추가</Button>} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {classrooms.map((room) => (
                    <div key={room.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-medium"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: swatchColor(room.color) }} />{room.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">정원 {room.capacity ?? '미지정'}명</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2"><StatusBadge status={room.active ? 'active' : 'inactive'} /><Button type="button" variant="outline" size="sm" onClick={() => editClassroom(room)}>수정</Button></div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="books">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div><CardTitle>교재</CardTitle><p className="mt-1 text-sm text-muted-foreground">반 운영에서 배정할 수 있는 공통 교재 목록입니다.</p></div>
              <Button type="button" size="sm" onClick={startBookCreate}><Plus className="mr-2 h-4 w-4" />추가</Button>
            </CardHeader>
            <CardContent>
              {books.length === 0 ? (
                <EmptyState title="등록된 교재가 없습니다" description="교재를 추가한 뒤 각 반의 교재 탭에서 배정하세요." action={<Button type="button" onClick={startBookCreate}>교재 추가</Button>} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {books.map((book) => (
                    <div key={book.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
                      <div className="min-w-0"><div className="truncate font-medium">{book.title}</div><div className="mt-1 text-xs text-muted-foreground">{book.subject || '과목 미지정'} · {book.grade || '학년 미지정'}</div></div>
                      <Button type="button" variant="outline" size="sm" onClick={() => editBook(book)}>수정</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    );
  };

  return (
    <>
      <PageShell title={initialClassId && selectedClass ? selectedClass.name : pageMeta.title} icon={pageMeta.icon} actions={actions} status={status}>
        {loading && <LoadingBlock />}
        {!loading && view === 'overview' && renderOverview()}
        {!loading && view === 'schedule' && renderSchedule()}
        {!loading && view === 'attendance' && renderAttendance()}
        {!loading && view === 'settings' && renderSettings()}
      </PageShell>

      <Dialog open={classDialogOpen} onOpenChange={(open) => {
        setClassDialogOpen(open);
        if (!open) replaceQuery({ newClass: null });
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingClassId ? `${className || '반'} 수정` : '반 추가'}</DialogTitle>
            <DialogDescription>반 운영에 필요한 기본값을 설정합니다. 시간표에서는 회차별로 강사와 강의실을 바꿀 수 있습니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitClass} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="class-name">반 이름</Label><Input id="class-name" required value={className} onChange={(event) => setClassName(event.target.value)} placeholder="중1 A반" /></div>
              <div>
                <Label htmlFor="class-subject">과목</Label>
                <SelectField id="class-subject" value={subjectId} onChange={(event) => {
                  const nextSubjectId = event.target.value;
                  setSubjectId(nextSubjectId);
                  setCourseId((current) => (
                    courseOptions.some((course) => course.id === current && course.subjectId === nextSubjectId)
                      ? current
                      : ''
                  ));
                }}>
                  <option value="">과목 선택</option>
                  {subjectOptions.map((subject) => <option key={subject.value} value={subject.value}>{subject.label}</option>)}
                </SelectField>
                {subjectOptions.length === 0 && <p className="mt-1 text-xs text-warning-foreground">등록된 과목이 없습니다. 먼저 기준 정보에서 과목을 추가하세요.</p>}
              </div>
            </div>
            <div>
              <Label htmlFor="class-course">세부 과정 (선택)</Label>
              <SelectField
                id="class-course"
                value={courseId}
                disabled={!subjectId}
                onChange={(event) => setCourseId(event.target.value)}
              >
                <option value="">세부 과정 미설정</option>
                {courseOptions
                  .filter((course) => (
                    (course.subjectId === subjectId || course.id === courseId)
                    && (course.status === 'active' || course.id === courseId)
                  ))
                  .map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                      {course.subjectId !== subjectId ? ' (기존 연결 · 확인 필요)' : course.status === 'active' ? '' : ' (비활성)'}
                    </option>
                  ))}
              </SelectField>
              <p className="mt-1 text-xs text-muted-foreground">
                과목에 연결된 세부 과정이 있을 때만 선택합니다. 미설정 상태로도 반을 운영할 수 있습니다.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="class-grade">대표 대상 학년</Label><Input id="class-grade" required value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="중2" /></div>
              <div><Label htmlFor="class-extra-grades">추가 대상 학년</Label><Input id="class-extra-grades" value={additionalGrades} onChange={(event) => setAdditionalGrades(event.target.value)} placeholder="중3, 고1" /><p className="mt-1 text-xs text-muted-foreground">혼합 반만 쉼표로 구분해 입력합니다.</p></div>
            </div>
            {editingClassId && (
              <div>
                <Label>운영 상태</Label>
                <SelectField value={classStatus} onChange={(event) => setClassStatus(event.target.value as ClassStatus)}>
                  {classStatuses.map((classStatusValue) => <option key={classStatusValue} value={classStatusValue}>{classStatusLabels[classStatusValue]}</option>)}
                </SelectField>
                {classStatus !== 'active' && <p className="mt-1 text-xs text-warning-foreground">운영을 중지하거나 보관하면 활성 반복 시간표가 함께 중지됩니다. 학생과 과거 이력은 유지됩니다.</p>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>정원</Label><Input type="number" min="0" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></div>
              <div><Label>색상</Label><Input type="color" value={classColor} onChange={(event) => setClassColor(event.target.value)} className="h-10 p-1" /></div>
            </div>
            <div className="space-y-2">
              <Label>담당 강사</Label>
              <div role="group" aria-label="반 담당 강사 선택" className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2">
                {staff.filter((row) => row.status === 'active' || classInstructorIds.includes(row.id)).map((row) => {
                  const inputId = `class-instructor-${row.id}`;
                  return (
                    <label key={row.id} htmlFor={inputId} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                      <Checkbox
                        id={inputId}
                        checked={classInstructorIds.includes(row.id)}
                        onCheckedChange={(checked) => setClassInstructorIds((current) => (
                          toggleClassInstructorId(current, row.id, checked === true)
                        ))}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      {row.status !== 'active' && <span className="text-xs text-muted-foreground">비활성</span>}
                    </label>
                  );
                })}
                {staff.length === 0 && <p className="text-sm text-muted-foreground">등록된 강사가 없습니다.</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                선택 순서의 첫 강사는 기존 화면의 대표 강사로 표시되며, 수업 참여 강사는 시간표에서 별도로 선택합니다.
              </p>
            </div>
            <div>
              <Label>기본 강의실</Label>
              <SelectField value={defaultClassroomId} onChange={(event) => setDefaultClassroomId(event.target.value)}>
                <option value="">미지정</option>
                {classrooms.filter((row) => row.active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
            </div>
            <div><Label>운영 메모</Label><Textarea value={classNotes} onChange={(event) => setClassNotes(event.target.value)} placeholder="반 운영 시 공유할 메모" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClassDialogOpen(false)}>취소</Button>
              <Button type="submit">{editingClassId ? '반 수정' : '반 만들기'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={classroomDialogOpen} onOpenChange={(open) => {
        setClassroomDialogOpen(open);
        if (!open) resetClassroomForm();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingClassroomId ? `${classroomName || '강의실'} 수정` : '강의실 추가'}</DialogTitle>
            <DialogDescription>반 기본값과 시간표에서 공통으로 사용할 공간 정보입니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitClassroom} className="space-y-4">
            <div><Label htmlFor="classroom-name">강의실명</Label><Input id="classroom-name" required value={classroomName} onChange={(event) => setClassroomName(event.target.value)} placeholder="1강의실" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="classroom-capacity">정원</Label><Input id="classroom-capacity" type="number" min="0" value={classroomCapacity} onChange={(event) => setClassroomCapacity(event.target.value)} /></div>
              <div><Label htmlFor="classroom-color">색상</Label><Input id="classroom-color" type="color" value={classroomColor} onChange={(event) => setClassroomColor(event.target.value)} className="h-10 p-1" /></div>
            </div>
            {editingClassroomId && (
              <div><Label>운영 상태</Label><SelectField value={classroomActive ? 'active' : 'inactive'} onChange={(event) => setClassroomActive(event.target.value === 'active')}><option value="active">운영</option><option value="inactive">중지</option></SelectField></div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClassroomDialogOpen(false)}>취소</Button>
              <Button type="submit">{editingClassroomId ? '강의실 수정' : '강의실 추가'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bookDialogOpen} onOpenChange={(open) => {
        setBookDialogOpen(open);
        if (!open) resetBookForm();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBookId ? `${bookTitle || '교재'} 수정` : '교재 추가'}</DialogTitle>
            <DialogDescription>교재를 등록한 뒤 각 반 운영 화면에서 배정할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitBookRecord} className="space-y-4">
            <div><Label htmlFor="book-title">교재명</Label><Input id="book-title" required value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder="교재명" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="book-subject">과목</Label><Input id="book-subject" value={bookSubject} onChange={(event) => setBookSubject(event.target.value)} /></div>
              <div><Label htmlFor="book-grade">학년</Label><Input id="book-grade" value={bookGrade} onChange={(event) => setBookGrade(event.target.value)} /></div>
            </div>
            <div><Label htmlFor="book-key">Book key</Label><Input id="book-key" value={bookKey} onChange={(event) => setBookKey(event.target.value)} placeholder="비워두면 자동 생성" disabled={Boolean(editingBookId)} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBookDialogOpen(false)}>취소</Button>
              <Button type="submit">{editingBookId ? '교재 수정' : '교재 추가'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {selectedClass && (
        <ClassMemberDialog
          open={memberDialogOpen}
          onOpenChange={setMemberDialogOpen}
          academyId={academyId}
          classId={selectedClass.id}
          className={selectedClass.name}
          capacity={selectedClass.capacity}
          members={classStudents}
          onSaved={async () => {
            await loadBase({ force: true });
            await loadClassDetail({ force: true });
          }}
        />
      )}

      <ScheduleEditorDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        academyId={academyId}
        classes={classes.filter((row) => canManageClassById(row.id))}
        staff={staff}
        classrooms={classrooms}
        lesson={scheduleEditingLesson}
        rules={scheduleRules}
        initialClassId={scheduleClassFilter || selectedClassId}
        actorRole={profile?.role}
        onSaved={() => loadBase({ force: true })}
      />

      <Dialog open={Boolean(pendingAttendanceTarget)} onOpenChange={(open) => !open && setPendingAttendanceTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장하지 않은 출결 변경</DialogTitle>
            <DialogDescription>다른 날짜나 수업으로 이동하면 현재 변경사항이 사라집니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingAttendanceTarget(null)}>계속 편집</Button>
            <Button type="button" variant="destructive" onClick={() => {
              const target = pendingAttendanceTarget;
              setPendingAttendanceTarget(null);
              setAttendanceDirty(false);
              if (target?.lesson) applyScheduleSelection(target.lesson);
              else if (target?.date) applyDateChange(target.date);
            }}>변경 취소 후 이동</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
