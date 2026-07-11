import { csrfHeaders, jsonCsrfHeaders } from '@/lib/lms/csrf-client';
import { supabase } from '@/core/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  AccountingOperationsOverview,
  BatchAttendanceInput,
  AssignmentManagementData,
  AdminCsvExport,
  AdminExportOptions,
  AdminExportType,
  AdminResetTarget,
  ClassOperationsDetail,
  ClassOperationsOverview,
  ClassMemberCandidate,
  ClassMembershipChangeInput,
  CreateBookInput,
  CreateClassInput,
  CreateClassroomInput,
  CreateExpenseInput,
  CreateInstructorPaymentInput,
  CreateLearningAssignmentInput,
  CreateStudentResult,
  CreateScheduleRuleInput,
  DeleteScheduleInput,
  CreateStaffInput,
  CreateStudentInput,
  DashboardData,
  RecordAttendanceInput,
  RecordPaymentInput,
  StaffDetail,
  StaffDetailSection,
  StaffHardDeletePreview,
  StaffMutationResult,
  StaffOperationsOverview,
  StaffRole,
  StaffStatus,
  StaffSummary,
  ScheduleConflict,
  ScheduleMutationInput,
  StudentAiConversationRow,
  StudentDetail,
  StudentDetailSection,
  StudentHardDeletePreview,
  StudentLearningMetric,
  StudentLearningPeriod,
  StudentMutationResult,
  StudentOperationsOverview,
  StudentStatus,
  StudentSignupInvitation,
  LearningAssignmentDetail,
  UpdateBookInput,
  UpdateClassInput,
  UpdateClassroomInput,
  UpdateLessonOccurrenceInput,
  UpdateScheduleRuleInput,
  UpdateStaffInput,
  UpdateStudentInput,
} from './types';

export type LmsCachePolicy = 'static' | 'operational' | 'volatile' | 'live';

export interface LmsRequestOptions {
  force?: boolean;
  policy?: LmsCachePolicy;
  signal?: AbortSignal;
}

export interface StudentDetailRequestOptions extends LmsRequestOptions {
  period?: StudentLearningPeriod;
  assignmentId?: string | null;
}

export interface LmsInvalidationPayload {
  version: 2;
  eventId: string;
  academyId: string;
  domains: string[];
  entityType?: string;
  entityIds?: string[];
  coreStudentId?: string;
  occurredAt: string;
  sourceId?: string;
  /** @deprecated v1 listener alias; use domains. */
  domain?: string;
  /** @deprecated v1 listener alias; use coreStudentId. */
  studentId?: string;
}

export interface CursorRequestOptions extends LmsRequestOptions {
  cursor?: string | null;
  limit?: number;
}

export interface StudentRosterRequestOptions extends CursorRequestOptions {
  q?: string;
  classId?: string | null;
  status?: 'operations' | 'all' | StudentStatus;
}

export interface StaffRosterRequestOptions extends CursorRequestOptions {
  q?: string;
  role?: 'all' | StaffRole;
  status?: 'operations' | 'all' | StaffStatus;
}

interface LmsCacheInvalidationScope {
  academyId?: string | null;
  pathPrefix?: string;
  domains?: readonly string[];
}

interface LmsMutationOptions {
  mutates?: boolean;
}

const CACHE_TTL_MS: Record<LmsCachePolicy, number> = {
  static: 10 * 60 * 1000,
  operational: 5 * 60 * 1000,
  volatile: 30 * 1000,
  live: 0,
};

const LMS_LOCAL_CACHE_CHANNEL = 'nextum-lms-cache';
const LMS_STORAGE_EVENT_KEY = 'nextum-lms-cache-invalidated';
const LMS_REALTIME_EVENT = 'lms-cache-invalidated';
const LMS_REALTIME_EVENT_V2 = 'lms-cache-invalidated-v2';
const INVALIDATION_COALESCE_MS = 300;
const SEEN_EVENT_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;
const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const getCache = new Map<string, { expiresAt: number; promise: Promise<unknown>; lastAccessedAt: number }>();
const inFlightGets = new Map<string, Promise<unknown>>();
const invalidationListeners = new Set<(payload: LmsInvalidationPayload) => void>();
const realtimeChannels = new Map<string, { channel: RealtimeChannel; refCount: number }>();
const seenEventIds = new Map<string, number>();
const pendingInvalidations = new Map<string, { payload: LmsInvalidationPayload; timer: ReturnType<typeof setTimeout> }>();
let localCacheChannel: BroadcastChannel | null = null;
let localInvalidationBridgeReady = false;

function apiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object') {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function newEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeInvalidationPayload(value: unknown): LmsInvalidationPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;

  if (payload.version === 2) {
    const academyId = typeof payload.academyId === 'string' ? payload.academyId : '';
    const domains = Array.isArray(payload.domains)
      ? [...new Set(payload.domains.filter((domain): domain is string => typeof domain === 'string' && domain.length > 0))]
      : [];
    if (!academyId || domains.length === 0) return null;
    return {
      version: 2,
      eventId: typeof payload.eventId === 'string' && payload.eventId
        ? payload.eventId
        : newEventId(),
      academyId,
      domains,
      entityType: typeof payload.entityType === 'string' ? payload.entityType : undefined,
      entityIds: Array.isArray(payload.entityIds)
        ? payload.entityIds.filter((id): id is string => typeof id === 'string')
        : undefined,
      coreStudentId: typeof payload.coreStudentId === 'string' ? payload.coreStudentId : undefined,
      occurredAt: typeof payload.occurredAt === 'string' ? payload.occurredAt : new Date().toISOString(),
      sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : undefined,
      domain: domains.length === 1 ? domains[0] : undefined,
      studentId: typeof payload.coreStudentId === 'string' ? payload.coreStudentId : undefined,
    };
  }

  // Compatibility adapter for the Grade App and older LMS database triggers.
  const academyId = typeof payload.academyId === 'string' ? payload.academyId : '';
  const domain = typeof payload.domain === 'string' && payload.domain ? payload.domain : 'lms';
  if (!academyId) return null;
  const legacyId = typeof payload.id === 'string' ? payload.id : null;
  const changedAt = typeof payload.changedAt === 'string' ? payload.changedAt : new Date().toISOString();
  return {
    version: 2,
    eventId: typeof payload.eventId === 'string' && payload.eventId
      ? payload.eventId
      : `v1:${academyId}:${domain}:${legacyId ?? ''}:${changedAt}`,
    academyId,
    domains: [domain],
    entityType: typeof payload.entity === 'string' ? payload.entity : undefined,
    entityIds: legacyId ? [legacyId] : undefined,
    coreStudentId: typeof payload.coreStudentId === 'string'
      ? payload.coreStudentId
      : (typeof payload.studentId === 'string' ? payload.studentId : undefined),
    occurredAt: changedAt,
    sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : undefined,
    domain,
    studentId: typeof payload.coreStudentId === 'string'
      ? payload.coreStudentId
      : (typeof payload.studentId === 'string' ? payload.studentId : undefined),
  };
}

function academyIdFromPath(path: string): string | null {
  try {
    const base = typeof window === 'undefined' ? 'http://nextum.local' : window.location.origin;
    return new URL(path, base).searchParams.get('academyId');
  } catch {
    return null;
  }
}

function shouldClearCacheKey(path: string, scope?: LmsCacheInvalidationScope): boolean {
  if (scope?.pathPrefix && !path.startsWith(scope.pathPrefix)) return false;
  if (scope?.academyId) {
    const cacheAcademyId = academyIdFromPath(path);
    if (cacheAcademyId && cacheAcademyId !== scope.academyId) return false;
  }
  if (!scope?.domains?.length || scope.domains.includes('lms') || scope.domains.includes('admin')) return true;
  if (path.includes('/dashboard')) return true;

  return scope.domains.some((domain) => {
    if (domain === 'students') return path.includes('/students');
    if (domain === 'staff') return path.includes('/staff');
    if (domain === 'assignments') return path.includes('/assignments') || path.includes('/books');
    if (domain === 'accounting') {
      return path.includes('/accounting')
        || path.includes('/billing')
        || path.includes('/payments')
        || path.includes('/expenses')
        || path.includes('/payroll')
        || path.includes('/tax-settings');
    }
    if (domain === 'classes') {
      return path.includes('/classes')
        || path.includes('/classrooms')
        || path.includes('/schedule')
        || path.includes('/lesson')
        || path.includes('/attendance')
        || path.includes('/class-books');
    }
    return true;
  });
}

export function clearLmsGetCache(scope?: LmsCacheInvalidationScope) {
  if (!scope) {
    getCache.clear();
    inFlightGets.clear();
    return;
  }
  for (const key of [...getCache.keys()]) {
    if (shouldClearCacheKey(key, scope)) getCache.delete(key);
  }
  for (const key of [...inFlightGets.keys()]) {
    if (shouldClearCacheKey(key, scope)) inFlightGets.delete(key);
  }
}

export function __resetLmsServiceStateForTests() {
  clearLmsGetCache();
  for (const pending of pendingInvalidations.values()) clearTimeout(pending.timer);
  pendingInvalidations.clear();
  seenEventIds.clear();
  invalidationListeners.clear();
}

