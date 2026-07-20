import 'server-only';

import type {
    CreateWorksheetDraftInput,
    ProblemBankGrantOverview,
    WorksheetDraftCreated,
    WorksheetPublishResult,
} from '@/features/lms/worksheet-types';
import { toSeoulDate } from './seoul-date';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { resolveInclusionRole } from './worksheet-eligibility';
import { loadWorksheetCart } from './worksheet-queries';

type Row = Record<string, unknown>;

function ensureNoError(error: { message: string } | null, context: string): void {
    if (error) throw new Error(`${context}: ${error.message}`);
}

export class WorksheetInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorksheetInputError';
    }
}

export interface SuperAdminContext {
    userId: string;
    accountId: string;
    personId: string | null;
}

/** 문제은행 승인은 최고 관리자 전용이다. metadata는 서버에서만 읽는다. */
export async function assertSuperAdmin(): Promise<SuperAdminContext> {
    const serverClient = await createServerClient();
    const { data, error } = await serverClient.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    const userId = typeof claims?.sub === 'string' ? claims.sub : null;
    if (error || !userId) throw new LmsAuthError('Authentication is required.', 401);

    const admin = createAdminClient();
    const { data: account, error: accountError } = await admin
        .schema('core')
        .from('user_accounts')
        .select('id,person_id,status,metadata')
        .eq('auth_user_id', userId)
        .maybeSingle();
    if (accountError) throw accountError;
    const row = account as Row | null;
    if (!row || row.status !== 'active') {
        throw new LmsAuthError('Active LMS account is required.', 403);
    }
    if ((row.metadata as Row | null)?.super_admin !== true) {
        throw new LmsAuthError('최고 관리자 권한이 필요합니다.', 403);
    }
    return {
        userId,
        accountId: String(row.id),
        personId: typeof row.person_id === 'string' ? row.person_id : null,
    };
}

export async function loadProblemBankGrantOverview(): Promise<ProblemBankGrantOverview> {
    const admin = createAdminClient();
    const [grantResult, academyResult] = await Promise.all([
        admin
            .schema('content')
            .from('problem_bank_grants')
            .select('id,academy_id,status,note,granted_at,revoked_at')
            .is('book_id', null)
            .order('granted_at', { ascending: false }),
        admin
            .schema('core')
            .from('academies')
            .select('id,name')
            .eq('status', 'active')
            .order('name'),
    ]);
    ensureNoError(grantResult.error, '문제은행 승인 목록을 불러오지 못했습니다');
    ensureNoError(academyResult.error, '학원 목록을 불러오지 못했습니다');

    const academies = (academyResult.data ?? []) as Row[];
    const academyNames = new Map<string, string>();
    for (const academy of academies) {
        if (typeof academy.id === 'string' && typeof academy.name === 'string') {
            academyNames.set(academy.id, academy.name);
        }
    }

    const grants = ((grantResult.data ?? []) as Row[]).flatMap((row) => {
        if (typeof row.id !== 'string' || typeof row.academy_id !== 'string') return [];
        const status = row.status === 'active' ? 'active' as const : 'revoked' as const;
        return [{
            id: row.id,
            academyId: row.academy_id,
            academyName: academyNames.get(row.academy_id) ?? row.academy_id,
            status,
            note: typeof row.note === 'string' ? row.note : null,
            grantedAt: String(row.granted_at ?? ''),
            revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
        }];
    });

    const activeGrantAcademyIds = new Set(
        grants.filter((grant) => grant.status === 'active').map((grant) => grant.academyId),
    );
    return {
        grants,
        academies: [...academyNames.entries()].map(([academyId, academyName]) => ({
            academyId,
            academyName,
            granted: activeGrantAcademyIds.has(academyId),
        })),
    };
}

export interface SetProblemBankGrantInput {
    academyId: string;
    action: 'grant' | 'revoke';
    note?: string;
}

