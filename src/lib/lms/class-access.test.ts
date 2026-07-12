import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveClassOperationAccess, type ClassAccessFacts } from './class-access';

const baseFacts: ClassAccessFacts = {
  classActive: true,
  ruleMatchesClass: true,
  occurrenceMatchesClass: true,
  durableAssignment: false,
  defaultInstructor: false,
  occurrenceParticipant: false,
};

describe('class access decision', () => {
  it.each(['owner', 'admin', 'staff'] as const)('keeps %s as an academy-wide manager', (role) => {
    expect(resolveClassOperationAccess(role, {
      ...baseFacts,
      classActive: false,
    })).toBe('manager');
  });

  it.each(['teacher', 'instructor'] as const)('recognizes durable %s assignment separately', (role) => {
    expect(resolveClassOperationAccess(role, {
      ...baseFacts,
      durableAssignment: true,
    })).toBe('durable_operator');
    expect(resolveClassOperationAccess(role, {
      ...baseFacts,
      defaultInstructor: true,
    })).toBe('durable_operator');
  });

  it('does not promote an occurrence participant to class operator', () => {
    expect(resolveClassOperationAccess('teacher', {
      ...baseFacts,
      occurrenceParticipant: true,
    })).toBe('occurrence_participant');
  });

  it('rejects cross-class rule or occurrence identifiers before considering assignment', () => {
    expect(resolveClassOperationAccess('instructor', {
      ...baseFacts,
      durableAssignment: true,
      ruleMatchesClass: false,
    })).toBe('none');
    expect(resolveClassOperationAccess('instructor', {
      ...baseFacts,
      occurrenceParticipant: true,
      occurrenceMatchesClass: false,
    })).toBe('none');
  });
});