function emitInvalidation(payload: LmsInvalidationPayload) {
  for (const listener of invalidationListeners) {
    try {
      listener(payload);
    } catch (err) {
      console.warn('[LMS] Cache invalidation listener failed:', err);
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nextum:lms-cache-invalidated', { detail: payload }));
  }
}

function rememberEvent(eventId: string): boolean {
  const now = Date.now();
  for (const [seenId, seenAt] of seenEventIds) {
    if (now - seenAt > SEEN_EVENT_TTL_MS) seenEventIds.delete(seenId);
  }
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.set(eventId, now);
  return true;
}

function mergeInvalidations(current: LmsInvalidationPayload, next: LmsInvalidationPayload): LmsInvalidationPayload {
  const domains = [...new Set([...current.domains, ...next.domains])];
  const coreStudentId = current.coreStudentId ?? next.coreStudentId;
  return {
    ...current,
    domains,
    entityIds: [...new Set([...(current.entityIds ?? []), ...(next.entityIds ?? [])])],
    coreStudentId,
    occurredAt: current.occurredAt > next.occurredAt ? current.occurredAt : next.occurredAt,
    domain: domains.length === 1 ? domains[0] : undefined,
    studentId: coreStudentId,
  };
}

export function applyLmsInvalidation(payload: LmsInvalidationPayload) {
  if (!rememberEvent(payload.eventId)) return;
  clearLmsGetCache({ academyId: payload.academyId, domains: payload.domains });

  const pending = pendingInvalidations.get(payload.academyId);
  if (pending) {
    pending.payload = mergeInvalidations(pending.payload, payload);
    return;
  }

  const entry = {
    payload,
    timer: setTimeout(() => {
      const queued = pendingInvalidations.get(payload.academyId);
      if (!queued) return;
      pendingInvalidations.delete(payload.academyId);
      emitInvalidation(queued.payload);
    }, INVALIDATION_COALESCE_MS),
  };
  pendingInvalidations.set(payload.academyId, entry);
}

function ensureLocalInvalidationBridge() {
  if (localInvalidationBridgeReady || typeof window === 'undefined') return;
  localInvalidationBridgeReady = true;

  if ('BroadcastChannel' in window) {
    try {
      localCacheChannel = new BroadcastChannel(LMS_LOCAL_CACHE_CHANNEL);
      localCacheChannel.onmessage = (event: MessageEvent<unknown>) => {
        const payload = normalizeInvalidationPayload(event.data);
        if (!payload || payload.sourceId === instanceId) return;
        applyLmsInvalidation(payload);
      };
    } catch {
      localCacheChannel = null;
    }
  }

  if (!localCacheChannel) {
    window.addEventListener('storage', (event) => {
      if (event.key !== LMS_STORAGE_EVENT_KEY || !event.newValue) return;
      try {
        const payload = normalizeInvalidationPayload(JSON.parse(event.newValue));
        if (!payload || payload.sourceId === instanceId) return;
        applyLmsInvalidation(payload);
      } catch {
        // Ignore malformed invalidation signals from older tabs.
      }
    });
  }
}

function publishLocalInvalidation(payload: LmsInvalidationPayload) {
  if (typeof window === 'undefined') return;
  ensureLocalInvalidationBridge();
  const nextPayload = { ...payload, sourceId: instanceId };
  if (localCacheChannel) {
    localCacheChannel.postMessage(nextPayload);
    return;
  }
  try {
    window.localStorage.setItem(LMS_STORAGE_EVENT_KEY, JSON.stringify(nextPayload));
    window.localStorage.removeItem(LMS_STORAGE_EVENT_KEY);
  } catch {
    // Storage can be blocked; BroadcastChannel is the primary path.
  }
}

function mutationDomainFromPath(path: string): string {
  if (path.includes('/students')) return 'students';
  if (path.includes('/classes') || path.includes('/schedule') || path.includes('/lesson') || path.includes('/attendance') || path.includes('/class-books') || path.includes('/classrooms')) return 'classes';
  if (path.includes('/assignments') || path.includes('/books')) return 'assignments';
  if (path.includes('/billing') || path.includes('/payments') || path.includes('/expenses') || path.includes('/payroll') || path.includes('/tax-settings')) return 'accounting';
  if (path.includes('/staff')) return 'staff';
  if (path.includes('/admin/reset')) return 'admin';
  return 'lms';
}

function idFromMutationPayload(payload: Record<string, unknown>): string | null {
  const id = payload.studentId ?? payload.classId ?? payload.staffId ?? payload.bookId ?? payload.classroomId ?? payload.ruleId;
  return typeof id === 'string' ? id : null;
}

function invalidationFromMutation(path: string, payload: Record<string, unknown>): LmsInvalidationPayload {
  const academyId = typeof payload.academyId === 'string' ? payload.academyId : '';
  const entityId = idFromMutationPayload(payload);
  return {
    version: 2,
    eventId: newEventId(),
    academyId,
    domains: [mutationDomainFromPath(path)],
    entityType: path,
    entityIds: entityId ? [entityId] : undefined,
    coreStudentId: typeof payload.coreStudentId === 'string'
      ? payload.coreStudentId
      : (typeof payload.studentId === 'string' ? payload.studentId : undefined),
    occurredAt: new Date().toISOString(),
    domain: mutationDomainFromPath(path),
    studentId: typeof payload.studentId === 'string' ? payload.studentId : undefined,
  };
}

function invalidationFromMetadata(
  value: unknown,
  path: string,
  payload: Record<string, unknown>,
): LmsInvalidationPayload | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as Record<string, unknown>;
  const domains = Array.isArray(metadata.domains)
    ? metadata.domains.filter((domain): domain is string => typeof domain === 'string' && domain.length > 0)
    : [];
  const academyId = typeof payload.academyId === 'string' ? payload.academyId : '';
  if (!academyId || domains.length === 0 || typeof metadata.eventId !== 'string') return null;
  const fallback = invalidationFromMutation(path, payload);
  return {
    ...fallback,
    eventId: metadata.eventId,
    domains,
    domain: domains.length === 1 ? domains[0] : undefined,
  };
}

