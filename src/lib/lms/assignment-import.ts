import 'server-only';

import { randomBytes } from 'crypto';
import JSZip from 'jszip';
import type { CreateLearningAssignmentInput } from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import type { LmsRoleContext } from './auth';
import { createLearningAssignmentForAcademy } from './mutations';
import {
    runWorksheetImportCompensation,
    type WorksheetImportCompensationState,
} from './worksheet-import-compensation';

type Row = Record<string, any>;
type LmsAdminClient = ReturnType<typeof createAdminClient>;

const PROBLEM_IMAGES_BUCKET = 'problem-images';

type WorksheetImportState = WorksheetImportCompensationState;

interface ExportProblem {
    problem_id?: string;
    page_printed?: number;
    number?: string | number;
    image?: string | null;
    answer?: Row;
    concept_name?: string | null;
    concept_name_raw?: string | null;
    type_name?: string | null;
    type_name_raw?: string | null;
    position_in_type?: number | null;
    is_example?: boolean;
    difficulty_hint?: string | null;
    verified?: boolean;
    [key: string]: unknown;
}

interface ExportUnit {
    unit_id?: string;
    name?: string;
    page_range?: [number, number];
    problems?: ExportProblem[];
}

interface ExportPart {
    part_id?: string;
    name?: string;
    units?: ExportUnit[];
}

interface ContentExport {
    schema_version?: number;
    book_id?: string;
    title?: string;
    subject?: string | null;
    grade?: string | null;
    pipeline_version?: string | null;
    parts?: ExportPart[];
}

interface LoadedBundle {
    exportJson: ContentExport;
    readImage(path: string): Promise<Uint8Array | null>;
}

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) {
        throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
    }
}

function slug(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'worksheet';
}

function safePathSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || randomBytes(4).toString('hex');
}

async function ensureBucket(client: LmsAdminClient, bucket: string) {
    const { data, error } = await client.storage.listBuckets();
    ensureNoError(error, 'Failed to list storage buckets');
    if ((data || []).some((row) => row.name === bucket)) return;
    const { error: createError } = await client.storage.createBucket(bucket, { public: false });
    ensureNoError(createError, `Failed to create ${bucket} bucket`);
}

async function loadBundle(file: File): Promise<LoadedBundle> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(bytes);
        const exportFile = zip.file('export.json');
        if (!exportFile) throw new Error('Zip export must include export.json.');
        const exportJson = JSON.parse(await exportFile.async('text')) as ContentExport;
        return {
            exportJson,
            readImage: async (path: string) => {
                const entry = zip.file(path);
                return entry ? await entry.async('uint8array') : null;
            },
        };
    }

    if (!name.endsWith('.json')) throw new Error('Worksheet import must be a crop-trainer zip or export.json file.');
    const exportJson = JSON.parse(new TextDecoder().decode(bytes)) as ContentExport;
    return {
        exportJson,
        readImage: async () => null,
    };
}

function flattenProblems(exportJson: ContentExport) {
    const rows: Array<{ part: ExportPart; unit: ExportUnit; problem: ExportProblem; index: number }> = [];
    for (const part of exportJson.parts || []) {
        for (const unit of part.units || []) {
            for (const problem of unit.problems || []) {
                if (problem.verified === false) continue;
                rows.push({ part, unit, problem, index: rows.length });
            }
        }
    }
    return rows;
}

