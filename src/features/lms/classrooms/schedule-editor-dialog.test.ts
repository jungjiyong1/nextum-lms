import { describe, expect, it } from 'vitest';

import type { ClassSummary, ScheduleItem, StaffSummary } from '../types';
import {
  buildScheduleInstructorMutationFields,
  buildScheduleParticipantPayload,
  scheduleDurationMinutes,
  scheduleInstructorNames,
  suggestedScheduleInstructorIds,
  type ScheduleParticipantDraft,
} from './schedule-participants';

function classSummary(overrides: Partial<ClassSummary> = {}): ClassSummary {
  return {
    id: 'class-1',
    name: '중2 수학',
    grade: '중2',
    active: true,
    status: 'active',
    color: null,
    capacity: null,
    defaultInstructorId: null,
    defaultClassroomId: null,
    courseTitle: null,
    instructorName: null,
    classroomName: null,
    studentCount: 0,
    weakTypeCount: 0,
    avgTypeScore: null,
    lastLearningAt: null,
    ...overrides,
  };
}

function staffSummary(id: string, classIds?: string[]): StaffSummary {
  return {
    id,
    personId: `person-${id}`,
    name: `강사 ${id}`,
    phone: null,
    email: null,
    role: 'instructor',
    status: 'active',
    hourlyRate: null,
    classIds,
  };
}

function participantDraft(overrides: Partial<ScheduleParticipantDraft>): ScheduleParticipantDraft {
  return {
    instructorId: 'staff-a',
    participationKind: 'regular',
    payableMinutes: '60',
    payableMinutesCustomized: false,
    replacesInstructorId: '',
    ...overrides,
  };
}

describe('schedule editor participants', () => {
  it('auto-selects a sole assigned instructor but requires an explicit choice for co-teachers', () => {
    const classes = [classSummary()];

    expect(suggestedScheduleInstructorIds('class-1', classes, [
      staffSummary('a', ['class-1']),
      staffSummary('b', ['class-2']),
    ])).toEqual(['a']);

    expect(suggestedScheduleInstructorIds('class-1', classes, [
      staffSummary('a', ['class-1']),
      staffSummary('b', ['class-1']),
    ])).toEqual([]);
  });

  it('uses the legacy default instructor when membership data is unavailable', () => {
    expect(suggestedScheduleInstructorIds(
      'class-1',
      [classSummary({ defaultInstructorId: 'a' })],
      [staffSummary('a'), staffSummary('b')],
    )).toEqual(['a']);
  });

  it('uses normalized class instructors and never guesses among co-teachers', () => {
    expect(suggestedScheduleInstructorIds(
      'class-1',
      [classSummary({ instructorIds: ['a'] })],
      [staffSummary('a'), staffSummary('b')],
    )).toEqual(['a']);
    expect(suggestedScheduleInstructorIds(
      'class-1',
      [classSummary({ defaultInstructorId: 'a', instructorIds: ['a', 'b'] })],
      [staffSummary('a'), staffSummary('b')],
    )).toEqual([]);
  });

  it('defaults every joint participant to the full lesson duration', () => {
    const duration = scheduleDurationMinutes('16:10', '17:40');
    expect(duration).toBe(90);
    expect(buildScheduleParticipantPayload([
      participantDraft({ instructorId: 'a', payableMinutes: String(duration) }),
      participantDraft({ instructorId: 'b', payableMinutes: String(duration) }),
    ], '', duration)).toEqual([
      {
        instructorId: 'a',
        participationKind: 'regular',
        payableMinutes: 90,
        replacesInstructorId: null,
      },
      {
        instructorId: 'b',
        participationKind: 'regular',
        payableMinutes: 90,
        replacesInstructorId: null,
      },
    ]);
  });

  it('stores partial participation and substitute replacement context', () => {
    const drafts = [
      participantDraft({
        instructorId: 'replacement',
        participationKind: 'substitute',
        payableMinutes: '35',
        payableMinutesCustomized: true,
        replacesInstructorId: 'original',
      }),
    ];
    expect(buildScheduleParticipantPayload(drafts, 'substitute', 60)).toEqual([{
      instructorId: 'replacement',
      participationKind: 'substitute',
      payableMinutes: 35,
      replacesInstructorId: 'original',
    }]);
    expect(buildScheduleInstructorMutationFields(drafts, 'substitute', 60, 'single')).toMatchObject({
      instructorId: 'replacement',
      instructorIds: ['replacement'],
      substituteInstructorId: 'replacement',
    });
  });

  it('sends instructorIds without occurrence participant details for a recurring rule', () => {
    const result = buildScheduleInstructorMutationFields([
      participantDraft({ instructorId: 'a' }),
      participantDraft({ instructorId: 'b' }),
    ], '', 60, 'recurring');

    expect(result).toEqual({
      instructorId: 'a',
      instructorIds: ['a', 'b'],
      participants: undefined,
      substituteInstructorId: null,
    });
  });

  it('sets every cancelled participant to zero payable minutes', () => {
    expect(buildScheduleParticipantPayload([
      participantDraft({ instructorId: 'a', payableMinutes: '60' }),
      participantDraft({ instructorId: 'b', payableMinutes: '30' }),
    ], 'cancelled', 60).map((participant) => participant.payableMinutes)).toEqual([0, 0]);
  });
});

describe('schedule instructor display', () => {
  it('shows every unique participant name', () => {
    const item = {
      instructorName: '첫 강사',
      instructors: [
        { instructorId: 'a', instructorName: '김강사', participationKind: 'regular', payableMinutes: 60 },
        { instructorId: 'b', instructorName: '이강사', participationKind: 'assistant', payableMinutes: 60 },
        { instructorId: 'c', instructorName: '김강사', participationKind: 'regular', payableMinutes: 60 },
      ],
    } as ScheduleItem;

    expect(scheduleInstructorNames(item)).toBe('김강사, 이강사');
  });
});