function invalidateAfterMutation(path: string, payload: Record<string, unknown>) {
  const invalidation = invalidationFromMutation(path, payload);
  if (!invalidation.academyId) {
    clearLmsGetCache();
    return;
  }
  applyLmsInvalidation(invalidation);
  publishLocalInvalidation(invalidation);
}

export function addLmsInvalidationListener(listener: (payload: LmsInvalidationPayload) => void): () => void {
  ensureLocalInvalidationBridge();
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

export function subscribeLmsInvalidations(academyId: string): () => void {
  if (!academyId || typeof window === 'undefined') return () => undefined;
  ensureLocalInvalidationBridge();

  const existing = realtimeChannels.get(academyId);
  if (existing) {
    existing.refCount += 1;
    return () => {
      existing.refCount -= 1;
      if (existing.refCount <= 0) {
        realtimeChannels.delete(academyId);
        void supabase.removeChannel(existing.channel);
      }
    };
  }

  const channel = supabase.channel(`academy:${academyId}:lms-cache`, {
    config: {
      private: true,
      broadcast: { self: false },
    },
  });

  const handleRealtimeInvalidation = (message: { payload: unknown }) => {
    const payload = normalizeInvalidationPayload(message.payload);
    if (!payload || payload.sourceId === instanceId) return;
    applyLmsInvalidation(payload);
  };
  channel.on('broadcast', { event: LMS_REALTIME_EVENT }, handleRealtimeInvalidation);
  channel.on('broadcast', { event: LMS_REALTIME_EVENT_V2 }, handleRealtimeInvalidation);

  realtimeChannels.set(academyId, { channel, refCount: 1 });
  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('[LMS] Realtime cache invalidation channel status:', status);
    }
  });

  return () => {
    const entry = realtimeChannels.get(academyId);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      realtimeChannels.delete(academyId);
      void supabase.removeChannel(entry.channel);
    }
  };
}

async function postLmsMutation<T = undefined>(
  path: string,
  payload: Record<string, unknown>,
  options: LmsMutationOptions = {},
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: jsonCsrfHeaders(),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null) as ({
    success?: boolean;
    error?: unknown;
    invalidation?: unknown;
  } & Record<string, unknown>) | null;
  if (!response.ok || !result?.success) {
    throw new Error(apiErrorMessage(result?.error, '요청 처리에 실패했습니다.'));
  }
  if (options.mutates !== false) {
    const serverInvalidation = normalizeInvalidationPayload(result.invalidation)
      ?? invalidationFromMetadata(result.invalidation, path, payload);
    if (serverInvalidation) {
      applyLmsInvalidation(serverInvalidation);
      publishLocalInvalidation(serverInvalidation);
    } else {
      invalidateAfterMutation(path, payload);
    }
  }
  return result as T;
}

async function getLmsJson<T>(path: string, options: LmsRequestOptions = {}): Promise<T> {
  const policy = options.policy ?? 'operational';
  const ttl = CACHE_TTL_MS[policy];
  if (options.signal || policy === 'live') {
    return fetchLmsJson<T>(path, options.signal);
  }
  const now = Date.now();
  for (const [key, entry] of getCache) {
    if (entry.expiresAt <= now) getCache.delete(key);
  }

  if (!options.force && ttl > 0) {
    const cached = getCache.get(path);
    if (cached) {
      cached.lastAccessedAt = now;
      getCache.delete(path);
      getCache.set(path, cached);
      return cached.promise as Promise<T>;
    }
  }

  const inFlight = inFlightGets.get(path);
  if (inFlight) return inFlight as Promise<T>;

  const promise = fetchLmsJson<T>(path);
  inFlightGets.set(path, promise);
  if (ttl > 0) {
    while (getCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = getCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      getCache.delete(oldestKey);
    }
    // Forced refreshes replace the cached promise so subsequent reads reuse the
    // fresh result instead of immediately issuing another request.
    getCache.set(path, { expiresAt: now + ttl, promise, lastAccessedAt: now });
  }
  void promise.then(
    () => {
      if (inFlightGets.get(path) === promise) inFlightGets.delete(path);
    },
    () => {
      if (inFlightGets.get(path) === promise) inFlightGets.delete(path);
      if (getCache.get(path)?.promise === promise) getCache.delete(path);
    },
  );
  return promise;
}

