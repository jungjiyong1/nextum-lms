import type { ScheduleItem } from '../types';

export function dateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDateValue(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function startOfWeekValue(value: string): string {
  const date = parseDateValue(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return dateValue(date);
}

export function addDateValue(value: string, days: number): string {
  const date = parseDateValue(value);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

export function weekDateValues(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDateValue(weekStart, index));
}

export function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

export function scheduleHourRange(schedule: ScheduleItem[]): { startHour: number; endHour: number } {
  if (schedule.length === 0) return { startHour: 9, endHour: 22 };
  const first = Math.min(...schedule.map((item) => Math.floor(minutesFromTime(item.startTime) / 60)));
  const last = Math.max(...schedule.map((item) => Math.ceil(minutesFromTime(item.endTime) / 60)));
  return { startHour: Math.max(0, first - 1), endHour: Math.min(24, Math.max(first + 1, last + 1)) };
}

export type PositionedScheduleItem = {
  item: ScheduleItem;
  lane: number;
  laneCount: number;
};

export function layoutScheduleOverlaps(schedule: ScheduleItem[]): PositionedScheduleItem[] {
  const sorted = [...schedule].sort((left, right) => (
    minutesFromTime(left.startTime) - minutesFromTime(right.startTime)
    || minutesFromTime(left.endTime) - minutesFromTime(right.endTime)
    || left.id.localeCompare(right.id)
  ));
  const result: PositionedScheduleItem[] = [];
  let cluster: Array<{ item: ScheduleItem; lane: number }> = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    if (cluster.length === 0) return;
    const laneCount = Math.max(1, laneEnds.length);
    result.push(...cluster.map((positioned) => ({ ...positioned, laneCount })));
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    const start = minutesFromTime(item.startTime);
    const end = minutesFromTime(item.endTime);
    if (cluster.length > 0 && start >= clusterEnd) flush();
    const availableLane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    const lane = availableLane === -1 ? laneEnds.length : availableLane;
    laneEnds[lane] = end;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}

export function formatKoreanDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(parseDateValue(value));
}
