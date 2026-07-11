import { describe, expect, it } from 'vitest';

import {
  lessonHasEnded,
  lessonStatusRpcValue,
  lessonStatusTiming,
  normalizeLessonOccurrenceStatus,
} from './lesson-status';

describe('lesson status model', () => {
  it('canonicalizes legacy scheduled and completed rows to normal', () => {
    expect(normalizeLessonOccurrenceStatus('scheduled')).toBe('normal');
    expect(normalizeLessonOccurrenceStatus('completed')).toBe('normal');
    expect(normalizeLessonOccurrenceStatus('normal')).toBe('normal');
    expect(normalizeLessonOccurrenceStatus('cancelled')).toBe('cancelled');
  });

  it('derives completion from the Korean lesson end time', () => {
    const now = new Date('2026-07-11T01:30:00.000Z'); // 10:30 KST

    expect(lessonStatusTiming('2026-07-11', '10:00', now)).toBe('completed');
    expect(lessonHasEnded('2026-07-11', '10:30:00', now)).toBe(true);
    expect(lessonStatusTiming('2026-07-11', '11:00', now)).toBe('upcoming');
    expect(lessonStatusTiming('invalid', '11:00', now)).toBe('upcoming');
  });

  it('keeps the legacy RPC vocabulary at the database compatibility boundary only', () => {
    expect(lessonStatusRpcValue('normal')).toBe('scheduled');
    expect(lessonStatusRpcValue('makeup')).toBe('makeup');
  });
});
