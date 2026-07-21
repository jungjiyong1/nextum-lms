import 'server-only';

import type {
    WorksheetCart,
    WorksheetCartItem,
    WorksheetCartItemOverride,
    WorksheetCartProblem,
} from '@/features/lms/worksheet-types';
import { createAdminClient } from '@/lib/supabase/admin';
import { LmsAuthError, type LmsRoleContext } from './auth';
import type { ChallengeBand } from './learning-evidence';
import { toSeoulDate } from './seoul-date';
import {
    DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG,
    type WorksheetRecommendationConfig,
} from './worksheet-config';
import {
    buildSkillEvidenceSummaries,
    computeWorksheetCart,
    type ApprovedTagRow,
    type CartItemComputation,
    type EvidenceBaseRow,
} from './worksheet-cart-domain';
import type {
    ProblemHistoryRecord,
    SelectedProblem,
    WorksheetBandPlan,
} from './worksheet-selection';

type Row = Record<string, unknown>;

const PAGE_SIZE = 1000;
const FILTER_CHUNK_SIZE = 150;
const PROBLEM_IMAGES_BUCKET = 'problem-images';
const IMAGE_URL_TTL_SECONDS = 600;

type PagedResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

function ensureNoError(error: { message: string } | null, context: string): void {
    if (error) throw new Error(`${context}: ${error.message}`);
}

function chunks<T>(values: readonly T[], size = FILTER_CHUNK_SIZE): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

async function loadPagedRows(
    query: (from: number, to: number) => PagedResult,
    context: string,
): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await query(from, from + PAGE_SIZE - 1);
        ensureNoError(error, context);
        const page = (data ?? []) as Row[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
    }
}

async function loadRowsForChunks(
    values: readonly string[],
    query: (ids: string[], from: number, to: number) => PagedResult,
    context: string,
): Promise<Row[]> {
    if (values.length === 0) return [];
    const pages = await Promise.all(chunks(values).map((ids) =>
        loadPagedRows((from, to) => query(ids, from, to), context),
    ));
    return pages.flat();
}

function asChallengeBand(value: unknown): ChallengeBand | null {
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function expectedPartCount(answerKey: unknown): number {
    if (!answerKey || typeof answerKey !== 'object' || Array.isArray(answerKey)) return 1;
    const subs = (answerKey as Row).subs;
    return Array.isArray(subs) && subs.length > 0 ? subs.length : 1;
}

export interface WorksheetStudentRef {
    studentId: string;
    personId: string | null;
    studentName: string;
}

export async function assertStudentInAcademy(
    actor: LmsRoleContext,
    studentId: string,
): Promise<WorksheetStudentRef> {
    const admin = createAdminClient();
    const core = admin.schema('core');
    const { data, error } = await core
        .from('students')
        .select('id,academy_id,person_id,status')
        .eq('id', studentId)
        .maybeSingle();
    ensureNoError(error, '학생 정보를 불러오지 못했습니다');
    const row = data as Row | null;
    if (!row || row.academy_id !== actor.academyId || row.status === 'deleted') {
        throw new LmsAuthError('학생을 찾을 수 없습니다.', 403);
    }

    let studentName = '학생';
    if (typeof row.person_id === 'string') {
        const { data: person, error: personError } = await core
            .from('people')
            .select('full_name,display_name')
            .eq('id', row.person_id)
            .maybeSingle();
        ensureNoError(personError, '학생 이름을 불러오지 못했습니다');
        const personRow = person as Row | null;
        const name = personRow?.display_name ?? personRow?.full_name;
        if (typeof name === 'string' && name.trim()) studentName = name.trim();
    }

    return {
        studentId,
        personId: typeof row.person_id === 'string' ? row.person_id : null,
        studentName,
    };
}

export async function hasActiveProblemBankGrant(academyId: string): Promise<boolean> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .schema('content')
        .from('problem_bank_grants')
        .select('id')
        .eq('academy_id', academyId)
        .eq('status', 'active')
        .is('book_id', null)
        .limit(1)
        .maybeSingle();
    ensureNoError(error, '문제은행 사용 승인을 확인하지 못했습니다');
    return Boolean((data as Row | null)?.id);
}

