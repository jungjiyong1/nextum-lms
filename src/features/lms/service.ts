import { csrfHeaders, jsonCsrfHeaders } from '@/lib/lms/csrf-client';
import { supabase } from '@/core/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  AccountingOperationsOverview,
  AssignmentManagementData,
  AdminCsvExport,
  AdminExportOptions,
  AdminExportType,
  AdminResetTarget,
  ClassOperationsDetail,
  ClassOperationsOverview,
  CreateBookInput,
  CreateClassInput,
  CreateClassroomInput,
  CreateExpenseInput,
  CreateInstructorPaymentInput,
  CreateLearningAssignmentInput,
  CreateStudentResult,
  CreateScheduleRuleInput,
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
  StaffSummary,
  StudentAiConversationRow,
  StudentDetail,
  StudentDetailSection,
  StudentHardDeletePreview,
  StudentLearningMetric,
  StudentLearningPeriod,
  StudentMutationResult,
  StudentOperationsOverview,
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
}

export interface StudentDetailRequestOptions extends LmsRequestOptions {
  period?: StudentLearningPeriod;
  assignmentId?: string | null;
}

export interface LmsInvalidationPayload {
  academyId?: string | null;
  domain?: string;
  entity?: string;
  id?: string | null;
  studentId?: string | null;
  classId?: string | null;
  changedAt?: string;
  operation?: string;
  sourceId?: string;
}

interface LmsCacheInvalidationScope {
  academyId?: string | null;
  pathPrefix?: string;
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
const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const getCache = new Map<string, { expiresAt: number; promise: Promise<unknown>; policy: LmsCachePolicy }>();
const invalidationListeners = new Set<(payload: LmsInvalidationPayload) => void>();
const realtimeChannels = new Map<string, { channel: RealtimeChannel; refCount: number }>();
let localCacheChannel: BroadcastChannel | null = null;
let localInvalidationBridgeReady = false;

function normalizeInvalidationPayload(value: unknown): LmsInvalidationPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  return {
    academyId: typeof payload.academyId === 'string' ? payload.academyId : null,
    domain: typeof payload.domain === 'string' ? payload.domain : undefined,
    entity: typeof payload.entity === 'string' ? payload.entity : undefined,
    id: typeof payload.id === 'string' ? payload.id : null,
    studentId: typeof payload.studentId === 'string' ? payload.studentId : null,
    classId: typeof payload.classId === 'string' ? payload.classId : null,
    changedAt: typeof payload.changedAt === 'string' ? payload.changedAt : new Date().toISOString(),
    operation: typeof payload.operation === 'string' ? payload.operation : undefined,
    sourceId: typeof payload.sourceId === 'string' ? payload.sourceId : undefined,
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
  if (!scope?.academyId) return true;
  const cacheAcademyId = academyIdFromPath(path);
  return !cacheAcademyId || cacheAcademyId === scope.academyId;
}

export function clearLmsGetCache(scope?: LmsCacheInvalidationScope) {
  if (!scope) {
    getCache.clear();
    return;
  }
  for (const key of [...getCache.keys()]) {
    if (shouldClearCacheKey(key, scope)) getCache.delete(key);
  }
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

function applyReceivedInvalidation(payload: LmsInvalidationPayload) {
  clearLmsGetCache({ academyId: payload.academyId ?? null });
  emitInvalidation(payload);
}

function ensureLocalInvalidationBridge() {
  if (localInvalidationBridgeReady || typeof window === 'undefined') return;
  localInvalidationBridgeReady = true;

  if ('BroadcastChannel' in window) {
    localCacheChannel = new BroadcastChannel(LMS_LOCAL_CACHE_CHANNEL);
    localCacheChannel.onmessage = (event: MessageEvent<unknown>) => {
      const payload = normalizeInvalidationPayload(event.data);
      if (!payload || payload.sourceId === instanceId) return;
      applyReceivedInvalidation(payload);
    };
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== LMS_STORAGE_EVENT_KEY || !event.newValue) return;
    try {
      const payload = normalizeInvalidationPayload(JSON.parse(event.newValue));
      if (!payload || payload.sourceId === instanceId) return;
      applyReceivedInvalidation(payload);
    } catch {
      // Ignore malformed invalidation signals from older tabs.
    }
  });
}

function publishLocalInvalidation(payload: LmsInvalidationPayload) {
  if (typeof window === 'undefined') return;
  ensureLocalInvalidationBridge();
  const nextPayload = { ...payload, sourceId: instanceId };
  localCacheChannel?.postMessage(nextPayload);
  try {
    window.localStorage.setItem(LMS_STORAGE_EVENT_KEY, JSON.stringify(nextPayload));
    window.localStorage.removeItem(LMS_STORAGE_EVENT_KEY);
  } catch {
    // Storage can be blocked; BroadcastChannel is the primary path.
  }
}