async function fetchLmsJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  const result = await response.json().catch(() => null) as { success?: boolean; error?: unknown; data?: T } | null;
  if (!response.ok || !result?.success) {
    throw new Error(apiErrorMessage(result?.error, '요청 처리에 실패했습니다.'));
  }
  return result.data as T;
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim());
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();

  const plainMatch = disposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || fallback;
}

async function postLmsCsvExport(path: string, payload: Record<string, unknown>): Promise<AdminCsvExport> {
  const response = await fetch(path, {
    method: 'POST',
    headers: jsonCsrfHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(apiErrorMessage(result?.error, 'CSV 내보내기에 실패했습니다.'));
  }

  return {
    filename: filenameFromDisposition(response.headers.get('Content-Disposition'), 'nextum-lms-export.csv'),
    csv: await response.text(),
  };
}

async function postLmsForm<T = undefined>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: csrfHeaders(),
    body: form,
  });
  const result = await response.json().catch(() => null) as ({
    success?: boolean;
    error?: unknown;
    invalidation?: unknown;
  } & Record<string, unknown>) | null;
  if (!response.ok || !result?.success) {
    throw new Error(apiErrorMessage(result?.error, '요청 처리에 실패했습니다.'));
  }
  const payload = { academyId: String(form.get('academyId') || '') };
  const serverInvalidation = normalizeInvalidationPayload(result.invalidation)
    ?? invalidationFromMetadata(result.invalidation, path, payload);
  if (serverInvalidation) {
    applyLmsInvalidation(serverInvalidation);
    publishLocalInvalidation(serverInvalidation);
  } else {
    invalidateAfterMutation(path, payload);
  }
  return result as T;
}

export async function getDashboardData(academyId: string, date: string, serviceMonth: string, options: LmsRequestOptions = {}): Promise<DashboardData> {
  const params = new URLSearchParams({ academyId, date, serviceMonth });
  return getLmsJson<DashboardData>(`/api/lms/dashboard?${params.toString()}`, { policy: 'operational', ...options });
}

export async function createClass(academyId: string, input: CreateClassInput): Promise<void> {
  await postLmsMutation('/api/lms/classes', { academyId, input });
}

export async function updateClass(academyId: string, classId: string, input: UpdateClassInput): Promise<void> {
  await postLmsMutation('/api/lms/classes', { academyId, classId, input });
}

export async function loadClassOperationsOverview(
  academyId: string,
  startDate: string,
  endDate: string,
  view: 'overview' | 'schedule' | 'attendance' | 'settings',
  options: LmsRequestOptions = {},
): Promise<ClassOperationsOverview> {
  const params = new URLSearchParams({ academyId, startDate, endDate, view });
  return getLmsJson<ClassOperationsOverview>(`/api/lms/classes/overview?${params.toString()}`, { policy: 'operational', ...options });
}

export async function loadClassOperationsDetail(
  academyId: string,
  classId: string,
  options: LmsRequestOptions = {},
): Promise<ClassOperationsDetail> {
  const params = new URLSearchParams({ academyId, classId });
  return getLmsJson<ClassOperationsDetail>(`/api/lms/classes/detail?${params.toString()}`, { policy: 'operational', ...options });
}

export async function loadClassMemberCandidates(
  academyId: string,
  classId: string,
  query = '',
  options: LmsRequestOptions = {},
): Promise<ClassMemberCandidate[]> {
  const params = new URLSearchParams({ academyId, classId });
  if (query.trim()) params.set('q', query.trim());
  return getLmsJson<ClassMemberCandidate[]>(`/api/lms/classes/members?${params.toString()}`, { policy: 'live', ...options });
}

export async function changeClassMembers(academyId: string, input: ClassMembershipChangeInput): Promise<void> {
  await postLmsMutation('/api/lms/classes/members', { academyId, input });
}

export async function createScheduleRule(academyId: string, input: CreateScheduleRuleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedule-rules', { academyId, input });
}

export async function updateScheduleRule(academyId: string, ruleId: string, input: UpdateScheduleRuleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedule-rules', { academyId, ruleId, input });
}

