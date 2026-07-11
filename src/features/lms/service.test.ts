import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLmsServiceStateForTests,
  addLmsInvalidationListener,
  applyLmsInvalidation,
  buildStaffRosterPath,
  buildStudentRosterPath,
  changeClassMembers,
  checkScheduleConflicts,
  createClass,
  getDashboardData,
  loadClassMemberCandidates,
  loadStaffOperationsOverview,
  loadStudentLearningMetrics,
  loadStudentOperationsOverview,
  mutateSchedule,
  normalizeInvalidationPayload,
  recordAttendanceBatch,
} from './service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LMS service cache policy', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T00:00:00Z'));
    __resetLmsServiceStateForTests();
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'POST') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({
        success: true,
        data: {
          url: String(input),
          fetchedAt: Date.now(),
          classes: [],
          students: [],
          weakTypes: [],
          billing: [],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    __resetLmsServiceStateForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function getFetchCount() {
    return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST').length;
  }

  it('dedupes operational GET requests inside the five minute window', async () => {
    await getDashboardData('academy-1', '2026-07-07', '2026-07');
    await getDashboardData('academy-1', '2026-07-07', '2026-07');

    expect(getFetchCount()).toBe(1);
  });

  it('bypasses cache when force is requested', async () => {
    await getDashboardData('academy-1', '2026-07-07', '2026-07');
    await getDashboardData('academy-1', '2026-07-07', '2026-07', { force: true });

    expect(getFetchCount()).toBe(2);
  });

  it('clears cached academy data after a mutation', async () => {
    await getDashboardData('academy-1', '2026-07-07', '2026-07');
    await createClass('academy-1', { name: 'A' });
    await getDashboardData('academy-1', '2026-07-07', '2026-07');

    expect(getFetchCount()).toBe(2);
  });

  it('uses contextual class-operation endpoints and payload envelopes', async () => {
    await loadClassMemberCandidates('academy-1', 'class-1', '  홍 길동  ');
    const recurring = {
      kind: 'recurring' as const,
      scope: 'all' as const,
      classId: 'class-1',
      startDate: '2026-07-06',
      dayOfWeek: 0,
      startTime: '10:00',
      endTime: '11:00',
    };
    const single = {
      kind: 'single' as const,
      scope: 'single' as const,
      classId: 'class-1',
      date: '2026-07-06',
      startTime: '10:00',
      endTime: '11:00',
      status: 'normal' as const,
    };
    await checkScheduleConflicts('academy-1', recurring);
    await mutateSchedule('academy-1', recurring);
    await mutateSchedule('academy-1', single);
    await changeClassMembers('academy-1', {
      classId: 'class-1',
      effectiveDate: '2026-07-07',
      changes: [{ studentId: 'student-1', action: 'remove' }],
    });
    await recordAttendanceBatch('academy-1', {
      classId: 'class-1',
      date: '2026-07-06',
      startTime: '10:00',
      endTime: '11:00',
      records: [{ studentId: 'student-1', status: 'present', attendedMinutes: 60, billableMinutes: 60 }],
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      method: (init as RequestInit | undefined)?.method || 'GET',
      body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : null,
    }));
    expect(calls[0]?.url).toBe('/api/lms/classes/members?academyId=academy-1&classId=class-1&q=%ED%99%8D+%EA%B8%B8%EB%8F%99');
    expect(calls.slice(1).map((call) => call.url)).toEqual([
      '/api/lms/schedule-conflicts',
      '/api/lms/schedule-rules',
      '/api/lms/lesson-occurrences',
      '/api/lms/classes/members',
      '/api/lms/attendance',
    ]);
    expect(calls[1]?.body).toEqual({ academyId: 'academy-1', input: recurring });
    expect(calls[2]?.body).toEqual({ academyId: 'academy-1', mutation: recurring });
    expect(calls[3]?.body).toEqual({ academyId: 'academy-1', mutation: single });
    expect(calls[5]?.body).toMatchObject({ academyId: 'academy-1', batch: { records: [{ status: 'present' }] } });
  });

  it('expires volatile learning data after thirty seconds', async () => {
    await loadStudentLearningMetrics('academy-1', ['student-1']);
    vi.advanceTimersByTime(29_000);
    await loadStudentLearningMetrics('academy-1', ['student-1']);
    vi.advanceTimersByTime(1_100);
    await loadStudentLearningMetrics('academy-1', ['student-1']);

    expect(getFetchCount()).toBe(2);
  });

  it('builds canonical student and staff roster request paths', () => {
    expect(buildStudentRosterPath('academy-1', {
      q: '  홍 길 동 ',
      classId: 'class-1',
      status: 'active',
      cursor: 'cursor-1',
      limit: 25,
    })).toBe('/api/lms/students?academyId=academy-1&cursor=cursor-1&limit=25&q=%ED%99%8D+%EA%B8%B8+%EB%8F%99&classId=class-1&status=active');
    expect(buildStaffRosterPath('academy-1', {
      q: ' Kim ',
      role: 'instructor',
      status: 'on_leave',
    })).toBe('/api/lms/staff/overview?academyId=academy-1&q=kim&role=instructor&status=on_leave');
  });

  it('uses distinct cache keys for different roster filters', async () => {
    await loadStudentOperationsOverview('academy-1', { q: 'kim' });
    await loadStudentOperationsOverview('academy-1', { q: 'lee' });
    await loadStaffOperationsOverview('academy-1', { role: 'teacher' });
    await loadStaffOperationsOverview('academy-1', { role: 'instructor' });

    expect(getFetchCount()).toBe(4);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain('/api/lms/students?academyId=academy-1&q=kim');
    expect(urls).toContain('/api/lms/students?academyId=academy-1&q=lee');
    expect(urls).toContain('/api/lms/staff/overview?academyId=academy-1&role=teacher');
    expect(urls).toContain('/api/lms/staff/overview?academyId=academy-1&role=instructor');
  });

  it('forwards AbortSignal and never shares roster requests between consumers', async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();

    await Promise.all([
      loadStudentOperationsOverview('academy-1', { q: 'kim', signal: firstController.signal }),
      loadStudentOperationsOverview('academy-1', { q: 'kim', signal: secondController.signal }),
    ]);

    expect(getFetchCount()).toBe(2);
    const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'POST');
    expect((getCalls[0]?.[1] as RequestInit | undefined)?.signal).toBe(firstController.signal);
    expect((getCalls[1]?.[1] as RequestInit | undefined)?.signal).toBe(secondController.signal);
  });

  it('keeps roster requests live even without an AbortSignal', async () => {
    await Promise.all([
      loadStaffOperationsOverview('academy-1', { q: 'kim' }),
      loadStaffOperationsOverview('academy-1', { q: 'kim' }),
    ]);

    expect(getFetchCount()).toBe(2);
  });

  it('normalizes v1 invalidations into the canonical v2 contract', () => {
    expect(normalizeInvalidationPayload({
      academyId: 'academy-1',
      domain: 'students',
      id: 'student-1',
      studentId: 'student-1',
      changedAt: '2026-07-07T00:00:00.000Z',
    })).toMatchObject({
      version: 2,
      academyId: 'academy-1',
      domains: ['students'],
      entityIds: ['student-1'],
      coreStudentId: 'student-1',
    });
  });

  it('coalesces multiple domains for one academy into one refresh event', () => {
    const listener = vi.fn();
    const unsubscribe = addLmsInvalidationListener(listener);

    applyLmsInvalidation({
      version: 2,
      eventId: 'event-1',
      academyId: 'academy-1',
      domains: ['students'],
      occurredAt: '2026-07-07T00:00:00.000Z',
    });
    applyLmsInvalidation({
      version: 2,
      eventId: 'event-2',
      academyId: 'academy-1',
      domains: ['assignments'],
      occurredAt: '2026-07-07T00:00:00.100Z',
    });

    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].domains).toEqual(['students', 'assignments']);
    unsubscribe();
  });

  it('deduplicates the same realtime event id', () => {
    const listener = vi.fn();
    const unsubscribe = addLmsInvalidationListener(listener);
    const event = {
      version: 2 as const,
      eventId: 'event-same',
      academyId: 'academy-1',
      domains: ['classes'],
      occurredAt: '2026-07-07T00:00:00.000Z',
    };

    applyLmsInvalidation(event);
    applyLmsInvalidation(event);
    vi.advanceTimersByTime(300);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
