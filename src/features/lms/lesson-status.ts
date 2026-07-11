import type { LessonOccurrenceStatus } from './types';

export type SpecialLessonStatus = Exclude<LessonOccurrenceStatus, 'normal'>;
export type LessonStatusTiming = 'upcoming' | 'completed';

export function normalizeLessonOccurrenceStatus(value: unknown): LessonOccurrenceStatus {
  if (value === 'cancelled' || value === 'makeup' || value === 'substitute') return value;
  return 'normal';
}

export function isSpecialLessonStatus(status: LessonOccurrenceStatus): status is SpecialLessonStatus {
  return status !== 'normal';
}

/**
 * The existing schedule RPC accepts the legacy `scheduled` value. The database
 * migration canonicalizes that boundary value to `normal` before persistence.
 */
export function lessonStatusRpcValue(status: LessonOccurrenceStatus): 'scheduled' | SpecialLessonStatus {
  return status === 'normal' ? 'scheduled' : status;
}

export function lessonStatusTiming(
  date: string,
  endTime: string,
  now: Date = new Date(),
): LessonStatusTiming {
  const normalizedTime = /^\d{2}:\d{2}(?::\d{2})?$/.test(endTime) ? endTime : '';
  const endedAt = normalizedTime ? Date.parse(`${date}T${normalizedTime}+09:00`) : Number.NaN;
  return Number.isFinite(endedAt) && endedAt <= now.getTime() ? 'completed' : 'upcoming';
}

export function lessonHasEnded(date: string, endTime: string, now: Date = new Date()): boolean {
  return lessonStatusTiming(date, endTime, now) === 'completed';
}