export async function checkScheduleConflicts(academyId: string, input: ScheduleMutationInput): Promise<ScheduleConflict[]> {
  const result = await postLmsMutation<{ data?: ScheduleConflict[] }>(
    '/api/lms/schedule-conflicts',
    { academyId, input },
    { mutates: false },
  );
  return result.data || [];
}

export async function mutateSchedule(academyId: string, input: ScheduleMutationInput): Promise<void> {
  const path = input.kind === 'recurring' ? '/api/lms/schedule-rules' : '/api/lms/lesson-occurrences';
  await postLmsMutation(path, { academyId, mutation: input });
}

export async function deleteSchedule(academyId: string, input: DeleteScheduleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedules/delete', { academyId, input });
}

export async function updateLessonOccurrence(academyId: string, input: UpdateLessonOccurrenceInput): Promise<void> {
  await postLmsMutation('/api/lms/lesson-occurrences', { academyId, input });
}

export async function createStudent(academyId: string, input: CreateStudentInput): Promise<CreateStudentResult> {
  const result = await postLmsMutation<{ data?: CreateStudentResult }>('/api/lms/students', { academyId, input });
  if (!result.data?.invitation?.inviteCode) {
    throw new Error('가입 코드를 발행하지 못했습니다.');
  }
  return result.data;
}

export async function updateStudent(academyId: string, studentId: string, input: UpdateStudentInput): Promise<void> {
  await postLmsMutation('/api/lms/students', { academyId, studentId, input });
}

export async function issueStudentInvitation(
  academyId: string,
  studentId: string,
  loginHint?: string | null,
): Promise<StudentSignupInvitation> {
  const result = await postLmsMutation<{ invitation?: StudentSignupInvitation }>('/api/lms/students/invitations', {
    academyId,
    studentId,
    loginHint: loginHint || null,
  });
  if (!result.invitation?.inviteCode) {
    throw new Error('가입 코드를 발행하지 못했습니다.');
  }
  return result.invitation;
}

export function buildStudentRosterPath(academyId: string, options: StudentRosterRequestOptions = {}): string {
  const params = new URLSearchParams({ academyId });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = options.q?.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR');
  if (query) params.set('q', query);
  if (options.classId && options.classId !== 'all') params.set('classId', options.classId);
  if (options.status && options.status !== 'operations') params.set('status', options.status);
  return `/api/lms/students?${params.toString()}`;
}

export async function loadStudentOperationsOverview(academyId: string, options: StudentRosterRequestOptions = {}): Promise<StudentOperationsOverview> {
  return getLmsJson<StudentOperationsOverview>(buildStudentRosterPath(academyId, options), { ...options, policy: 'live' });
}

export async function loadStudentLearningMetrics(academyId: string, studentIds: string[], options: LmsRequestOptions = {}): Promise<StudentLearningMetric[]> {
  if (studentIds.length === 0) return [];
  const params = new URLSearchParams({ academyId, studentIds: studentIds.join(',') });
  return getLmsJson<StudentLearningMetric[]>(`/api/lms/students/learning-metrics?${params.toString()}`, { policy: 'volatile', ...options });
}

export async function loadStudentDetail(
  academyId: string,
  studentId: string,
  section: StudentDetailSection = 'full',
  options: StudentDetailRequestOptions = {},
): Promise<StudentDetail> {
  const params = new URLSearchParams({ academyId, studentId, section });
  if (options.period) params.set('period', options.period);
  if (options.assignmentId) params.set('assignmentId', options.assignmentId);
  return getLmsJson<StudentDetail>(`/api/lms/students/detail?${params.toString()}`, { policy: 'volatile', ...options });
}

export async function loadStudentAiConversations(
  academyId: string,
  studentId: string,
  assignmentId?: string | null,
  options: LmsRequestOptions = {},
): Promise<StudentAiConversationRow[]> {
  const params = new URLSearchParams({ academyId, studentId });
  if (assignmentId) params.set('assignmentId', assignmentId);
  return getLmsJson<StudentAiConversationRow[]>(`/api/lms/students/ai-conversations?${params.toString()}`, { policy: 'volatile', ...options });
}

export async function archiveStudent(academyId: string, studentId: string): Promise<StudentMutationResult> {
  const result = await postLmsMutation<{ data?: StudentMutationResult }>('/api/lms/students/archive', { academyId, studentId });
  if (!result.data) throw new Error('학생 보관 처리 결과를 확인할 수 없습니다.');
  return result.data;
}

export async function previewHardDeleteStudent(academyId: string, studentId: string): Promise<StudentHardDeletePreview> {
  const result = await postLmsMutation<{ data?: StudentHardDeletePreview }>('/api/lms/students/hard-delete-preview', { academyId, studentId }, { mutates: false });
  if (!result.data) throw new Error('완전삭제 가능 여부를 확인할 수 없습니다.');
  return result.data;
}

