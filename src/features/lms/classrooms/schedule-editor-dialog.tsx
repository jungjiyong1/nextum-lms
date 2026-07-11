'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarPlus, Repeat2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { SelectField } from '@/components/ui/select-field';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { checkScheduleConflicts, deleteSchedule, mutateSchedule } from '../service';
import type {
  ClassSummary,
  ClassroomSummary,
  ScheduleConflict,
  ScheduleEditScope,
  ScheduleEntryKind,
  ScheduleItem,
  ScheduleMutationInput,
  ScheduleRuleSummary,
  StaffSummary,
} from '../types';
import {
  dateValue,
  lessonSpecialStatusSelection,
  parseDateValue,
  resolveLessonOccurrenceStatus,
  specialLessonStatusLabels,
  specialLessonStatuses,
  type LessonSpecialStatusSelection,
} from './schedule-utils';

const dayLabels = ['월', '화', '수', '목', '금', '토', '일'];
const conflictLabels: Record<ScheduleConflict['kind'], string> = {
  class: '반 시간 중복',
  instructor: '강사 시간 중복',
  classroom: '강의실 시간 중복',
};

function dayOfWeekFromDate(value: string): number {
  const day = parseDateValue(value).getDay();
  return Number.isFinite(day) ? (day + 6) % 7 : 0;
}

