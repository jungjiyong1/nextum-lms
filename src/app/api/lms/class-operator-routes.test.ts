import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertRole: vi.fn(),
  assertOrigin: vi.fn(),
  assertDurable: vi.fn(),
  assertOccurrence: vi.fn(),
  mutateSchedule: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  updateOccurrence: vi.fn(),
  recordAttendance: vi.fn(),
  recordAttendanceBatch: vi.fn(),
}));

vi.mock('@/lib/lms/auth', () => ({
  assertLmsRoleForAcademy: mocks.assertRole,
  assertSameOrigin: mocks.assertOrigin,
  authErrorResponse: vi.fn(() => null),
}));

vi.mock('@/lib/lms/class-access', () => ({
  assertDurableClassOperatorAccess: mocks.assertDurable,
  assertOccurrenceStatusAccess: mocks.assertOccurrence,
}));

vi.mock('@/lib/lms/mutations', () => ({
  mutateScheduleForAcademy: mocks.mutateSchedule,
  createScheduleRuleForAcademy: mocks.createRule,
  updateScheduleRuleForAcademy: mocks.updateRule,
  updateLessonOccurrenceForAcademy: mocks.updateOccurrence,
  recordAttendanceForAcademy: mocks.recordAttendance,
  recordAttendanceBatchForAcademy: mocks.recordAttendanceBatch,
}));

import { POST as mutateRule } from './schedule-rules/route';
import { POST as mutateOccurrence } from './lesson-occurrences/route';
import { POST as recordAttendance } from './attendance/route';

const ACADEMY_ID = '00000000-0000-4000-8000-000000000201';
const CLASS_ID = '00000000-0000-4000-8000-000000000202';
const OCCURRENCE_ID = '00000000-0000-4000-8000-000000000203';

const actor = {
  academyId: ACADEMY_ID,
  userId: '00000000-0000-4000-8000-000000000204',
  personId: '00000000-0000-4000-8000-000000000205',
  role: 'teacher',
};

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('assigned class operator API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.assertRole.mockResolvedValue(actor);
    mocks.assertDurable.mockResolvedValue(undefined);
    mocks.assertOccurrence.mockResolvedValue('durable_operator');
    mocks.mutateSchedule.mockResolvedValue({ kind: 'recurring', id: 'rule-1', conflicts: [] });
  });

  it('allows a teacher to mutate schedule structure only after durable class authorization', async () => {
    const mutation = {
      kind: 'recurring', scope: 'all', classId: CLASS_ID, startTime: '16:00', endTime: '17:00',
    };
    const response = await mutateRule(request('/api/lms/schedule-rules', {
      academyId: ACADEMY_ID,
      mutation,
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertRole).toHaveBeenCalledWith(
      ACADEMY_ID,
      ['owner', 'admin', 'staff', 'teacher', 'instructor'],
    );
    expect(mocks.assertDurable).toHaveBeenCalledWith(actor, mutation);
    expect(mocks.mutateSchedule).toHaveBeenCalledWith(ACADEMY_ID, mutation, actor);
  });

  it('lets a one-off participant update an existing occurrence status and notes', async () => {
    mocks.assertOccurrence.mockResolvedValue('occurrence_participant');
    const input = {
      occurrenceId: OCCURRENCE_ID,
      classId: CLASS_ID,
      date: '2026-07-12',
      startTime: '16:00',
      endTime: '17:00',
      status: 'makeup',
      notes: '보강 진행',
    };
    const response = await mutateOccurrence(request('/api/lms/lesson-occurrences', {
      academyId: ACADEMY_ID,
      input,
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertOccurrence).toHaveBeenCalledWith(actor, input);
    expect(mocks.updateOccurrence).toHaveBeenCalledWith(ACADEMY_ID, input);
  });

  it('blocks participant and room changes from a one-off occurrence participant', async () => {
    mocks.assertOccurrence.mockResolvedValue('occurrence_participant');
    const response = await mutateOccurrence(request('/api/lms/lesson-occurrences', {
      academyId: ACADEMY_ID,
      input: {
        occurrenceId: OCCURRENCE_ID,
        classId: CLASS_ID,
        date: '2026-07-12',
        startTime: '16:00',
        endTime: '17:00',
        status: 'normal',
        participants: [{ instructorId: actor.userId }],
      },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'LESSON_STRUCTURE_FORBIDDEN' },
    });
    expect(mocks.updateOccurrence).not.toHaveBeenCalled();
  });

  it('allows a durable teacher to use the structural occurrence mutation path', async () => {
    const mutation = {
      kind: 'single', scope: 'single', classId: CLASS_ID, occurrenceId: OCCURRENCE_ID,
      date: '2026-07-12', startTime: '17:00', endTime: '18:00',
    };
    mocks.mutateSchedule.mockResolvedValue({ kind: 'single', id: OCCURRENCE_ID, conflicts: [] });

    const response = await mutateOccurrence(request('/api/lms/lesson-occurrences', {
      academyId: ACADEMY_ID,
      mutation,
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertDurable).toHaveBeenCalledWith(actor, mutation);
    expect(mocks.mutateSchedule).toHaveBeenCalledWith(ACADEMY_ID, mutation, actor);
  });

  it('authorizes one-off attendance against the exact existing occurrence', async () => {
    mocks.assertOccurrence.mockResolvedValue('occurrence_participant');
    mocks.recordAttendanceBatch.mockResolvedValue({ occurrenceId: OCCURRENCE_ID, recorded: 1 });
    const batch = {
      occurrenceId: OCCURRENCE_ID,
      classId: CLASS_ID,
      date: '2026-07-12',
      startTime: '16:00',
      endTime: '17:00',
      records: [{ studentId: 'student-1', status: 'present' }],
    };

    const response = await recordAttendance(request('/api/lms/attendance', {
      academyId: ACADEMY_ID,
      batch,
    }));

    expect(response.status).toBe(200);
    expect(mocks.assertOccurrence).toHaveBeenCalledWith(actor, batch);
    expect(mocks.recordAttendanceBatch).toHaveBeenCalledWith(ACADEMY_ID, batch, actor);
  });
});