export async function hardDeleteStudent(academyId: string, studentId: string, confirmName: string): Promise<StudentMutationResult> {
  const result = await postLmsMutation<{ data?: StudentMutationResult }>('/api/lms/students/hard-delete', { academyId, studentId, confirmName });
  if (!result.data) throw new Error('완전삭제 결과를 확인할 수 없습니다.');
  return result.data;
}

export async function listStaff(academyId: string, options: LmsRequestOptions = {}): Promise<StaffSummary[]> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<StaffSummary[]>(`/api/lms/staff?${params.toString()}`, { policy: 'static', ...options });
}

export function buildStaffRosterPath(academyId: string, options: StaffRosterRequestOptions = {}): string {
  const params = new URLSearchParams({ academyId });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = options.q?.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko-KR');
  if (query) params.set('q', query);
  if (options.role && options.role !== 'all') params.set('role', options.role);
  if (options.status && options.status !== 'operations') params.set('status', options.status);
  return `/api/lms/staff/overview?${params.toString()}`;
}

export async function loadStaffOperationsOverview(academyId: string, options: StaffRosterRequestOptions = {}): Promise<StaffOperationsOverview> {
  return getLmsJson<StaffOperationsOverview>(buildStaffRosterPath(academyId, options), { ...options, policy: 'live' });
}

export async function loadStaffDetail(
  academyId: string,
  staffId: string,
  section: StaffDetailSection = 'full',
  serviceMonth?: string,
  options: LmsRequestOptions = {},
): Promise<StaffDetail> {
  const params = new URLSearchParams({ academyId, staffId, section });
  if (serviceMonth) params.set('serviceMonth', serviceMonth);
  return getLmsJson<StaffDetail>(`/api/lms/staff/detail?${params.toString()}`, { policy: 'operational', ...options });
}

export async function createStaff(academyId: string, input: CreateStaffInput): Promise<void> {
  await postLmsMutation('/api/lms/staff', { academyId, input });
}

export async function updateStaff(academyId: string, staffId: string, input: UpdateStaffInput): Promise<void> {
  await postLmsMutation('/api/lms/staff', { academyId, staffId, input });
}

export async function archiveStaff(academyId: string, staffId: string): Promise<StaffMutationResult> {
  const result = await postLmsMutation<{ data?: StaffMutationResult }>('/api/lms/staff/archive', { academyId, staffId });
  if (!result.data) throw new Error('강사 보관 처리 결과를 확인할 수 없습니다.');
  return result.data;
}

export async function previewHardDeleteStaff(academyId: string, staffId: string): Promise<StaffHardDeletePreview> {
  const result = await postLmsMutation<{ data?: StaffHardDeletePreview }>('/api/lms/staff/hard-delete-preview', { academyId, staffId }, { mutates: false });
  if (!result.data) throw new Error('완전삭제 가능 여부를 확인할 수 없습니다.');
  return result.data;
}

export async function hardDeleteStaff(academyId: string, staffId: string, confirmName: string): Promise<StaffMutationResult> {
  const result = await postLmsMutation<{ data?: StaffMutationResult }>('/api/lms/staff/hard-delete', { academyId, staffId, confirmName });
  if (!result.data) throw new Error('완전삭제 결과를 확인할 수 없습니다.');
  return result.data;
}

export async function createBook(academyId: string, input: CreateBookInput): Promise<void> {
  await postLmsMutation('/api/lms/books', { academyId, input });
}

export async function updateBook(academyId: string, bookId: string, input: UpdateBookInput): Promise<void> {
  await postLmsMutation('/api/lms/books', { academyId, bookId, input });
}

export async function loadAssignmentManagementData(academyId: string, options: LmsRequestOptions = {}): Promise<AssignmentManagementData> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<AssignmentManagementData>(`/api/lms/assignments?${params.toString()}`, { policy: 'operational', ...options });
}

export async function loadAssignmentDetail(
  academyId: string,
  assignmentId: string,
  options: LmsRequestOptions = {},
): Promise<LearningAssignmentDetail> {
  const params = new URLSearchParams({ academyId, assignmentId });
  return getLmsJson<LearningAssignmentDetail>(`/api/lms/assignments/detail?${params.toString()}`, { policy: 'operational', ...options });
}

export async function createLearningAssignment(
  academyId: string,
  input: CreateLearningAssignmentInput,
): Promise<void> {
  await postLmsMutation('/api/lms/assignments', { academyId, ...input });
}