async function createHiddenWorksheetBook(
    client: LmsAdminClient,
    academyId: string,
    file: File,
    state: WorksheetImportState,
): Promise<{ bookId: string; problemIds: string[] }> {
    const { exportJson, readImage } = await loadBundle(file);
    if (exportJson.schema_version !== 1) throw new Error('Only crop-trainer export schema_version 1 is supported.');
    if (!exportJson.parts?.length) throw new Error('Worksheet export has no parts.');

    const content = client.schema('content');
    const bookKey = `assignment-${academyId.slice(0, 8)}-${slug(exportJson.book_id || exportJson.title || file.name)}-${randomBytes(4).toString('hex')}`;
    const title = exportJson.title?.trim() || file.name.replace(/\.(zip|json)$/i, '') || '학습지';

    const { data: book, error: bookError } = await content
        .from('books')
        .insert({
            academy_id: academyId,
            book_key: bookKey,
            title,
            subject: exportJson.subject ?? null,
            grade: exportJson.grade ?? null,
            schema_version: exportJson.schema_version,
            pipeline_version: exportJson.pipeline_version ?? null,
            metadata: {
                visibility: 'assignment_hidden',
                source: 'worksheet_export',
                source_book_id: exportJson.book_id ?? null,
            },
        })
        .select('id')
        .single();
    ensureNoError(bookError, 'Failed to create worksheet hidden book');
    if (!book?.id) throw new Error('Failed to create worksheet hidden book');
    const bookId = book.id as string;
    state.bookId = bookId;

    const unitRows = (exportJson.parts || []).flatMap((part, partIndex) =>
        (part.units || []).map((unit, unitIndex) => ({
            book_id: bookId,
            unit_key: unit.unit_id || `${part.part_id || `part-${partIndex + 1}`}-unit-${unitIndex + 1}`,
            part_name: part.name || null,
            name: unit.name || `Unit ${unitIndex + 1}`,
            page_start: unit.page_range?.[0] ?? null,
            page_end: unit.page_range?.[1] ?? null,
            sort_order: partIndex * 1000 + unitIndex,
        }))
    );
    const { data: units, error: unitError } = await content
        .from('units')
        .upsert(unitRows, { onConflict: 'book_id,unit_key' })
        .select('id,unit_key');
    ensureNoError(unitError, 'Failed to create worksheet units');
    const unitIdByKey = new Map(((units || []) as Row[]).map((row) => [row.unit_key, row.id]));

    const flattened = flattenProblems(exportJson);
    if (flattened.length === 0) throw new Error('Worksheet export has no verified problems.');

    const conceptRowsByKey = new Map<string, Row>();
    for (const item of flattened) {
        const name = item.problem.concept_name;
        const unitId = unitIdByKey.get(item.unit.unit_id || '') ?? null;
        if (!name || !unitId) continue;
        const key = `${unitId}::${name}`;
        if (conceptRowsByKey.has(key)) continue;
        conceptRowsByKey.set(key, {
            book_id: bookId,
            unit_id: unitId,
            name,
            name_raw: item.problem.concept_name_raw ?? null,
            sort_order: conceptRowsByKey.size,
        });
    }
    const conceptIdByKey = new Map<string, string>();
    if (conceptRowsByKey.size > 0) {
        const { data, error } = await content
            .from('concepts')
            .upsert([...conceptRowsByKey.values()], { onConflict: 'book_id,unit_id,name' })
            .select('id,unit_id,name');
        ensureNoError(error, 'Failed to create worksheet concepts');
        for (const row of (data || []) as Row[]) conceptIdByKey.set(`${row.unit_id}::${row.name}`, row.id);
    }

    const typeRowsByKey = new Map<string, Row>();
    for (const item of flattened) {
        const name = item.problem.type_name;
        const unitId = unitIdByKey.get(item.unit.unit_id || '') ?? null;
        if (!name || !unitId) continue;
        const key = `${unitId}::${name}`;
        if (typeRowsByKey.has(key)) continue;
        const conceptKey = `${unitId}::${item.problem.concept_name || ''}`;
        typeRowsByKey.set(key, {
            book_id: bookId,
            unit_id: unitId,
            concept_id: item.problem.concept_name ? conceptIdByKey.get(conceptKey) ?? null : null,
            name,
            name_raw: item.problem.type_name_raw ?? null,
            sort_order: typeRowsByKey.size,
        });
    }
    const typeIdByKey = new Map<string, string>();
    if (typeRowsByKey.size > 0) {
        const { data, error } = await content
            .from('problem_types')
            .upsert([...typeRowsByKey.values()], { onConflict: 'book_id,unit_id,name' })
            .select('id,unit_id,name');
        ensureNoError(error, 'Failed to create worksheet problem types');
        for (const row of (data || []) as Row[]) typeIdByKey.set(`${row.unit_id}::${row.name}`, row.id);
    }

    await ensureBucket(client, PROBLEM_IMAGES_BUCKET);
    const problemRows: Row[] = [];
    const assetRows: Row[] = [];
    const problemIds: string[] = [];

    for (const item of flattened) {
        const originalId = String(item.problem.problem_id || `${item.index + 1}`);
        const problemId = `${bookKey}::${item.index + 1}`;
        const unitId = unitIdByKey.get(item.unit.unit_id || '') ?? [...unitIdByKey.values()][0];
        if (!unitId) throw new Error('Worksheet problem is missing a unit.');

        let imagePath: string | null = null;
        const rawImage = item.problem.image || null;
        if (rawImage && /^(https?:)?\/\//.test(rawImage)) {
            imagePath = rawImage;
        } else if (rawImage) {
            const imageBytes = await readImage(rawImage);
            if (!imageBytes) throw new Error(`Missing worksheet crop image: ${rawImage}`);
            const storagePath = `${bookKey}/${String(item.index + 1).padStart(4, '0')}-${safePathSegment(originalId)}.png`;
            const { error } = await client.storage
                .from(PROBLEM_IMAGES_BUCKET)
                .upload(storagePath, imageBytes, { contentType: 'image/png', upsert: true });
            ensureNoError(error, 'Failed to upload worksheet problem image');
            state.uploadedObjects.push({ bucket: PROBLEM_IMAGES_BUCKET, path: storagePath });
            imagePath = storagePath;
            assetRows.push({
                book_id: bookId,
                problem_id: problemId,
                kind: 'problem_image',
                storage_path: storagePath,
                media_type: 'image/png',
                metadata: { source_image: rawImage },
            });
        }

        problemIds.push(problemId);
        problemRows.push({
            id: problemId,
            book_id: bookId,
            unit_id: unitId,
            concept_id: item.problem.concept_name ? conceptIdByKey.get(`${unitId}::${item.problem.concept_name}`) ?? null : null,
            problem_type_id: item.problem.type_name ? typeIdByKey.get(`${unitId}::${item.problem.type_name}`) ?? null : null,
            page_printed: item.problem.page_printed ?? item.index + 1,
            number: String(item.problem.number ?? item.index + 1),
            image_path: imagePath,
            answer: item.problem.answer || { type: 'text', display: '', normalized: '', self_grade: true },
            position_in_type: item.problem.position_in_type ?? null,
            is_example: item.problem.is_example ?? false,
            difficulty_hint: item.problem.difficulty_hint ?? null,
            verified: true,
            metadata: {
                source: 'worksheet_export',
                original_problem_id: originalId,
                crop: {
                    bbox: item.problem.bbox ?? null,
                    bbox_pixels: item.problem.bbox_pixels ?? null,
                    page_printed: item.problem.page_printed ?? null,
                },
                answer_source: item.problem.answer_source ?? null,
            },
        });
    }

    const { error: problemError } = await content.from('problems').upsert(problemRows, { onConflict: 'id' });
    ensureNoError(problemError, 'Failed to create worksheet problems');
    if (assetRows.length > 0) {
        const { error: assetError } = await content.from('assets').insert(assetRows);
        ensureNoError(assetError, 'Failed to create worksheet assets');
    }

    return { bookId, problemIds };
}