export async function setProblemBankGrant(
    actor: SuperAdminContext,
    input: SetProblemBankGrantInput,
): Promise<{ academyId: string; status: 'active' | 'revoked' }> {
    if (!input.academyId.trim()) throw new WorksheetInputError('학원을 선택하세요.');
    const admin = createAdminClient();
    const content = admin.schema('content');

    const { data: existing, error: readError } = await content
        .from('problem_bank_grants')
        .select('id,status')
        .eq('academy_id', input.academyId)
        .is('book_id', null)
        .maybeSingle();
    ensureNoError(readError, '기존 승인을 확인하지 못했습니다');
    const existingRow = existing as Row | null;

    if (input.action === 'grant') {
        if (existingRow?.id) {
            const { error } = await content
                .from('problem_bank_grants')
                .update({
                    status: 'active',
                    revoked_at: null,
                    granted_by: actor.personId,
                    granted_at: new Date().toISOString(),
                    note: input.note?.trim() || null,
                })
                .eq('id', existingRow.id);
            ensureNoError(error, '문제은행 승인을 갱신하지 못했습니다');
        } else {
            const { error } = await content
                .from('problem_bank_grants')
                .insert({
                    academy_id: input.academyId,
                    granted_by: actor.personId,
                    note: input.note?.trim() || null,
                });
            ensureNoError(error, '문제은행 승인을 저장하지 못했습니다');
        }
        return { academyId: input.academyId, status: 'active' };
    }

    if (!existingRow?.id) throw new WorksheetInputError('회수할 승인이 없습니다.');
    const { error } = await content
        .from('problem_bank_grants')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', existingRow.id);
    ensureNoError(error, '문제은행 승인을 회수하지 못했습니다');
    return { academyId: input.academyId, status: 'revoked' };
}

/**
 * 배포는 되돌릴 수 없는 1회 트랜잭션이다. RPC가 초안·학생·산출물 상태를
 * 재검증하고 variant를 기존 학생 단일 target 과제로 물질화한다. Grade App은
 * 새 계약 없이 기존 과제 경로로 이 학습지를 소비한다.
 */
export async function publishWorksheetDraft(
    actor: LmsRoleContext,
    input: { draftId: string; title?: string },
): Promise<WorksheetPublishResult> {
    if (!input.draftId.trim()) throw new WorksheetInputError('학습지 초안을 찾을 수 없습니다.');
    const admin = createAdminClient();
    const learning = admin.schema('learning');

    const { data: draft, error: draftError } = await learning
        .from('worksheet_drafts')
        .select('id,academy_id')
        .eq('id', input.draftId)
        .maybeSingle();
    ensureNoError(draftError, '학습지 초안을 확인하지 못했습니다');
    if (!(draft as Row | null)?.id || (draft as Row).academy_id !== actor.academyId) {
        throw new LmsAuthError('학습지 초안을 찾을 수 없습니다.', 403);
    }

    const title = input.title?.trim() || `맞춤 학습지 ${toSeoulDate(new Date())}`;
    const { data, error } = await learning.rpc('publish_worksheet_v1', {
        p_draft_id: input.draftId,
        p_actor_person_id: actor.personId,
        p_title: title,
    });
    if (error) {
        if (error.code === '22023') throw new WorksheetInputError(error.message);
        throw new Error(`학습지 배포에 실패했습니다: ${error.message}`);
    }

    const result = data as Row | null;
    const published = Array.isArray(result?.published) ? result.published : [];
    return {
        draftId: input.draftId,
        published: published.flatMap((entry) => {
            const row = entry as Row;
            if (typeof row.assignment_id !== 'string' || typeof row.variant_id !== 'string') return [];
            return [{
                variantId: row.variant_id,
                assignmentId: row.assignment_id,
                versionCode: typeof row.version_code === 'string' ? row.version_code : '',
            }];
        }),
    };
}

const VERSION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateVersionCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = 'WS-';
    for (const byte of bytes) {
        code += VERSION_CODE_ALPHABET[byte % VERSION_CODE_ALPHABET.length];
    }
    return code;
}

