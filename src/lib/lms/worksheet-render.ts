import 'server-only';

import { createHash } from 'node:crypto';

import type { WorksheetRenderArtifact, WorksheetRenderResult } from '@/features/lms/worksheet-types';
import { createAdminClient } from '@/lib/supabase/admin';
import { LmsAuthError, type LmsRoleContext } from './auth';
import { loadWorksheetFonts } from './render/worksheet-fonts';
import { normalizeProblemImage } from './render/worksheet-images';
import { layoutWorksheet, type LayoutItemInput } from './render/worksheet-layout';
import {
    composeAnswerKeyPdf,
    composeStudentPdf,
    formatAnswerText,
    type AnswerKeyEntry,
} from './render/worksheet-pdf';
import { toSeoulDate } from './seoul-date';
import { WorksheetInputError } from './worksheet-mutations';
import { loadProblemMeta, loadSkillNames } from './worksheet-queries';

type Row = Record<string, unknown>;

const WORKSHEET_ARTIFACTS_BUCKET = 'worksheet-artifacts';
const PROBLEM_IMAGES_BUCKET = 'problem-images';
const SIGNED_URL_TTL_SECONDS = 600;
const RENDER_ENGINE_VERSION = 4;

function ensureNoError(error: { message: string } | null, context: string): void {
    if (error) throw new Error(`${context}: ${error.message}`);
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

interface DraftRow {
    id: string;
    academyId: string;
    status: string;
    renderRevision: number;
}

interface VariantRow {
    id: string;
    studentId: string;
    versionCode: string;
}

interface ItemRow {
    seq: number;
    problemId: string;
    role: string;
    challengeBand: number | null;
    analysisSkillId: string | null;
    answerSnapshot: unknown;
}

async function loadDraftForRender(actor: LmsRoleContext, draftId: string): Promise<{
    draft: DraftRow;
    variants: Array<VariantRow & { items: ItemRow[] }>;
}> {
    const admin = createAdminClient();
    const learning = admin.schema('learning');

    const { data: draftData, error: draftError } = await learning
        .from('worksheet_drafts')
        .select('id,academy_id,status,render_revision')
        .eq('id', draftId)
        .maybeSingle();
    ensureNoError(draftError, '학습지 초안을 불러오지 못했습니다');
    const draftRow = draftData as Row | null;
    if (!draftRow || draftRow.academy_id !== actor.academyId) {
        throw new LmsAuthError('학습지 초안을 찾을 수 없습니다.', 403);
    }
    const status = String(draftRow.status);
    if (status === 'published' || status === 'void') {
        throw new WorksheetInputError('이미 배포되었거나 취소된 학습지입니다.');
    }

    const { data: variantData, error: variantError } = await learning
        .from('worksheet_variants')
        .select('id,student_id,version_code')
        .eq('draft_id', draftId)
        .order('created_at');
    ensureNoError(variantError, '학습지 정보를 불러오지 못했습니다');
    const variantRows = (variantData ?? []) as Row[];
    if (variantRows.length === 0) {
        throw new WorksheetInputError('학습지에 학생 정보가 없습니다.');
    }

    const variants = [] as Array<VariantRow & { items: ItemRow[] }>;
    for (const variant of variantRows) {
        const { data: itemData, error: itemError } = await learning
            .from('worksheet_items')
            .select('seq,problem_id,role,challenge_band_snapshot,analysis_skill_id,answer_snapshot')
            .eq('variant_id', String(variant.id))
            .order('seq');
        ensureNoError(itemError, '학습지 문항을 불러오지 못했습니다');
        variants.push({
            id: String(variant.id),
            studentId: String(variant.student_id),
            versionCode: String(variant.version_code),
            items: ((itemData ?? []) as Row[]).map((item) => ({
                seq: Number(item.seq),
                problemId: String(item.problem_id),
                role: String(item.role),
                challengeBand: item.challenge_band_snapshot == null
                    ? null
                    : Number(item.challenge_band_snapshot),
                analysisSkillId: item.analysis_skill_id == null
                    ? null
                    : String(item.analysis_skill_id),
                answerSnapshot: item.answer_snapshot ?? null,
            })),
        });
    }

    return {
        draft: {
            id: String(draftRow.id),
            academyId: String(draftRow.academy_id),
            status,
            renderRevision: Number(draftRow.render_revision) || 1,
        },
        variants,
    };
}

async function loadNames(
    academyId: string,
    studentIds: string[],
): Promise<{ academyName: string; studentNames: Map<string, string> }> {
    const admin = createAdminClient();
    const core = admin.schema('core');

    const { data: academy, error: academyError } = await core
        .from('academies')
        .select('name')
        .eq('id', academyId)
        .maybeSingle();
    ensureNoError(academyError, '학원 정보를 불러오지 못했습니다');

    const { data: students, error: studentError } = await core
        .from('students')
        .select('id,person_id')
        .in('id', studentIds);
    ensureNoError(studentError, '학생 정보를 불러오지 못했습니다');
    const personIds = ((students ?? []) as Row[])
        .flatMap((row) => (typeof row.person_id === 'string' ? [row.person_id] : []));
    const { data: people, error: peopleError } = await core
        .from('people')
        .select('id,full_name,display_name')
        .in('id', personIds);
    ensureNoError(peopleError, '학생 이름을 불러오지 못했습니다');

    const nameByPerson = new Map<string, string>();
    for (const person of (people ?? []) as Row[]) {
        const name = (person.display_name ?? person.full_name);
        if (typeof person.id === 'string' && typeof name === 'string' && name.trim()) {
            nameByPerson.set(person.id, name.trim());
        }
    }
    const studentNames = new Map<string, string>();
    for (const student of (students ?? []) as Row[]) {
        if (typeof student.id !== 'string') continue;
        const personId = typeof student.person_id === 'string' ? student.person_id : '';
        studentNames.set(student.id, nameByPerson.get(personId) ?? '학생');
    }

    return {
        academyName: typeof (academy as Row | null)?.name === 'string'
            ? String((academy as Row).name)
            : '학원',
        studentNames,
    };
}

interface JobClaim {
    jobId: string;
    reusedArtifactId: string | null;
}

async function claimRenderJob(
    academyId: string,
    draftId: string,
    variantId: string | null,
    kind: 'student_pdf' | 'answer_key',
    renderRevision: number,
): Promise<JobClaim> {
    const admin = createAdminClient();
    const learning = admin.schema('learning');
    const idempotencyKey = `${draftId}:r${renderRevision}:engine${RENDER_ENGINE_VERSION}:${kind}:${variantId ?? 'draft'}`;

    const { data: existing, error: readError } = await learning
        .from('worksheet_render_jobs')
        .select('id,status,attempts,artifact_id')
        .eq('academy_id', academyId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
    ensureNoError(readError, '렌더 작업을 확인하지 못했습니다');
    const existingRow = existing as Row | null;

    if (existingRow?.id) {
        if (existingRow.status === 'succeeded' && typeof existingRow.artifact_id === 'string') {
            return { jobId: String(existingRow.id), reusedArtifactId: existingRow.artifact_id };
        }
        const { error } = await learning
            .from('worksheet_render_jobs')
            .update({
                status: 'running',
                attempts: (Number(existingRow.attempts) || 0) + 1,
                started_at: new Date().toISOString(),
                error_message: null,
            })
            .eq('id', existingRow.id);
        ensureNoError(error, '렌더 작업을 시작하지 못했습니다');
        return { jobId: String(existingRow.id), reusedArtifactId: null };
    }

    const { data: created, error: insertError } = await learning
        .from('worksheet_render_jobs')
        .insert({
            academy_id: academyId,
            draft_id: draftId,
            variant_id: variantId,
            kind,
            render_revision: renderRevision,
            idempotency_key: idempotencyKey,
            status: 'running',
            attempts: 1,
            started_at: new Date().toISOString(),
        })
        .select('id')
        .single();
    ensureNoError(insertError, '렌더 작업을 만들지 못했습니다');
    return { jobId: String((created as Row).id), reusedArtifactId: null };
}

async function finishJob(
    jobId: string,
    outcome: { artifactId: string } | { errorMessage: string },
): Promise<void> {
    const admin = createAdminClient();
    const learning = admin.schema('learning');
    const { error } = await learning
        .from('worksheet_render_jobs')
        .update('artifactId' in outcome
            ? {
                status: 'succeeded',
                artifact_id: outcome.artifactId,
                finished_at: new Date().toISOString(),
            }
            : {
                status: 'failed',
                error_message: outcome.errorMessage.slice(0, 1000),
                finished_at: new Date().toISOString(),
            })
        .eq('id', jobId);
    ensureNoError(error, '렌더 작업 상태를 저장하지 못했습니다');
}

async function saveArtifact(input: {
    academyId: string;
    draftId: string;
    variantId: string | null;
    kind: 'student_pdf' | 'answer_key';
    renderRevision: number;
    bytes: Uint8Array;
    pageCount: number;
}): Promise<string> {
    const admin = createAdminClient();
    const learning = admin.schema('learning');
    const fileName = `${input.kind}-${input.variantId ?? 'draft'}.pdf`;
    const storagePath = `${input.academyId}/${input.draftId}/r${input.renderRevision}/${fileName}`;

    const { error: uploadError } = await admin.storage
        .from(WORKSHEET_ARTIFACTS_BUCKET)
        .upload(storagePath, Buffer.from(input.bytes), {
            contentType: 'application/pdf',
            cacheControl: '0',
            upsert: true,
        });
    ensureNoError(uploadError, '산출물 업로드에 실패했습니다');

    const identity = {
        draft_id: input.draftId,
        render_revision: input.renderRevision,
        kind: input.kind,
    };
    let query = learning
        .from('worksheet_artifacts')
        .select('id')
        .match(identity);
    query = input.variantId === null
        ? query.is('variant_id', null)
        : query.eq('variant_id', input.variantId);
    const { data: existing, error: readError } = await query.maybeSingle();
    ensureNoError(readError, '산출물 정보를 확인하지 못했습니다');

    const payload = {
        academy_id: input.academyId,
        ...identity,
        variant_id: input.variantId,
        storage_bucket: WORKSHEET_ARTIFACTS_BUCKET,
        storage_path: storagePath,
        sha256: sha256Hex(input.bytes),
        byte_size: input.bytes.byteLength,
        page_count: input.pageCount,
    };
    if ((existing as Row | null)?.id) {
        const artifactId = String((existing as Row).id);
        const { error } = await learning
            .from('worksheet_artifacts')
            .update(payload)
            .eq('id', artifactId);
        ensureNoError(error, '산출물 정보를 갱신하지 못했습니다');
        return artifactId;
    }
    const { data: created, error: insertError } = await learning
        .from('worksheet_artifacts')
        .insert(payload)
        .select('id')
        .single();
    ensureNoError(insertError, '산출물 정보를 저장하지 못했습니다');
    return String((created as Row).id);
}

async function setStatuses(draftId: string, variantIds: string[], status: 'rendering' | 'ready' | 'failed_variant_reset'): Promise<void> {
    const admin = createAdminClient();
    const learning = admin.schema('learning');
    if (status === 'failed_variant_reset') {
        await learning.from('worksheet_variants').update({ status: 'failed' }).in('id', variantIds);
        await learning.from('worksheet_drafts').update({ status: 'draft' }).eq('id', draftId);
        return;
    }
    const { error: variantError } = await learning
        .from('worksheet_variants')
        .update({ status })
        .in('id', variantIds);
    ensureNoError(variantError, '학습지 상태를 갱신하지 못했습니다');
    const { error: draftError } = await learning
        .from('worksheet_drafts')
        .update({
            status,
            ...(status === 'rendering' ? { render_requested_at: new Date().toISOString() } : {}),
        })
        .eq('id', draftId);
    ensureNoError(draftError, '학습지 초안 상태를 갱신하지 못했습니다');
}

async function signArtifactUrl(storagePath: string): Promise<string | null> {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
        .from(WORKSHEET_ARTIFACTS_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    ensureNoError(error, '산출물 URL을 발급하지 못했습니다');
    return data?.signedUrl ?? null;
}

async function loadArtifactRow(artifactId: string): Promise<{ storagePath: string; pageCount: number | null; byteSize: number }> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .schema('learning')
        .from('worksheet_artifacts')
        .select('storage_path,page_count,byte_size')
        .eq('id', artifactId)
        .single();
    ensureNoError(error, '산출물 정보를 불러오지 못했습니다');
    const row = data as Row;
    return {
        storagePath: String(row.storage_path),
        pageCount: row.page_count == null ? null : Number(row.page_count),
        byteSize: Number(row.byte_size) || 0,
    };
}

/**
 * 초안의 모든 산출물(학생 PDF + 정답지)을 동기 렌더한다. 작업은 초안·리비전·
 * 종류·학생 단위 idempotency key로 관리되어 중복 호출·재시도에도 산출물이
 * 한 벌만 남는다. v1 규모(학생 1명, 문항 ≤ 40)에 맞춘 인라인 실행이다.
 */
export async function renderWorksheetDraft(
    actor: LmsRoleContext,
    params: { draftId: string },
): Promise<WorksheetRenderResult> {
    const { draft, variants } = await loadDraftForRender(actor, params.draftId);
    const variantIds = variants.map((variant) => variant.id);
    const { academyName, studentNames } = await loadNames(
        draft.academyId,
        variants.map((variant) => variant.studentId),
    );

    const allProblemIds = [...new Set(
        variants.flatMap((variant) => variant.items.map((item) => item.problemId)),
    )];
    const problemMeta = await loadProblemMeta(allProblemIds);
    const skillIds = [...new Set(
        variants.flatMap((variant) =>
            variant.items.flatMap((item) => (item.analysisSkillId ? [item.analysisSkillId] : [])),
        ),
    )];
    const skillNames = await loadSkillNames(skillIds);

    const fonts = loadWorksheetFonts();
    const dateLabel = toSeoulDate(new Date());
    const admin = createAdminClient();
    const warnings: string[] = [];
    const artifacts: WorksheetRenderArtifact[] = [];

    await setStatuses(draft.id, variantIds, 'rendering');

    for (const variant of variants) {
        const claim = await claimRenderJob(
            draft.academyId, draft.id, variant.id, 'student_pdf', draft.renderRevision,
        );
        try {
            let storagePath: string;
            let pageCount: number | null;
            let byteSize: number;

            if (claim.reusedArtifactId) {
                const existing = await loadArtifactRow(claim.reusedArtifactId);
                storagePath = existing.storagePath;
                pageCount = existing.pageCount;
                byteSize = existing.byteSize;
            } else {
                const layoutInputs: LayoutItemInput[] = [];
                const images: Array<{ seq: number; png: Uint8Array }> = [];
                for (const item of variant.items) {
                    const meta = problemMeta.get(item.problemId);
                    if (!meta?.imagePath) {
                        throw new WorksheetInputError(
                            `${item.seq}번 문항의 이미지가 없어 PDF를 만들 수 없습니다.`,
                        );
                    }
                    const { data: blob, error: downloadError } = await admin.storage
                        .from(PROBLEM_IMAGES_BUCKET)
                        .download(meta.imagePath);
                    ensureNoError(downloadError, `${item.seq}번 문항 이미지를 내려받지 못했습니다`);
                    const normalized = await normalizeProblemImage(
                        new Uint8Array(await blob!.arrayBuffer()),
                    );
                    layoutInputs.push({
                        seq: item.seq,
                        widthPx: normalized.widthPx,
                        heightPx: normalized.heightPx,
                        contentHeightToWidthRatio: normalized.contentHeightToWidthRatio,
                    });
                    images.push({ seq: item.seq, png: normalized.png });
                }

                const layout = layoutWorksheet(layoutInputs);
                for (const warning of layout.warnings) warnings.push(warning.detail);

                const bytes = await composeStudentPdf({
                    header: {
                        academyName,
                        title: '맞춤 학습지',
                        studentName: studentNames.get(variant.studentId) ?? '학생',
                        dateLabel,
                        versionCode: variant.versionCode,
                    },
                    layout,
                    images,
                    fonts,
                });
                pageCount = layout.pages.length;
                byteSize = bytes.byteLength;
                const artifactId = await saveArtifact({
                    academyId: draft.academyId,
                    draftId: draft.id,
                    variantId: variant.id,
                    kind: 'student_pdf',
                    renderRevision: draft.renderRevision,
                    bytes,
                    pageCount: layout.pages.length,
                });
                await finishJob(claim.jobId, { artifactId });
                storagePath = `${draft.academyId}/${draft.id}/r${draft.renderRevision}/student_pdf-${variant.id}.pdf`;
            }

            artifacts.push({
                kind: 'student_pdf',
                variantId: variant.id,
                versionCode: variant.versionCode,
                pageCount,
                byteSize,
                url: await signArtifactUrl(storagePath),
            });
        } catch (error) {
            await finishJob(claim.jobId, {
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            await setStatuses(draft.id, variantIds, 'failed_variant_reset');
            throw error;
        }
    }

    const answerClaim = await claimRenderJob(
        draft.academyId, draft.id, null, 'answer_key', draft.renderRevision,
    );
    try {
        let storagePath: string;
        let pageCount: number | null;
        let byteSize: number;

        if (answerClaim.reusedArtifactId) {
            const existing = await loadArtifactRow(answerClaim.reusedArtifactId);
            storagePath = existing.storagePath;
            pageCount = existing.pageCount;
            byteSize = existing.byteSize;
        } else {
            const variant = variants[0];
            const entries: AnswerKeyEntry[] = variant.items.map((item) => ({
                seq: item.seq,
                answerText: formatAnswerText(item.answerSnapshot),
                challengeBand: item.challengeBand,
                skillName: item.analysisSkillId
                    ? (skillNames.get(item.analysisSkillId) ?? null)
                    : null,
                role: item.role,
            }));
            const bytes = await composeAnswerKeyPdf({
                academyName,
                title: '맞춤 학습지',
                studentName: studentNames.get(variant.studentId) ?? '학생',
                dateLabel,
                versionCode: variant.versionCode,
                entries,
                fonts,
            });
            byteSize = bytes.byteLength;
            pageCount = null;
            const artifactId = await saveArtifact({
                academyId: draft.academyId,
                draftId: draft.id,
                variantId: null,
                kind: 'answer_key',
                renderRevision: draft.renderRevision,
                bytes,
                pageCount: 1,
            });
            await finishJob(answerClaim.jobId, { artifactId });
            storagePath = `${draft.academyId}/${draft.id}/r${draft.renderRevision}/answer_key-draft.pdf`;
        }

        artifacts.push({
            kind: 'answer_key',
            variantId: null,
            versionCode: null,
            pageCount,
            byteSize,
            url: await signArtifactUrl(storagePath),
        });
    } catch (error) {
        await finishJob(answerClaim.jobId, {
            errorMessage: error instanceof Error ? error.message : String(error),
        });
        await setStatuses(draft.id, variantIds, 'failed_variant_reset');
        throw error;
    }

    await setStatuses(draft.id, variantIds, 'ready');

    return {
        draftId: draft.id,
        status: 'ready',
        artifacts,
        warnings,
    };
}
