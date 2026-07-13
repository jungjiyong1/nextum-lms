import 'server-only';

import type { AssignmentProblemSummary } from '@/features/lms/types';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    type ProblemCatalogRow,
    type ProblemTypeLabel,
    toProblemCatalogSummary,
} from './problem-catalog-dto';
import {
    ApiContractError,
    type CursorPage,
    decodeCursor,
    encodeCursor,
    normalizeCursorLimit,
} from './api-contracts';
import type { LmsRoleContext } from './auth';

type Row = Record<string, any>;

interface ProblemCatalogCursor {
    pagePrinted: number;
    id: string;
}

export interface ProblemCatalogFilters {
    bookId: string;
    unitId?: string | null;
    problemTypeId?: string | null;
    pagePrinted?: number | null;
    cursor?: string | null;
    limit?: string | number | null;
}

const SAFE_CURSOR_ID = /^[A-Za-z0-9_.:@/-]+$/u;

function ensureNoError(error: { message?: string } | null, context: string) {
    if (error) throw new Error(`${context}: ${error.message ?? 'Unknown Supabase error'}`);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isProblemCatalogCursor(value: unknown): value is ProblemCatalogCursor {
    if (!value || typeof value !== 'object') return false;
    const cursor = value as Partial<ProblemCatalogCursor>;
    return Number.isInteger(cursor.pagePrinted)
        && Number(cursor.pagePrinted) >= 0
        && typeof cursor.id === 'string'
        && cursor.id.length > 0
        && cursor.id.length <= 512
        && SAFE_CURSOR_ID.test(cursor.id);
}

function assertRequiredId(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 512) {
        throw new ApiContractError({
            code: 'INVALID_FILTER',
            message: `${label} is invalid.`,
        });
    }
    return normalized;
}

export async function loadProblemCatalogPage(
    context: LmsRoleContext,
    filters: ProblemCatalogFilters,
): Promise<CursorPage<AssignmentProblemSummary>> {
    const bookId = assertRequiredId(filters.bookId, 'bookId');
    const unitId = filters.unitId ? assertRequiredId(filters.unitId, 'unitId') : null;
    const problemTypeId = filters.problemTypeId
        ? assertRequiredId(filters.problemTypeId, 'problemTypeId')
        : null;
    const pagePrinted = filters.pagePrinted ?? null;
    if (pagePrinted !== null && (!Number.isInteger(pagePrinted) || pagePrinted < 0)) {
        throw new ApiContractError({
            code: 'INVALID_FILTER',
            message: 'pagePrinted must be a non-negative integer.',
        });
    }

    const limit = normalizeCursorLimit(filters.limit);
    const cursor = decodeCursor(filters.cursor, isProblemCatalogCursor);
    const client = createAdminClient();
    const content = client.schema('content');

    const { data: book, error: bookError } = await content
        .from('books')
        .select('id,academy_id,metadata')
        .eq('id', bookId)
        .maybeSingle();
    ensureNoError(bookError, 'Failed to validate assignment book');
    const bookRow = book as Row | null;
    if (
        !bookRow
        || (bookRow.academy_id && bookRow.academy_id !== context.academyId)
        || bookRow.metadata?.visibility !== 'catalog'
    ) {
        throw new ApiContractError({
            code: 'CATALOG_NOT_FOUND',
            message: 'The requested problem catalog is unavailable.',
        });
    }

    let query = content
        .from('problems')
        .select(
            'id,book_id,unit_id,concept_id,problem_type_id,type_id,page_printed,number',
            cursor ? undefined : { count: 'planned' },
        )
        .eq('book_id', bookId)
        .eq('verified', true)
        .eq('is_example', false)
        .not('page_printed', 'is', null);

    if (unitId) query = query.eq('unit_id', unitId);
    if (problemTypeId) query = query.eq('problem_type_id', problemTypeId);
    if (pagePrinted !== null) query = query.eq('page_printed', pagePrinted);
    if (cursor) {
        query = query.or(
            `page_printed.gt.${cursor.pagePrinted},and(page_printed.eq.${cursor.pagePrinted},id.gt."${cursor.id}")`,
        );
    }

    const { data, error, count } = await query
        .order('page_printed', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit + 1);
    ensureNoError(error, 'Failed to load problem catalog');

    const fetchedRows = (data || []) as Row[];
    const hasNextPage = fetchedRows.length > limit;
    const rows = hasNextPage ? fetchedRows.slice(0, limit) : fetchedRows;
    const typeIds = uniqueStrings(rows.map((row) => row.problem_type_id || row.type_id));
    const conceptIdsFromProblems = uniqueStrings(rows.map((row) => row.concept_id));
    const { data: typeData, error: typeError } = typeIds.length
        ? await content
            .from('problem_types')
            .select('id,name,concept_id')
            .in('id', typeIds)
        : { data: [], error: null };
    ensureNoError(typeError, 'Failed to load problem type labels');

    const typeRows = (typeData || []) as Row[];
    const typeById = new Map<string, ProblemTypeLabel>(typeRows.map((row) => [row.id, {
        name: row.name,
        concept_id: row.concept_id ?? null,
    }]));
    const conceptIds = uniqueStrings([
        ...conceptIdsFromProblems,
        ...typeRows.map((row) => row.concept_id),
    ]);
    const { data: conceptData, error: conceptError } = conceptIds.length
        ? await content.from('concepts').select('id,name').in('id', conceptIds)
        : { data: [], error: null };
    ensureNoError(conceptError, 'Failed to load concept labels');
    const conceptNameById = new Map(((conceptData || []) as Row[]).map((row) => [row.id, row.name]));

    const items = rows.map((row) => toProblemCatalogSummary(
        row as ProblemCatalogRow,
        typeById,
        conceptNameById,
    ));
    const lastItem = rows.at(-1);

    return {
        items,
        nextCursor: hasNextPage && lastItem
            ? encodeCursor({ pagePrinted: Number(lastItem.page_printed), id: String(lastItem.id) })
            : null,
        hasMore: hasNextPage,
        totalCount: cursor ? null : count ?? 0,
    };
}