/** lms.settings의 academy 범위 override를 기본값 위에 얹는다. */
export async function loadWorksheetConfig(
    academyId: string,
): Promise<WorksheetRecommendationConfig> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .schema('lms')
        .from('settings')
        .select('value')
        .eq('academy_id', academyId)
        .eq('key', 'worksheet_recommendation')
        .maybeSingle();
    ensureNoError(error, '학습지 설정을 불러오지 못했습니다');

    const config = { ...DEFAULT_WORKSHEET_RECOMMENDATION_CONFIG };
    const value = (data as Row | null)?.value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of Object.keys(config) as Array<keyof WorksheetRecommendationConfig>) {
            const override = (value as Row)[key];
            if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
                if (key === 'maxAutoChallengeBand') {
                    const band = asChallengeBand(override);
                    if (band !== null) config.maxAutoChallengeBand = band;
                } else {
                    config[key] = override;
                }
            }
        }
    }
    return config;
}

async function loadEvidenceRows(studentId: string): Promise<EvidenceBaseRow[]> {
    const admin = createAdminClient();
    const reporting = admin.schema('reporting');
    const rows = await loadPagedRows((from, to) => reporting
        .from('v_learning_evidence_base')
        .select('attempt_id,session_id,core_student_id,problem_id,sub_label,correct,unsure,response_state,evidence_kind,analysis_eligible,submitted_at,analysis_skill_id,challenge_band,equivalence_key')
        .eq('core_student_id', studentId)
        .order('attempt_id')
        .range(from, to), '학습 근거를 불러오지 못했습니다');

    return rows.flatMap((row): EvidenceBaseRow[] => {
        if (
            typeof row.session_id !== 'string' ||
            typeof row.problem_id !== 'string' ||
            typeof row.submitted_at !== 'string' ||
            typeof row.analysis_skill_id !== 'string'
        ) return [];
        const responseState = row.response_state;
        if (responseState !== 'answered' && responseState !== 'unknown' && responseState !== 'blank') {
            return [];
        }
        return [{
            sessionId: row.session_id,
            problemId: row.problem_id,
            subLabel: typeof row.sub_label === 'string' ? row.sub_label : null,
            correct: row.correct === true,
            unsure: row.unsure === true,
            responseState,
            evidenceKind: String(row.evidence_kind ?? 'legacy_ambiguous'),
            analysisEligible: row.analysis_eligible === true,
            observedOn: toSeoulDate(row.submitted_at),
            skillId: row.analysis_skill_id,
            challengeBand: asChallengeBand(row.challenge_band),
            equivalenceKey:
                typeof row.equivalence_key === 'string' && row.equivalence_key.trim()
                    ? row.equivalence_key
                    : null,
        }];
    });
}

export async function loadSkillNames(skillIds: string[]): Promise<Map<string, string>> {
    const admin = createAdminClient();
    const rows = await loadRowsForChunks(skillIds, (ids, from, to) => admin
        .schema('content')
        .from('analysis_skills')
        .select('id,name,unit_name')
        .in('id', ids)
        .order('id')
        .range(from, to), '유형 정보를 불러오지 못했습니다');
    const names = new Map<string, string>();
    for (const row of rows) {
        if (typeof row.id !== 'string') continue;
        const unit = typeof row.unit_name === 'string' && row.unit_name.trim() ? `${row.unit_name} · ` : '';
        const name = typeof row.name === 'string' && row.name.trim() ? row.name : row.id;
        names.set(row.id, `${unit}${name}`);
    }
    return names;
}

export async function loadApprovedTagsForSkills(skillIds: string[]): Promise<ApprovedTagRow[]> {
    const admin = createAdminClient();
    const rows = await loadRowsForChunks(skillIds, (ids, from, to) => admin
        .schema('content')
        .from('problem_analysis_tags')
        .select('problem_id,analysis_skill_id,challenge_band,equivalence_key')
        .eq('review_status', 'approved')
        .in('analysis_skill_id', ids)
        .order('analysis_skill_id')
        .order('problem_id')
        .range(from, to), '승인된 문제 태그를 불러오지 못했습니다');
    return rows.flatMap((row): ApprovedTagRow[] => {
        if (typeof row.problem_id !== 'string' || typeof row.analysis_skill_id !== 'string') return [];
        return [{
            problemId: row.problem_id,
            skillId: row.analysis_skill_id,
            challengeBand: asChallengeBand(row.challenge_band),
            equivalenceKey:
                typeof row.equivalence_key === 'string' && row.equivalence_key.trim()
                    ? row.equivalence_key
                    : null,
        }];
    });
}

async function loadExpectedParts(problemIds: string[]): Promise<Map<string, number>> {
    const admin = createAdminClient();
    const rows = await loadRowsForChunks(problemIds, (ids, from, to) => admin
        .schema('content')
        .from('problems')
        .select('id,answer_key')
        .in('id', ids)
        .order('id')
        .range(from, to), '문제 답안 구조를 불러오지 못했습니다');
    const parts = new Map<string, number>();
    for (const row of rows) {
        if (typeof row.id === 'string') parts.set(row.id, expectedPartCount(row.answer_key));
    }
    return parts;
}

