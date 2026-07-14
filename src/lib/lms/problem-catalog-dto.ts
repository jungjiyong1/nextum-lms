import type { AssignmentProblemSummary } from '@/features/lms/types';

export interface ProblemCatalogRow {
    id: string;
    book_id: string;
    unit_id: string;
    concept_id?: string | null;
    problem_type_id?: string | null;
    type_id?: string | null;
    middle_unit?: string | null;
    page_printed: number;
    number: string | number;
}

export interface ProblemTypeLabel {
    name: string;
    concept_id?: string | null;
}

export function toProblemCatalogSummary(
    row: ProblemCatalogRow,
    typeById: ReadonlyMap<string, ProblemTypeLabel>,
    conceptNameById: ReadonlyMap<string, string>,
): AssignmentProblemSummary {
    const typeId = row.problem_type_id || row.type_id || null;
    const type = typeId ? typeById.get(typeId) : null;
    const conceptId = row.concept_id || type?.concept_id || null;
    return {
        id: row.id,
        bookId: row.book_id,
        unitId: row.unit_id,
        problemTypeId: typeId,
        middleUnitName: row.middle_unit?.trim() || null,
        number: String(row.number),
        pagePrinted: Number(row.page_printed),
        typeName: type?.name ?? null,
        conceptName: conceptId ? conceptNameById.get(conceptId) ?? null : null,
    };
}