export async function importWorksheetAssignment(
  academyId: string,
  input: CreateLearningAssignmentInput,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.set('academyId', academyId);
  form.set('title', input.title);
  form.set('description', input.description || '');
  form.set('dueAt', input.dueAt || '');
  form.set('context', input.context || 'homework');
  form.set('classIds', JSON.stringify(input.classIds || []));
  form.set('studentIds', JSON.stringify(input.studentIds || []));
  form.set('excludedStudentIds', JSON.stringify(input.excludedStudentIds || []));
  form.set('file', file);
  await postLmsForm('/api/lms/assignments/import', form);
}

export async function addAssignmentRecipients(
  academyId: string,
  assignmentId: string,
  studentIds: string[],
): Promise<void> {
  await postLmsMutation('/api/lms/assignments/recipients', { academyId, assignmentId, studentIds });
}

export async function removeAssignmentRecipient(
  academyId: string,
  assignmentId: string,
  studentId: string,
): Promise<void> {
  await postLmsMutation('/api/lms/assignments/recipients', { academyId, assignmentId, removeStudentId: studentId });
}

export async function recallAssignment(
  academyId: string,
  assignmentId: string,
): Promise<void> {
  await postLmsMutation('/api/lms/assignments/recall', { academyId, assignmentId });
}

export async function deleteAssignment(
  academyId: string,
  assignmentId: string,
): Promise<void> {
  await postLmsMutation('/api/lms/assignments/delete', { academyId, assignmentId });
}

export async function setClassBook(academyId: string, classId: string, bookId: string, active: boolean): Promise<void> {
  if (!classId || !bookId) throw new Error('반과 교재를 선택하세요.');
  await postLmsMutation('/api/lms/class-books', { academyId, classId, bookId, active });
}

export async function createClassroom(academyId: string, input: CreateClassroomInput): Promise<void> {
  await postLmsMutation('/api/lms/classrooms', { academyId, input });
}

export async function updateClassroom(academyId: string, classroomId: string, input: UpdateClassroomInput): Promise<void> {
  await postLmsMutation('/api/lms/classrooms', { academyId, classroomId, input });
}

export async function recordAttendance(academyId: string, input: RecordAttendanceInput): Promise<void> {
  await postLmsMutation('/api/lms/attendance', { academyId, input });
}

export async function recordAttendanceBatch(academyId: string, batch: BatchAttendanceInput): Promise<void> {
  await postLmsMutation('/api/lms/attendance', { academyId, batch });
}

export async function generateMonthlyInvoices(academyId: string, serviceMonth: string): Promise<void> {
  await postLmsMutation('/api/lms/billing/generate', { academyId, serviceMonth });
}

export async function recordPayment(academyId: string, input: RecordPaymentInput): Promise<void> {
  await postLmsMutation('/api/lms/payments', { academyId, input });
}

export async function createExpense(academyId: string, input: CreateExpenseInput): Promise<void> {
  await postLmsMutation('/api/lms/expenses', { academyId, input });
}

export async function createInstructorPayment(academyId: string, input: CreateInstructorPaymentInput): Promise<void> {
  await postLmsMutation('/api/lms/payroll', { academyId, input });
}

export async function loadAccountingOperationsOverview(
  academyId: string,
  serviceMonth: string,
  options: LmsRequestOptions = {},
): Promise<AccountingOperationsOverview> {
  const params = new URLSearchParams({ academyId, serviceMonth });
  return getLmsJson<AccountingOperationsOverview>(`/api/lms/accounting?${params.toString()}`, { policy: 'operational', ...options });
}

export async function updateTaxSettings(academyId: string, settings: Record<string, unknown>): Promise<void> {
  await postLmsMutation('/api/lms/admin/tax-settings', { academyId, settings });
}

export async function exportAdminCsv(
  academyId: string,
  type: AdminExportType,
  options: AdminExportOptions,
): Promise<AdminCsvExport> {
  return postLmsCsvExport('/api/lms/admin/export', { academyId, type, options });
}

export async function prepareAdminReset(
  academyId: string,
  target: AdminResetTarget,
  confirmText: string,
): Promise<{ confirmToken: string; expiresAt: string }> {
  const result = await postLmsMutation<{ confirmToken?: unknown; expiresAt?: unknown }>(
    '/api/lms/admin/reset/confirm',
    { academyId, target, confirmText },
    { mutates: false },
  );
  if (typeof result.confirmToken !== 'string' || typeof result.expiresAt !== 'string') {
    throw new Error('초기화 확인 토큰을 발급하지 못했습니다.');
  }
  return {
    confirmToken: result.confirmToken,
    expiresAt: result.expiresAt,
  };
}

export async function resetAdminData(
  academyId: string,
  target: AdminResetTarget,
  confirmToken: string,
): Promise<void> {
  await postLmsMutation('/api/lms/admin/reset', { academyId, target, confirmToken });
}