/**
 * 기존 과제 경로 + PDF 매칭 경로 + (배포 후) 학습지 경로가 전부
 * learning.assignments로 물질화되므로, 배정 이력은 assignment_items 하나로
 * 통합 조회된다. 풀이 이력은 evidence rows에서 함께 합쳐진다.
 */
export async function loadAssignedProblemHistory(
    studentId: string,
): Promise<ProblemHistoryRecord[]> {
    const admin = createAdminClient();
    const core = admin.schema('core');
    const learning = admin.schema('learning');

    const classRows = await loadPagedRows((from, to) => core
        .from('class_students')
        .select('class_id')
        .eq('student_id', studentId)
        .order('class_id')
        .range(from, to), '반 배정 정보를 불러오지 못했습니다');
    const classIds = [...new Set(
        classRows.flatMap((row) => (typeof row.class_id === 'string' ? [row.class_id] : [])),
    )];

    const orFilters = [`student_id.eq.${studentId}`];
    if (classIds.length > 0) orFilters.push(`class_id.in.(${classIds.join(',')})`);
    const targetRows = await loadPagedRows((from, to) => learning
        .from('assignment_targets')
        .select('assignment_id')
        .or(orFilters.join(','))
        .order('id')
        .range(from, to), '과제 대상 정보를 불러오지 못했습니다');

    const recipientRows = await loadPagedRows((from, to) => learning
        .from('assignment_recipients')
        .select('assignment_id')
        .eq('student_id', studentId)
        .order('id')
        .range(from, to), '과제 수신 정보를 불러오지 못했습니다');

    const assignmentIds = [...new Set(
        [...targetRows, ...recipientRows].flatMap((row) =>
            typeof row.assignment_id === 'string' ? [row.assignment_id] : [],
        ),
    )];
    if (assignmentIds.length === 0) return [];

    const assignmentRows = await loadRowsForChunks(assignmentIds, (ids, from, to) => learning
        .from('assignments')
        .select('id,created_at')
        .in('id', ids)
        .order('id')
        .range(from, to), '과제 정보를 불러오지 못했습니다');
    const assignedOn = new Map<string, string>();
    for (const row of assignmentRows) {
        if (typeof row.id === 'string' && typeof row.created_at === 'string') {
            assignedOn.set(row.id, toSeoulDate(row.created_at));
        }
    }

    const itemRows = await loadRowsForChunks(assignmentIds, (ids, from, to) => learning
        .from('assignment_items')
        .select('assignment_id,problem_id')
        .in('assignment_id', ids)
        .order('id')
        .range(from, to), '과제 문항 정보를 불러오지 못했습니다');

    return itemRows.flatMap((row): ProblemHistoryRecord[] => {
        if (typeof row.assignment_id !== 'string' || typeof row.problem_id !== 'string') return [];
        const lastSeenOn = assignedOn.get(row.assignment_id);
        if (!lastSeenOn) return [];
        return [{ problemId: row.problem_id, lastSeenOn }];
    });
}

interface ProblemMeta {
    pagePrinted: number | null;
    number: string | null;
    bookTitle: string | null;
    imagePath: string | null;
    imageSha256: string | null;
    answerKey: unknown;
}

