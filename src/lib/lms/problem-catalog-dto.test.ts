import { describe, expect, it } from 'vitest';
import { toProblemCatalogSummary, type ProblemCatalogRow } from './problem-catalog-dto';

describe('problem catalog DTO', () => {
    it('returns catalog metadata without answer or solution fields', () => {
        const databaseRow = {
            id: 'problem-1',
            book_id: 'book-1',
            unit_id: 'unit-1',
            concept_id: 'concept-1',
            problem_type_id: 'type-1',
            page_printed: 12,
            number: 3,
            answer: 'sensitive answer',
            solution: 'sensitive solution',
        } as ProblemCatalogRow & { answer: string; solution: string };

        const result = toProblemCatalogSummary(
            databaseRow,
            new Map([['type-1', { name: '연산', concept_id: 'concept-1' }]]),
            new Map([['concept-1', '분수의 덧셈']]),
        );

        expect(result).toEqual({
            id: 'problem-1',
            bookId: 'book-1',
            unitId: 'unit-1',
            problemTypeId: 'type-1',
            number: '3',
            pagePrinted: 12,
            typeName: '연산',
            conceptName: '분수의 덧셈',
        });
        expect(result).not.toHaveProperty('answer');
        expect(result).not.toHaveProperty('solution');
    });
});