export function ScheduleEditorDialog({
  open,
  onOpenChange,
  academyId,
  classes,
  staff,
  classrooms,
  lesson,
  rules,
  initialClassId,
  actorRole,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academyId: string;
  classes: ClassSummary[];
  staff: StaffSummary[];
  classrooms: ClassroomSummary[];
  lesson: ScheduleItem | null;
  rules: ScheduleRuleSummary[];
  initialClassId: string;
  actorRole: string | null | undefined;
  onSaved: () => Promise<void> | void;
}) {
  const linkedRule = useMemo(() => rules.find((rule) => rule.id === lesson?.ruleId) || null, [lesson?.ruleId, rules]);
  const [entryKind, setEntryKind] = useState<ScheduleEntryKind>('recurring');
  const [scope, setScope] = useState<ScheduleEditScope>('all');
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(dateValue(new Date()));
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [startDate, setStartDate] = useState(dateValue(new Date()));
  const [endDate, setEndDate] = useState('');
  const [intervalWeeks, setIntervalWeeks] = useState('1');
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('18:00');
  const [instructorId, setInstructorId] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [substituteInstructorId, setSubstituteInstructorId] = useState('');
  const [specialStatus, setSpecialStatus] = useState<LessonSpecialStatusSelection>('');
  const [cancelReason, setCancelReason] = useState('');
  const [notes, setNotes] = useState('');
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const initializedKey = useRef<string | null>(null);
  const canOverride = actorRole === 'owner' || actorRole === 'admin';
  const convertingSingleToRecurring = Boolean(lesson && !lesson.ruleId && entryKind === 'recurring');

  useEffect(() => {
    if (!open) {
      initializedKey.current = null;
      return;
    }
    const nextKey = `${lesson?.id || 'new'}:${initialClassId}`;
    if (initializedKey.current === nextKey) return;
    initializedKey.current = nextKey;
    const initialClass = classes.find((row) => row.id === (lesson?.classId || initialClassId)) || classes[0] || null;
    setClassId(initialClass?.id || '');
    setInstructorId(lesson
      ? lesson.instructorOverrideId || linkedRule?.instructorId || ''
      : linkedRule?.instructorId || '');
    setClassroomId(lesson
      ? lesson.classroomOverrideId || linkedRule?.classroomId || ''
      : linkedRule?.classroomId || '');
    setSubstituteInstructorId(lesson?.substituteInstructorId || '');
    setStartTime(lesson?.startTime || linkedRule?.startTime || '16:00');
    setEndTime(lesson?.endTime || linkedRule?.endTime || '18:00');
    setDate(lesson?.date || dateValue(new Date()));
    setStartDate(linkedRule?.startDate || lesson?.date || dateValue(new Date()));
    setEndDate(linkedRule?.endDate || '');
    setDayOfWeek(linkedRule?.dayOfWeek ?? (lesson?.date ? dayOfWeekFromDate(lesson.date) : 0));
    setIntervalWeeks(String(linkedRule?.intervalWeeks || 1));
    setSpecialStatus(lessonSpecialStatusSelection(lesson?.status));
    setCancelReason(lesson?.cancelReason || '');
    setNotes(lesson?.notes || '');
    setEntryKind(lesson ? 'single' : 'recurring');
    setScope(lesson?.ruleId ? 'single' : lesson ? 'single' : 'all');
    setConflicts([]);
    setOverrideReason('');
    setConfirmingDelete(false);
  }, [classes, initialClassId, lesson, linkedRule, open]);

  useEffect(() => {
    if (!lesson?.ruleId) return;
    if (scope === 'single') {
      setEntryKind('single');
      setDate(lesson.date);
      setStartTime(lesson.startTime);
      setEndTime(lesson.endTime);
    } else if (linkedRule) {
      setEntryKind('recurring');
      setDayOfWeek(linkedRule.dayOfWeek);
      setStartDate(scope === 'future' ? lesson.date : linkedRule.startDate);
      setEndDate(linkedRule.endDate || '');
      setIntervalWeeks(String(linkedRule.intervalWeeks || 1));
      setStartTime(linkedRule.startTime);
      setEndTime(linkedRule.endTime);
      setInstructorId(linkedRule.instructorId || '');
      setClassroomId(linkedRule.classroomId || '');
    }
    setConflicts([]);
    setOverrideReason('');
  }, [lesson, linkedRule, scope]);

  const changeEntryKind = (nextKind: ScheduleEntryKind) => {
    setEntryKind(nextKind);
    setConflicts([]);
    setOverrideReason('');
    if (nextKind === 'recurring' && lesson && !lesson.ruleId) {
      setStartDate(lesson.date);
      setDayOfWeek(dayOfWeekFromDate(lesson.date));
      setStartTime(lesson.startTime);
      setEndTime(lesson.endTime);
      setInstructorId(lesson.instructorOverrideId || '');
      setClassroomId(lesson.classroomOverrideId || '');
    } else if (nextKind === 'single' && lesson) {
      setDate(lesson.date);
      setStartTime(lesson.startTime);
      setEndTime(lesson.endTime);
    }
  };

  const buildInput = (): ScheduleMutationInput => {
    const status = resolveLessonOccurrenceStatus(specialStatus);
    return {
      kind: entryKind,
      scope: entryKind === 'single' ? 'single' : scope === 'single' ? 'all' : scope,
      classId,
      ruleId: lesson?.ruleId || null,
      occurrenceId: lesson?.actualId || null,
      date: entryKind === 'single' ? date : null,
      dayOfWeek: entryKind === 'recurring' ? dayOfWeek : null,
      startDate: entryKind === 'recurring' ? startDate : null,
      endDate: entryKind === 'recurring' ? endDate || null : null,
      intervalWeeks: Math.max(1, Number(intervalWeeks) || 1),
      startTime,
      endTime,
      instructorId: instructorId || null,
      classroomId: classroomId || null,
      substituteInstructorId: entryKind === 'single' && specialStatus === 'substitute' ? substituteInstructorId || null : null,
      status: entryKind === 'single' ? status : 'normal',
      cancelReason: specialStatus === 'cancelled' ? cancelReason || null : null,
      notes: entryKind === 'single' ? notes || null : null,
      conflictOverrideReason: overrideReason || null,
    };
  };

  const save = async () => {
    if (!classId || !startTime || !endTime || startTime >= endTime) {
      toast.error('반과 올바른 시작·종료 시간을 입력하세요.');
      return;
    }
    if (entryKind === 'recurring' && !startDate) {
      toast.error('반복 시작일을 입력하세요.');
      return;
    }
    if (convertingSingleToRecurring && lesson?.status !== 'normal') {
      toast.error('취소·보강·대강이 아닌 일반 일회성 수업만 반복 수업으로 전환할 수 있습니다.');
      return;
    }
    if (entryKind === 'single' && !date) {
      toast.error('수업 날짜를 입력하세요.');
      return;
    }
    if (entryKind === 'single' && specialStatus === 'cancelled' && !cancelReason.trim()) {
      toast.error('수업 취소 사유를 입력하세요.');
      return;
    }
    if (entryKind === 'single' && specialStatus === 'substitute' && !substituteInstructorId) {
      toast.error('대강 강사를 선택하세요.');
      return;
    }

    const input = buildInput();
    setChecking(true);
    try {
      const found = await checkScheduleConflicts(academyId, input);
      setConflicts(found);
      const hasClassConflict = found.some((conflict) => conflict.kind === 'class');
      if (hasClassConflict) {
        toast.error('같은 반의 수업 시간이 겹칩니다. 시간을 조정하세요.');
        return;
      }
      if (found.length > 0 && (!canOverride || !overrideReason.trim())) {
        toast.warning(canOverride ? '충돌 예외 사유를 입력한 뒤 다시 저장하세요.' : '강사 또는 강의실 충돌을 해결해야 저장할 수 있습니다.');
        return;
      }

      setSaving(true);
      await mutateSchedule(academyId, input);
      toast.success(convertingSingleToRecurring ? '반복 시간표로 전환했습니다.' : lesson ? '시간표를 수정했습니다.' : '시간표를 추가했습니다.');
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '시간표를 저장하지 못했습니다.');
    } finally {
      setChecking(false);
      setSaving(false);
    }
  };

  const deleteDescription = lesson?.ruleId
    ? scope === 'single'
      ? '이번 수업만 시간표에서 제외합니다. 반복 규칙과 다른 날짜의 수업은 유지됩니다.'
      : scope === 'future'
        ? '이 수업부터 이후 반복 일정을 종료합니다. 이미 출결이 기록된 수업은 보존됩니다.'
        : '반복 일정 전체를 종료합니다. 이미 출결이 기록된 수업은 보존됩니다.'
    : '이 일회성 수업을 삭제합니다. 출결이 기록된 수업은 삭제할 수 없습니다.';

  const remove = async () => {
    if (!lesson) return;
    setDeleting(true);
    try {
      await deleteSchedule(academyId, {
        classId: lesson.classId,
        ruleId: lesson.ruleId,
        occurrenceId: lesson.actualId,
        date: lesson.date,
        scope: lesson.ruleId ? scope : 'single',
      });
      toast.success(lesson.ruleId && scope === 'single' ? '이번 수업을 시간표에서 제외했습니다.' : '시간표를 삭제했습니다.');
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '시간표를 삭제하지 못했습니다.');
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lesson ? `${lesson.className} 시간표 수정` : '시간표 추가'}</DialogTitle>
          <DialogDescription>반복 규칙과 실제 수업 회차를 구분해 안전하게 변경합니다.</DialogDescription>
        </DialogHeader>

        {!lesson?.ruleId && (
          <Tabs value={entryKind} onValueChange={(value) => changeEntryKind(value as ScheduleEntryKind)} variant="pills">
            <TabsList className="w-full">
              <TabsTrigger value="recurring" className="flex-1"><Repeat2 className="mr-2 h-4 w-4" />반복 수업</TabsTrigger>
              <TabsTrigger value="single" className="flex-1"><CalendarPlus className="mr-2 h-4 w-4" />일회성 수업</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {lesson?.ruleId && (
          <div>
            <Label htmlFor="schedule-edit-scope">수정 범위</Label>
            <SelectField id="schedule-edit-scope" value={scope} onChange={(event) => {
              setScope(event.target.value as ScheduleEditScope);
              setConfirmingDelete(false);
            }}>
              <option value="single">이번 수업만</option>
              <option value="future">이 수업부터 이후</option>
              <option value="all">반복 일정 전체</option>
            </SelectField>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="schedule-class">반</Label>
            <SelectField id="schedule-class" value={classId} onChange={(event) => setClassId(event.target.value)} disabled={Boolean(lesson)}>
              {classes.filter((row) => row.status === 'active' || row.active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
          </div>
          {entryKind === 'single' ? (
            <div>
              <Label htmlFor="schedule-date">날짜</Label>
              <Input id="schedule-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor="schedule-weekday">요일</Label>
              <SelectField id="schedule-weekday" value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))} disabled={convertingSingleToRecurring}>
                {dayLabels.map((label, index) => <option key={label} value={index}>{label}요일</option>)}
              </SelectField>
            </div>
          )}
        </div>

        {entryKind === 'recurring' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="schedule-start-date">시작일</Label>
              <Input id="schedule-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={convertingSingleToRecurring} />
            </div>
            <div>
              <Label htmlFor="schedule-end-date">종료일</Label>
              <Input id="schedule-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="schedule-interval">반복 주기</Label>
              <SelectField id="schedule-interval" value={intervalWeeks} onChange={(event) => setIntervalWeeks(event.target.value)}>
                <option value="1">매주</option>
                <option value="2">2주마다</option>
                <option value="3">3주마다</option>
                <option value="4">4주마다</option>
              </SelectField>
            </div>
          </div>
        )}

        {convertingSingleToRecurring && (
          <p className="rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-sm text-primary">
            기존 일회성 수업 날짜를 첫 수업일로 유지한 채 반복 규칙을 만듭니다.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="schedule-start-time">시작 시간</Label><Input id="schedule-start-time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
          <div><Label htmlFor="schedule-end-time">종료 시간</Label><Input id="schedule-end-time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="schedule-instructor">담당 강사</Label>
            <SelectField id="schedule-instructor" value={instructorId} onChange={(event) => setInstructorId(event.target.value)}>
              <option value="">반 기본값</option>
              {staff.filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
          </div>
          <div>
            <Label htmlFor="schedule-classroom">강의실</Label>
            <SelectField id="schedule-classroom" value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
              <option value="">반 기본값</option>
              {classrooms.filter((row) => row.active).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
          </div>
        </div>

        {entryKind === 'single' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="schedule-special-status">특이사항</Label>
              <SelectField id="schedule-special-status" value={specialStatus} onChange={(event) => setSpecialStatus(event.target.value as LessonSpecialStatusSelection)}>
                <option value="">없음</option>
                {specialLessonStatuses.map((value) => <option key={value} value={value}>{specialLessonStatusLabels[value]}</option>)}
              </SelectField>
            </div>
            {specialStatus === 'substitute' && (
              <div>
                <Label htmlFor="schedule-substitute">대강 강사</Label>
                <SelectField id="schedule-substitute" value={substituteInstructorId} onChange={(event) => setSubstituteInstructorId(event.target.value)}>
                  <option value="">강사 선택</option>
                  {staff.filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </SelectField>
              </div>
            )}
            {specialStatus === 'cancelled' && <div><Label htmlFor="schedule-cancel-reason">취소 사유</Label><Input id="schedule-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></div>}
            <div><Label htmlFor="schedule-notes">운영 메모</Label><Textarea id="schedule-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft p-4">
            <div className="flex items-start gap-2 text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">시간표 충돌 {conflicts.length}건</p>
                <p className="mt-1 text-sm">같은 반 충돌은 저장할 수 없고, 강사·강의실 충돌만 관리자 예외가 가능합니다.</p>
              </div>
            </div>
            <div className="space-y-2">
              {conflicts.map((conflict, index) => (
                <div key={`${conflict.source}:${conflict.id}:${conflict.kind}:${index}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-card p-2 text-sm">
                  <StatusBadge status="warning" label={conflictLabels[conflict.kind]} />
                  <span>{conflict.className} · {conflict.date || `${dayLabels[conflict.dayOfWeek || 0]}요일`} · {conflict.startTime.slice(0, 5)}-{conflict.endTime.slice(0, 5)}</span>
                </div>
              ))}
            </div>
            {canOverride && !conflicts.some((conflict) => conflict.kind === 'class') && (
              <div><Label htmlFor="schedule-override-reason">관리자 예외 사유</Label><Textarea id="schedule-override-reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="예외 저장이 필요한 운영 사유" /></div>
            )}
          </div>
        )}

        {confirmingDelete && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">삭제 내용을 확인하세요.</p>
              <p className="mt-1">{deleteDescription}</p>
            </div>
          </div>
        )}

        <DialogFooter className={lesson ? 'gap-2 sm:justify-between sm:space-x-0' : 'gap-2'}>
          {lesson && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmingDelete ? void remove() : setConfirmingDelete(true)}
              disabled={saving || checking || deleting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? '삭제 중…' : confirmingDelete ? '삭제 확정' : '삭제'}
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving || checking || deleting}>취소</Button>
            <Button type="button" onClick={() => void save()} disabled={saving || checking || deleting || !classId}>
              {saving ? '저장 중…' : checking ? '충돌 확인 중…' : convertingSingleToRecurring ? '반복으로 전환' : lesson ? '시간표 수정' : '시간표 추가'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