export async function loadProblemMeta(
    problemIds: string[],
): Promise<Map<string, ProblemMeta>> {
    const admin = createAdminClient();
    const content = admin.schema('content');

    const problemRows = await loadRowsForChunks(problemIds, (ids, from, to) => content
        .from('problems')
        .select('id,book_id,page_printed,number,answer_key')
        .in('id', ids)
        .order('id')
        .range(from, to), '문제 정보를 불러오지 못했습니다');

    const bookIds = [...new Set(
        problemRows.flatMap((row) => (typeof row.book_id === 'string' ? [row.book_id] : [])),
    )];
    const bookRows = await loadRowsForChunks(bookIds, (ids, from, to) => content
        .from('books')
        .select('id,title')
        .in('id', ids)
        .order('id')
        .range(from, to), '교재 정보를 불러오지 못했습니다');
    const bookTitles = new Map<string, string>();
    for (const row of bookRows) {
        if (typeof row.id === 'string' && typeof row.title === 'string') {
            bookTitles.set(row.id, row.title);
        }
    }

    const assetRows = await loadRowsForChunks(problemIds, (ids, from, to) => content
        .from('assets')
        .select('problem_id,storage_path,sha256,kind')
        .eq('kind', 'problem_image')
        .in('problem_id', ids)
        .order('id')
        .range(from, to), '문제 이미지 정보를 불러오지 못했습니다');
    const images = new Map<string, { path: string; sha256: string | null }>();
    for (const row of assetRows) {
        if (typeof row.problem_id !== 'string' || typeof row.storage_path !== 'string') continue;
        if (!images.has(row.problem_id)) {
            images.set(row.problem_id, {
                path: row.storage_path,
                sha256: typeof row.sha256 === 'string' ? row.sha256 : null,
            });
        }
    }

    const meta = new Map<string, ProblemMeta>();
    for (const row of problemRows) {
        if (typeof row.id !== 'string') continue;
        const image = images.get(row.id) ?? null;
        meta.set(row.id, {
            pagePrinted: Number.isFinite(Number(row.page_printed)) ? Number(row.page_printed) : null,
            number: row.number == null ? null : String(row.number),
            bookTitle:
                typeof row.book_id === 'string' ? (bookTitles.get(row.book_id) ?? null) : null,
            imagePath: image?.path ?? null,
            imageSha256: image?.sha256 ?? null,
            answerKey: row.answer_key ?? null,
        });
    }
    return meta;
}

async function signImageUrls(paths: string[]): Promise<Map<string, string>> {
    if (paths.length === 0) return new Map();
    const admin = createAdminClient();
    const urls = new Map<string, string>();
    for (const batch of chunks(paths, 50)) {
        const { data, error } = await admin.storage
            .from(PROBLEM_IMAGES_BUCKET)
            .createSignedUrls(batch, IMAGE_URL_TTL_SECONDS);
        ensureNoError(error, '문제 이미지 URL을 발급하지 못했습니다');
        for (const entry of data ?? []) {
            if (entry.signedUrl && entry.path) urls.set(entry.path, entry.signedUrl);
        }
    }
    return urls;
}

export interface LoadWorksheetCartParams {
    studentId: string;
    asOf?: string;
    seed?: string;
    includeImages?: boolean;
    overrides?: readonly WorksheetCartItemOverride[];
}

const CART_PURPOSES = new Set(['verification', 'practice', 'review']);
const MAX_OVERRIDE_ITEMS = 20;
const MAX_BAND_COUNT = 40;

/** 클라이언트가 보낸 난이도 재정의를 검증해 도메인 형태로 바꾼다. */
export function normalizeCartOverrides(
    overrides: readonly WorksheetCartItemOverride[] | undefined,
): Map<string, WorksheetBandPlan> {
    const map = new Map<string, WorksheetBandPlan>();
    if (!overrides) return map;
    if (overrides.length > MAX_OVERRIDE_ITEMS) {
        throw new Error('난이도 재정의 항목이 너무 많습니다.');
    }
    for (const override of overrides) {
        if (
            typeof override?.analysisSkillId !== 'string' ||
            !override.analysisSkillId.trim() ||
            !CART_PURPOSES.has(override.purpose)
        ) {
            throw new Error('난이도 재정의 형식이 올바르지 않습니다.');
        }
        const plan: WorksheetBandPlan = {};
        let total = 0;
        for (const [key, value] of Object.entries(override.bandPlan ?? {})) {
            const band = Number(key);
            if (band !== 1 && band !== 2 && band !== 3 && band !== 4) {
                throw new Error('난이도는 1~4만 지정할 수 있습니다.');
            }
            if (!Number.isInteger(value) || value < 0 || value > MAX_BAND_COUNT) {
                throw new Error('난이도별 문항 수가 올바르지 않습니다.');
            }
            if (value > 0) plan[band as 1 | 2 | 3 | 4] = value;
            total += value;
        }
        if (total === 0 || total > MAX_BAND_COUNT) {
            throw new Error('난이도 구성의 총 문항 수가 올바르지 않습니다.');
        }
        map.set(`${override.analysisSkillId}:${override.purpose}`, plan);
    }
    return map;
}

export interface LoadedWorksheetCart {
    cart: WorksheetCart;
    computedItems: CartItemComputation[];
    problemMeta: Map<string, ProblemMeta>;
    config: WorksheetRecommendationConfig;
}