async function compensateWorksheetImport(client: LmsAdminClient, state: WorksheetImportState) {
    const succeeded = await runWorksheetImportCompensation(state, {
        deleteAssignment: async (assignmentId) => {
            const { error } = await client
                .schema('learning')
                .from('assignments')
                .delete()
                .eq('id', assignmentId);
            return !error;
        },
        deleteBook: async (bookId) => {
            const { error } = await client
                .schema('content')
                .from('books')
                .delete()
                .eq('id', bookId);
            return !error;
        },
        removeStorageObjects: async (bucket, paths) => {
            const { error } = await client.storage.from(bucket).remove(paths);
            return !error;
        },
    });

    if (!succeeded) {
        console.warn('[Worksheet import] One or more compensation steps failed.');
    }
}

export async function importWorksheetAssignmentForAcademy(
    academyId: string,
    input: CreateLearningAssignmentInput,
    file: File,
    context?: LmsRoleContext,
) {
    const client = createAdminClient();
    const state: WorksheetImportState = { bookId: null, assignmentId: null, uploadedObjects: [] };
    try {
        const { bookId, problemIds } = await createHiddenWorksheetBook(client, academyId, file, state);
        const assignment = await createLearningAssignmentForAcademy(academyId, {
            ...input,
            bookId,
            problemIds,
            sourceType: 'worksheet',
        }, context);
        state.assignmentId = assignment.id;
        return assignment;
    } catch (error) {
        await compensateWorksheetImport(client, state);
        throw error;
    }
}
