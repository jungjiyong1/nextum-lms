'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
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
import { Input } from '@/components/ui/input';
import { PageStatusBar } from '@/components/ui/page-shell';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/state';
import { recordAttendanceBatch } from '../service';
import type { AttendanceRow, AttendanceStatus, ClassStudentSummary, ScheduleItem } from '../types';
import { minutesFromTime } from './schedule-utils';

type AttendanceDraft = {
  status: AttendanceStatus | null;
  attendedMinutes: string;
  billableMinutes: string;
  notes: string;
};

const statuses: AttendanceStatus[] = ['present', 'late', 'absent', 'excused', 'makeup'];
const labels: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
  excused: '인정 결석',
  makeup: '보강',
};

function initialDraft(record: AttendanceRow | undefined): AttendanceDraft {
  return {
    status: record?.status || null,
    attendedMinutes: record?.attendedMinutes === null || record?.attendedMinutes === undefined ? '' : String(record.attendedMinutes),
    billableMinutes: record?.billableMinutes === null || record?.billableMinutes === undefined ? '' : String(record.billableMinutes),
    notes: record?.notes || '',
  };
}

function sameDraft(left: AttendanceDraft, right: AttendanceDraft): boolean {
  return left.status === right.status
    && left.attendedMinutes === right.attendedMinutes
    && left.billableMinutes === right.billableMinutes
    && left.notes === right.notes;
}

function statusTone(status: AttendanceStatus | null) {
  return status || 'inactive';
}

