'use client';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ScheduleItem } from '../types';
import {
  dateValue,
  formatKoreanDate,
  layoutScheduleOverlaps,
  minutesFromTime,
  safeScheduleClassColor,
  scheduleClassTint,
  scheduleHourRange,
  weekDateValues,
} from './schedule-utils';

const statusLabels: Record<ScheduleItem['status'], string> = {
  scheduled: '예정',
  completed: '완료',
  cancelled: '취소',
  makeup: '보강',
  substitute: '대강',
};

export function ScheduleWeekView({
  weekStart,
  schedule,
  onSelect,
}: {
  weekStart: string;
  schedule: ScheduleItem[];
  onSelect?: (item: ScheduleItem) => void;
}) {
  const dates = weekDateValues(weekStart);
  const { startHour, endHour } = scheduleHourRange(schedule);
  const totalMinutes = Math.max(60, (endHour - startHour) * 60);
  const canvasHeight = Math.max(640, (endHour - startHour) * 72);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const today = dateValue(new Date());

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[72px_repeat(7,minmax(120px,1fr))] border-b bg-muted/50">
          <div className="border-r px-2 py-3 text-xs font-medium text-muted-foreground">시간</div>
          {dates.map((date) => (
            <div key={date} className={`border-r px-2 py-3 text-center text-sm font-semibold last:border-r-0 ${date === today ? 'bg-primary-soft text-primary' : ''}`}>
              {formatKoreanDate(date)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[72px_repeat(7,minmax(120px,1fr))]">
          <div className="relative border-r bg-muted/20" style={{ height: canvasHeight }}>
            {hours.map((hour) => {
              const top = ((hour - startHour) * 60 / totalMinutes) * canvasHeight;
              return (
                <span key={hour} className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground" style={{ top }}>
                  {String(hour).padStart(2, '0')}:00
                </span>
              );
            })}
          </div>
          {dates.map((date) => {
            const items = layoutScheduleOverlaps(schedule.filter((item) => item.date === date));
            return (
              <div key={date} className={`relative border-r last:border-r-0 ${date === today ? 'bg-primary-soft/20' : ''}`} style={{ height: canvasHeight }}>
                {hours.map((hour) => {
                  const top = ((hour - startHour) * 60 / totalMinutes) * canvasHeight;
                  return <span key={hour} aria-hidden="true" className="absolute left-0 right-0 border-t" style={{ top }} />;
                })}
                {items.map(({ item, lane, laneCount }) => {
                  const start = minutesFromTime(item.startTime) - startHour * 60;
                  const duration = Math.max(30, minutesFromTime(item.endTime) - minutesFromTime(item.startTime));
                  const top = Math.max(0, (start / totalMinutes) * canvasHeight);
                  const height = Math.max(42, (duration / totalMinutes) * canvasHeight - 4);
                  const classColor = safeScheduleClassColor(item.classColor);
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant="outline"
                      disabled={!onSelect}
                      onClick={() => onSelect?.(item)}
                      className="absolute h-auto items-start justify-start overflow-hidden px-2 py-1.5 text-left hover:brightness-[0.98] disabled:cursor-default disabled:opacity-100"
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / laneCount) * 100}% + 4px)`,
                        width: `calc(${100 / laneCount}% - 8px)`,
                        borderColor: classColor,
                        backgroundColor: scheduleClassTint(classColor),
                        boxShadow: `inset 3px 0 0 ${classColor}`,
                      }}
                      aria-label={`${item.className} ${item.startTime}부터 ${item.endTime}까지`}
                    >
                      <span className="min-w-0 space-y-0.5">
                        <span className="flex items-center gap-1 text-xs font-semibold">
                          <span className="truncate">{item.className}</span>
                          <StatusBadge status={item.status} label={statusLabels[item.status]} className="shrink-0" />
                        </span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{item.startTime}-{item.endTime}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.instructorName || '강사 미지정'}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.classroomName || '강의실 미지정'}</span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