export async function loadWorksheetCart(
    actor: LmsRoleContext,
    params: LoadWorksheetCartParams,
): Promise<LoadedWorksheetCart> {
    const student = await assertStudentInAcademy(actor, params.studentId);
    const asOf = params.asOf ?? toSeoulDate(new Date());
    const seed = params.seed?.trim() || crypto.randomUUID();
    const config = await loadWorksheetConfig(actor.academyId);

    const emptyCart = (granted: boolean): LoadedWorksheetCart => ({
        cart: {
            studentId: student.studentId,
            studentName: student.studentName,
            asOf,
            seed,
            problemBankGranted: granted,
            items: [],
            excluded: [],
            config: {
                maxAutoSkills: config.maxAutoSkills,
                minAutoTotalItems: config.minAutoTotalItems,
                maxAutoTotalItems: config.maxAutoTotalItems,
                manualMaxTotalItems: config.manualMaxTotalItems,
            },
        },
        computedItems: [],
        problemMeta: new Map(),
        config,
    });

    const granted = await hasActiveProblemBankGrant(actor.academyId);
    if (!granted) return emptyCart(false);

    const evidenceRows = await loadEvidenceRows(student.studentId);
    if (evidenceRows.length === 0) return emptyCart(true);

    const skillIds = [...new Set(evidenceRows.map((row) => row.skillId))];
    const attemptedProblemIds = [...new Set(evidenceRows.map((row) => row.problemId))];
    const [skillNames, approvedTags, expectedParts, assignedHistory] = await Promise.all([
        loadSkillNames(skillIds),
        loadApprovedTagsForSkills(skillIds),
        loadExpectedParts(attemptedProblemIds),
        loadAssignedProblemHistory(student.studentId),
    ]);

    const attemptHistory: ProblemHistoryRecord[] = evidenceRows.map((row) => ({
        problemId: row.problemId,
        lastSeenOn: row.observedOn,
    }));

    const summaries = buildSkillEvidenceSummaries({
        rows: evidenceRows,
        skillNames,
        approvedTags,
        expectedParts,
        asOf,
    });
    const computed = computeWorksheetCart({
        summaries,
        approvedTags,
        history: [...attemptHistory, ...assignedHistory],
        asOf,
        seed,
        config,
        bandPlanOverrides: normalizeCartOverrides(params.overrides),
    });

    const cartProblemIds = [...new Set(
        computed.items.flatMap((item) => [
            ...item.selected.map((problem) => problem.problemId),
            ...item.alternates.map((problem) => problem.problemId),
        ]),
    )];
    const problemMeta = await loadProblemMeta(cartProblemIds);
    const imagePaths = [...new Set(
        cartProblemIds.flatMap((problemId) => {
            const path = problemMeta.get(problemId)?.imagePath;
            return path ? [path] : [];
        }),
    )];
    const imageUrls = params.includeImages === false
        ? new Map<string, string>()
        : await signImageUrls(imagePaths);

    const toCartProblem = (problem: SelectedProblem): WorksheetCartProblem => {
        const meta = problemMeta.get(problem.problemId);
        const path = meta?.imagePath ?? null;
        return {
            problemId: problem.problemId,
            challengeBand: problem.challengeBand,
            pagePrinted: meta?.pagePrinted ?? null,
            number: meta?.number ?? null,
            bookTitle: meta?.bookTitle ?? null,
            imageUrl: path ? (imageUrls.get(path) ?? null) : null,
        };
    };

    const items: WorksheetCartItem[] = computed.items.map((item) => ({
        analysisSkillId: item.analysisSkillId,
        skillName: item.skillName,
        purpose: item.purpose,
        state: item.state,
        eligibleAfter: item.eligibleAfter,
        daysUntilEligible: item.daysUntilEligible,
        daysSinceEligible: item.daysSinceEligible,
        suggestedChallengeBand: item.suggestedChallengeBand,
        suggestedItemCount: item.suggestedItemCount,
        basisSummary: item.basisSummary,
        verificationBlocked: item.verificationBlocked,
        problems: item.selected.map(toCartProblem),
        alternates: item.alternates.map(toCartProblem),
        warnings: item.warnings.map((warning) => ({ code: warning.code, detail: warning.detail })),
        bandAvailability: item.bandAvailability,
    }));

    return {
        cart: {
            studentId: student.studentId,
            studentName: student.studentName,
            asOf,
            seed,
            problemBankGranted: true,
            items,
            excluded: computed.excluded.map((entry) => ({
                analysisSkillId: entry.analysisSkillId,
                skillName: entry.skillName,
                reason: entry.reason,
            })),
            config: {
                maxAutoSkills: config.maxAutoSkills,
                minAutoTotalItems: config.minAutoTotalItems,
                maxAutoTotalItems: config.maxAutoTotalItems,
                manualMaxTotalItems: config.manualMaxTotalItems,
            },
        },
        computedItems: computed.items,
        problemMeta,
        config,
    };
}
