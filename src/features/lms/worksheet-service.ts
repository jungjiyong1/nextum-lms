// 학습지 화면 전용 API 계층. 공용 service.ts에 두면 모든 화면의 공유 청크가
// 커지므로 (로그인 번들 예산 압박) 학습지 라우트에서만 로드되게 분리한다.
import { getLmsJson, postLmsMutation, type LmsRequestOptions } from './service';
import type {
  CreateWorksheetDraftInput,
  ProblemBankGrantOverview,
  WorksheetCart,
  WorksheetCartItemOverride,
  WorksheetDraftCreated,
  WorksheetPublishResult,
  WorksheetRenderResult,
} from './worksheet-types';

export async function loadWorksheetCart(
  academyId: string,
  studentId: string,
  options: LmsRequestOptions & {
    asOf?: string;
    seed?: string;
    overrides?: WorksheetCartItemOverride[];
  } = {},
): Promise<WorksheetCart> {
  const params = new URLSearchParams({ academyId, studentId });
  if (options.asOf) params.set('asOf', options.asOf);
  if (options.seed) params.set('seed', options.seed);
  if (options.overrides && options.overrides.length > 0) {
    params.set('overrides', JSON.stringify(options.overrides));
  }
  return getLmsJson<WorksheetCart>(`/api/lms/worksheets/cart?${params.toString()}`, { policy: 'live', ...options });
}

export async function createWorksheetDraft(
  academyId: string,
  input: Omit<CreateWorksheetDraftInput, 'academyId'>,
): Promise<WorksheetDraftCreated> {
  return postLmsMutation<WorksheetDraftCreated>('/api/lms/worksheets/drafts', { academyId, ...input });
}

export async function renderWorksheetDraft(
  academyId: string,
  draftId: string,
): Promise<WorksheetRenderResult> {
  return postLmsMutation<WorksheetRenderResult>('/api/lms/worksheets/render', { academyId, draftId });
}

export async function publishWorksheetDraft(
  academyId: string,
  draftId: string,
): Promise<WorksheetPublishResult> {
  return postLmsMutation<WorksheetPublishResult>('/api/lms/worksheets/publish', { academyId, draftId });
}

export async function loadProblemBankGrants(): Promise<ProblemBankGrantOverview> {
  return getLmsJson<ProblemBankGrantOverview>('/api/lms/admin/problem-bank-grants', { policy: 'live' });
}

export async function setProblemBankGrant(
  input: { academyId: string; action: 'grant' | 'revoke'; note?: string },
): Promise<{ academyId: string; status: 'active' | 'revoked' }> {
  return postLmsMutation<{ academyId: string; status: 'active' | 'revoked' }>(
    '/api/lms/admin/problem-bank-grants',
    input,
  );
}