export function AttendanceRoster({
  academyId,
  lesson,
  students,
  attendance,
  onSaved,
  onDirtyChange,
}: {
  academyId: string;
  lesson: ScheduleItem | null;
  students: ClassStudentSummary[];
  attendance: AttendanceRow[];
  onSaved: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const relevantRecords = useMemo(() => attendance.filter((row) => (
    lesson && (lesson.actualId
      ? row.occurrenceId === lesson.actualId
      : row.classId === lesson.classId && row.date === lesson.date && row.startTime === lesson.startTime)
  )), [attendance, lesson]);
  const recordsByStudent = useMemo(() => new Map(relevantRecords.map((row) => [row.studentId, row])), [relevantRecords]);
  const baseline = useMemo(() => Object.fromEntries(students.map((student) => [student.id, initialDraft(recordsByStudent.get(student.id))])), [recordsByStudent, students]);
  const lessonKey = lesson ? `${lesson.id}:${lesson.date}:${lesson.startTime}` : '';
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const loadedBaseline = useRef({ lessonKey: '', signature: '' });
  const baselineSignature = JSON.stringify(baseline);

  useEffect(() => {
    const lessonChanged = loadedBaseline.current.lessonKey !== lessonKey;
    if (lessonChanged || dirtyIds.size === 0) {
      setDrafts(baseline);
      if (lessonChanged) setDirtyIds(new Set());
      setStale(false);
      loadedBaseline.current = { lessonKey, signature: baselineSignature };
      return;
    }
    if (loadedBaseline.current.signature !== baselineSignature) setStale(true);
  }, [baseline, baselineSignature, dirtyIds.size, lessonKey]);

  useEffect(() => {
    onDirtyChange?.(dirtyIds.size > 0);
  }, [dirtyIds.size, onDirtyChange]);

  const update = (studentId: string, next: Partial<AttendanceDraft>) => {
    const existing = drafts[studentId] || baseline[studentId] || initialDraft(undefined);
    const merged = { ...existing, ...next };
    setDrafts((current) => ({ ...current, [studentId]: merged }));
    setDirtyIds((dirty) => {
      const nextDirty = new Set(dirty);
      if (sameDraft(merged, baseline[studentId] || initialDraft(undefined))) nextDirty.delete(studentId);
      else nextDirty.add(studentId);
      return nextDirty;
    });
  };

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    if (!lesson) return;
    const duration = Math.max(0, minutesFromTime(lesson.endTime) - minutesFromTime(lesson.startTime));
    const zeroMinutes = status === 'absent' || status === 'excused';
    update(studentId, {
      status,
      attendedMinutes: String(zeroMinutes ? 0 : duration),
      billableMinutes: String(zeroMinutes ? 0 : duration),
    });
  };

  const markAllPresent = () => {
    if (!lesson) return;
    const duration = Math.max(0, minutesFromTime(lesson.endTime) - minutesFromTime(lesson.startTime));
    const nextDrafts = { ...drafts };
    const nextDirtyIds = new Set(dirtyIds);
    for (const student of students) {
      const current = drafts[student.id] || baseline[student.id];
      if (current?.status) continue;
      const merged = {
        ...(current || initialDraft(undefined)),
        status: 'present' as const,
        attendedMinutes: String(duration),
        billableMinutes: String(duration),
      };
      nextDrafts[student.id] = merged;
      if (sameDraft(merged, baseline[student.id] || initialDraft(undefined))) nextDirtyIds.delete(student.id);
      else nextDirtyIds.add(student.id);
    }
    setDrafts(nextDrafts);
    setDirtyIds(nextDirtyIds);
  };

  const reset = () => {
    setDrafts(baseline);
    setDirtyIds(new Set());
    setStale(false);
  };

  const save = async () => {
    if (!lesson || dirtyIds.size === 0) return;
    const records = [...dirtyIds].map((studentId) => ({ studentId, ...(drafts[studentId] || baseline[studentId]) }))
      .filter((record): record is typeof record & { status: AttendanceStatus } => Boolean(record.status))
      .map((record) => ({
        studentId: record.studentId,
        status: record.status,
        attendedMinutes: record.attendedMinutes === '' ? null : Number(record.attendedMinutes),
        billableMinutes: record.billableMinutes === '' ? null : Number(record.billableMinutes),
        notes: record.notes || null,
      }));
    if (records.length === 0) {
      toast.warning('저장할 출결 상태를 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      await recordAttendanceBatch(academyId, {
        occurrenceId: lesson.actualId,
        classId: lesson.classId,
        ruleId: lesson.ruleId,
        date: lesson.date,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        records,
      });
      toast.success(`출결 ${records.length}건을 저장했습니다.`);
      setDirtyIds(new Set());
      setStale(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '출결을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!lesson) return <EmptyState title="수업을 선택하세요" description="출결을 입력할 날짜와 수업을 먼저 선택하세요." />;
  if (students.length === 0) return <EmptyState title="배정된 학생이 없습니다" description="반 운영에서 학생을 먼저 배정하세요." />;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{lesson.className} 출결 명단</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{lesson.date} · {lesson.startTime}-{lesson.endTime} · {students.length}명</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={markAllPresent} disabled={saving}>
              <CheckCheck className="mr-2 h-4 w-4" />미입력 전체 출석
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={saving || dirtyIds.size === 0}>
              <RotateCcw className="mr-2 h-4 w-4" />변경 취소
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {stale && <PageStatusBar tone="warning">편집 중 새 데이터가 도착했습니다. 저장하거나 변경을 취소한 뒤 최신 상태를 확인하세요.</PageStatusBar>}
        <div className="hidden lg:block">
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>학생</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="w-24">출석 분</TableHead>
                  <TableHead className="w-24">청구 분</TableHead>
                  <TableHead>메모</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((student) => {
                  const draft = drafts[student.id] || baseline[student.id] || initialDraft(undefined);
                  return (
                    <TableRow key={student.id} className={dirtyIds.has(student.id) ? 'bg-primary-soft/50' : undefined}>
                      <TableCell className="font-medium">{student.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {statuses.map((status) => (
                            <Button key={status} type="button" size="sm" variant={draft.status === status ? 'default' : 'outline'} onClick={() => setStatus(student.id, status)}>
                              {labels[status]}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell><Input type="number" min="0" value={draft.attendedMinutes} onChange={(event) => update(student.id, { attendedMinutes: event.target.value, status: draft.status || 'present' })} /></TableCell>
                      <TableCell><Input type="number" min="0" value={draft.billableMinutes} onChange={(event) => update(student.id, { billableMinutes: event.target.value, status: draft.status || 'present' })} /></TableCell>
                      <TableCell><Input value={draft.notes} onChange={(event) => update(student.id, { notes: event.target.value, status: draft.status || 'present' })} placeholder="메모" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        </div>

        <div className="space-y-3 lg:hidden">
          {students.map((student) => {
            const draft = drafts[student.id] || baseline[student.id] || initialDraft(undefined);
            return (
              <div key={student.id} className="space-y-3 rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{student.name}</p>
                  <StatusBadge status={statusTone(draft.status)} label={draft.status ? labels[draft.status] : '미입력'} />
                </div>
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                  {statuses.map((status) => (
                    <Button key={status} type="button" size="sm" variant={draft.status === status ? 'default' : 'outline'} onClick={() => setStatus(student.id, status)}>
                      {labels[status]}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label={`${student.name} 출석 분`} type="number" min="0" value={draft.attendedMinutes} onChange={(event) => update(student.id, { attendedMinutes: event.target.value, status: draft.status || 'present' })} placeholder="출석 분" />
                  <Input aria-label={`${student.name} 청구 분`} type="number" min="0" value={draft.billableMinutes} onChange={(event) => update(student.id, { billableMinutes: event.target.value, status: draft.status || 'present' })} placeholder="청구 분" />
                </div>
                <Input aria-label={`${student.name} 출결 메모`} value={draft.notes} onChange={(event) => update(student.id, { notes: event.target.value, status: draft.status || 'present' })} placeholder="메모" />
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
          <p className="text-sm text-muted-foreground">{dirtyIds.size > 0 ? `${dirtyIds.size}명의 변경사항이 있습니다.` : '저장할 변경사항이 없습니다.'}</p>
          <Button type="button" onClick={() => void save()} disabled={saving || dirtyIds.size === 0}>
            <Save className="mr-2 h-4 w-4" />{saving ? '저장 중…' : `변경 ${dirtyIds.size}명 저장`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