/**
 * Creates a draft + single-student variant + items from a cart submission.
 * The server re-derives the cart with the submitted seed and only accepts
 * problems from that deterministic pool, and it re-computes every item's
 * role/evidence flag itself — the client's view of eligibility is never
 * trusted for evidence semantics.
 */
export async function createWorksheetDraft(
    actor: LmsRoleContext,
    input: CreateWorksheetDraftInput,
): Promise<WorksheetDraftCreated> {
    if (!input.studentId.trim()) throw new WorksheetInputError('학생을 선택하세요.');
    if (!input.seed.trim()) throw new WorksheetInputError('장바구니 정보가 유효하지 않습니다.');
    if (!Array.isArray(input.selections) || input.selections.length === 0) {
        throw new WorksheetInputError('학습지에 담을 항목을 선택하세요.');
    }

    const loaded = await loadWorksheetCart(actor, {
        studentId: input.studentId,
        asOf: input.asOf,
        seed: input.seed,
        includeImages: false,
    });
    if (!loaded.cart.problemBankGranted) {
        throw new LmsAuthError('이 학원은 문제은행 사용 승인이 없습니다.', 403);
    }

    const itemsByKey = new Map(
        loaded.computedItems.map((item) => [`${item.analysisSkillId}:${item.purpose}`, item]),
    );

    interface PlannedItem {
        problemId: string;
        challengeBand: number;
        analysisSkillId: string;
        role: string;
        evidenceEligible: boolean;
        forceIncluded: boolean;
    }
    const planned: PlannedItem[] = [];
    const seenProblemIds = new Set<string>();
    interface LogEntry {
        problemId: string | null;
        skillId: string | null;
        event: string;
        role: string | null;
        reasonCode: string | null;
        reasonText: string | null;
    }
    const logs: LogEntry[] = [];

    for (const selection of input.selections) {
        const key = `${selection.analysisSkillId}:${selection.purpose}`;
        const item = itemsByKey.get(key);
        if (!item) {
            throw new WorksheetInputError('추천 목록에 없는 항목이 포함되어 있습니다.');
        }
        if (item.verificationBlocked) {
            throw new WorksheetInputError(
                `${item.skillName}은(는) 미풀이 문항이 부족해 확인 항목으로 담을 수 없습니다.`,
            );
        }
        if (!Array.isArray(selection.problemIds) || selection.problemIds.length === 0) {
            throw new WorksheetInputError('문항이 비어 있는 항목이 있습니다.');
        }

        const pool = new Map(
            [...item.selected, ...item.alternates].map((problem) => [problem.problemId, problem]),
        );
        const resolved = resolveInclusionRole(item.purpose, item.state);

        for (const problemId of selection.problemIds) {
            const problem = pool.get(problemId);
            if (!problem) {
                throw new WorksheetInputError('추천 범위 밖의 문제가 포함되어 있습니다.');
            }
            if (seenProblemIds.has(problemId)) {
                throw new WorksheetInputError('같은 문제가 학습지에 두 번 담겼습니다.');
            }
            seenProblemIds.add(problemId);
            planned.push({
                problemId,
                challengeBand: problem.challengeBand,
                analysisSkillId: item.analysisSkillId,
                role: resolved.role,
                evidenceEligible: resolved.evidenceEligible,
                forceIncluded: item.state === 'locked',
            });
        }

        for (const problem of item.selected) {
            logs.push({
                problemId: problem.problemId,
                skillId: item.analysisSkillId,
                event: 'proposed',
                role: item.purpose,
                reasonCode: null,
                reasonText: null,
            });
            if (selection.problemIds.includes(problem.problemId)) {
                logs.push({
                    problemId: problem.problemId,
                    skillId: item.analysisSkillId,
                    event: 'kept',
                    role: item.purpose,
                    reasonCode: null,
                    reasonText: null,
                });
            }
        }
        for (const change of selection.changeLog ?? []) {
            if (change.event !== 'replaced' && change.event !== 'removed') continue;
            logs.push({
                problemId: change.problemId,
                skillId: item.analysisSkillId,
                event: change.event,
                role: item.purpose,
                reasonCode: change.reasonCode?.trim() || null,
                reasonText: change.reasonText?.trim().slice(0, 500) || null,
            });
        }
        if (item.state === 'locked') {
            logs.push({
                problemId: null,
                skillId: item.analysisSkillId,
                event: 'force_included',
                role: resolved.role,
                reasonCode: 'locked_override',
                reasonText: null,
            });
        }
    }

    if (planned.length > loaded.config.manualMaxTotalItems) {
        throw new WorksheetInputError(
            `학습지 한 장은 최대 ${loaded.config.manualMaxTotalItems}문항까지 담을 수 있습니다.`,
        );
    }

    const admin = createAdminClient();
    const learning = admin.schema('learning');

    const { data: draftRow, error: draftError } = await learning
        .from('worksheet_drafts')
        .insert({
            academy_id: actor.academyId,
            created_by: actor.personId,
            status: 'draft',
            selection_seed: input.seed,
            settings_snapshot: { config: loaded.config },
            eligibility_snapshot: {
                asOf: loaded.cart.asOf,
                items: loaded.computedItems.map((item) => ({
                    analysisSkillId: item.analysisSkillId,
                    purpose: item.purpose,
                    state: item.state,
                    eligibleAfter: item.eligibleAfter,
                    verificationBlocked: item.verificationBlocked,
                })),
                excluded: loaded.cart.excluded,
            },
            cart_opened_at: new Date().toISOString(),
        })
        .select('id')
        .single();
    ensureNoError(draftError, '학습지 초안을 만들지 못했습니다');
    const draftId = String((draftRow as Row).id);

    try {
        let variantId: string | null = null;
        let versionCode = '';
        for (let attempt = 0; attempt < 3 && variantId === null; attempt += 1) {
            versionCode = generateVersionCode();
            const { data: variantRow, error: variantError } = await learning
                .from('worksheet_variants')
                .insert({
                    draft_id: draftId,
                    academy_id: actor.academyId,
                    student_id: input.studentId,
                    version_code: versionCode,
                })
                .select('id')
                .single();
            if (variantError) {
                if (variantError.code === '23505' && attempt < 2) continue;
                throw new Error(`학생 학습지를 만들지 못했습니다: ${variantError.message}`);
            }
            variantId = String((variantRow as Row).id);
        }
        if (variantId === null) throw new Error('학습지 버전 코드를 생성하지 못했습니다.');

        const itemRows = planned.map((item, index) => {
            const meta = loaded.problemMeta.get(item.problemId);
            return {
                variant_id: variantId,
                academy_id: actor.academyId,
                seq: index + 1,
                problem_id: item.problemId,
                analysis_skill_id: item.analysisSkillId,
                challenge_band_snapshot: item.challengeBand,
                answer_snapshot: meta?.answerKey ?? null,
                image_sha256: meta?.imageSha256 ?? null,
                role: item.role,
                evidence_eligible: item.evidenceEligible,
                similarity_group_id: item.problemId,
            };
        });
        const { error: itemError } = await learning.from('worksheet_items').insert(itemRows);
        ensureNoError(itemError, '학습지 문항을 저장하지 못했습니다');

        if (logs.length > 0) {
            const { error: logError } = await learning
                .from('worksheet_recommendation_logs')
                .insert(logs.map((log) => ({
                    academy_id: actor.academyId,
                    draft_id: draftId,
                    variant_id: variantId,
                    student_id: input.studentId,
                    analysis_skill_id: log.skillId,
                    problem_id: log.problemId,
                    event: log.event,
                    role: log.role,
                    reason_code: log.reasonCode,
                    reason_text: log.reasonText,
                })));
            ensureNoError(logError, '추천 기록을 저장하지 못했습니다');
        }

        return {
            draftId,
            variantId,
            versionCode,
            itemCount: planned.length,
        };
    } catch (error) {
        // 초안 생성은 트랜잭션이 아니므로 부분 상태를 남기지 않도록 정리한다.
        await learning.from('worksheet_drafts').delete().eq('id', draftId);
        throw error;
    }
}