function publishRemoteInvalidation(payload: LmsInvalidationPayload) {
  const academyId = payload.academyId;
  if (!academyId) return;
  const entry = realtimeChannels.get(academyId);
  if (!entry) return;
  const nextPayload = { ...payload, sourceId: instanceId };
  void Promise.resolve(entry.channel.send({
    type: 'broadcast',
    event: LMS_REALTIME_EVENT,
    payload: nextPayload,
  })).catch((err) => {
    console.warn('[LMS] Failed to broadcast cache invalidation:', err);
  });
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
  return {
    academyId: typeof payload.academyId === 'string' ? payload.academyId : null,
    domain: mutationDomainFromPath(path),
    entity: path,
    id: idFromMutationPayload(payload),
    studentId: typeof payload.studentId === 'string' ? payload.studentId : null,
    classId: typeof payload.classId === 'string' ? payload.classId : null,
    changedAt: new Date().toISOString(),
    operation: 'mutation',
  };
}

function invalidateAfterMutation(path: string, payload: Record<string, unknown>) {
  const invalidation = invalidationFromMutation(path, payload);
  clearLmsGetCache({ academyId: invalidation.academyId ?? null });
  publishLocalInvalidation(invalidation);
  publishRemoteInvalidation(invalidation);
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

  channel.on('broadcast', { event: LMS_REALTIME_EVENT }, (message: { payload: unknown }) => {
    const payload = normalizeInvalidationPayload(message.payload);
    if (!payload || payload.sourceId === instanceId) return;
    applyReceivedInvalidation(payload);
  });

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
  const result = await response.json().catch(() => null) as { success?: boolean; error?: string } & Record<string, unknown> | null;
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || '요청 처리에 실패했습니다.');
  }
  if (options.mutates !== false) invalidateAfterMutation(path, payload);
  return result as T;
}

async function getLmsJson<T>(path: string, options: LmsRequestOptions = {}): Promise<T> {
  const policy = options.policy ?? 'operational';
  const ttl = CACHE_TTL_MS[policy];
  if (options.force || ttl <= 0) {
    return fetchLmsJson<T>(path);
  }

  const now = Date.now();
  const cached = getCache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.promise as Promise<T>;
  }

  const promise = fetchLmsJson<T>(path);
  getCache.set(path, { expiresAt: now + ttl, promise, policy });
  promise.catch(() => {
    if (getCache.get(path)?.promise === promise) getCache.delete(path);
  });
  return promise;
}

async function fetchLmsJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const result = await response.json().catch(() => null) as { success?: boolean; error?: string; data?: T } | null;
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || '요청 처리에 실패했습니다.');
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
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error || 'CSV 내보내기에 실패했습니다.');
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
  const result = await response.json().catch(() => null) as { success?: boolean; error?: string } & Record<string, unknown> | null;
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || '요청 처리에 실패했습니다.');
  }
  invalidateAfterMutation(path, { academyId: String(form.get('academyId') || '') });
  return result as T;
}

export async function getAcademyName(academyId: string, options: LmsRequestOptions = {}): Promise<string | null> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<string | null>(`/api/lms/academy?${params.toString()}`, { policy: 'static', ...options });
}

export async function getDashboardData(academyId: string, serviceMonth: string, options: LmsRequestOptions = {}): Promise<DashboardData> {
  const params = new URLSearchParams({ academyId, serviceMonth });
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
  options: LmsRequestOptions = {},
): Promise<ClassOperationsOverview> {
  const params = new URLSearchParams({ academyId, startDate, endDate });
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

export async function createScheduleRule(academyId: string, input: CreateScheduleRuleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedule-rules', { academyId, input });
}

export async function updateScheduleRule(academyId: string, ruleId: string, input: UpdateScheduleRuleInput): Promise<void> {
  await postLmsMutation('/api/lms/schedule-rules', { academyId, ruleId, input });
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

export async function loadStudentOperationsOverview(academyId: string, options: LmsRequestOptions = {}): Promise<StudentOperationsOverview> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<StudentOperationsOverview>(`/api/lms/students?${params.toString()}`, { policy: 'operational', ...options });
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

export async function loadStaffOperationsOverview(academyId: string, options: LmsRequestOptions = {}): Promise<StaffOperationsOverview> {
  const params = new URLSearchParams({ academyId });
  return getLmsJson<StaffOperationsOverview>(`/api/lms/staff/overview?${params.toString()}`, { policy: 'operational', ...options });
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
