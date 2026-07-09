import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLmsGetCache,
  createClass,
  getDashboardData,
  loadStudentLearningMetrics,
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
    clearLmsGetCache();
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
    clearLmsGetCache();
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

  it('expires volatile learning data after thirty seconds', async () => {
    await loadStudentLearningMetrics('academy-1', ['student-1']);
    vi.advanceTimersByTime(29_000);
    await loadStudentLearningMetrics('academy-1', ['student-1']);
    vi.advanceTimersByTime(1_100);
    await loadStudentLearningMetrics('academy-1', ['student-1']);

    expect(getFetchCount()).toBe(2);
  });
});
