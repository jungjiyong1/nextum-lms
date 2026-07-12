import { describe, expect, it } from 'vitest';

import {
  normalizeClassInstructorIds,
  removedClassInstructorIds,
  toggleClassInstructorId,
} from './class-instructors';

describe('class instructor assignments', () => {
  it('keeps the legacy default only when the explicit collection is absent', () => {
    expect(normalizeClassInstructorIds(undefined, 'staff-a')).toEqual(['staff-a']);
    expect(normalizeClassInstructorIds([], 'staff-a')).toEqual([]);
  });

  it('deduplicates explicit instructors while retaining representative order', () => {
    expect(normalizeClassInstructorIds(['staff-b', 'staff-a', 'staff-b'], 'legacy')).toEqual([
      'staff-b',
      'staff-a',
    ]);
  });

  it('appends and removes instructors without changing the first representative unexpectedly', () => {
    expect(toggleClassInstructorId(['staff-a'], 'staff-b', true)).toEqual(['staff-a', 'staff-b']);
    expect(toggleClassInstructorId(['staff-a', 'staff-b'], 'staff-a', false)).toEqual(['staff-b']);
  });

  it('returns only active assignments removed from the desired set', () => {
    expect(removedClassInstructorIds(
      ['staff-a', 'staff-b', 'staff-b'],
      ['staff-b', 'staff-c'],
    )).toEqual(['staff-a']);
  });
});
