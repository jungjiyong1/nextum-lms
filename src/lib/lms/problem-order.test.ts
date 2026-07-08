import { describe, expect, it } from 'vitest';

import { sortByProblemOrder } from './problem-order';

describe('sortByProblemOrder', () => {
    it('sorts by printed page first, then natural problem number', () => {
        const rows = [
            { id: 'page-12-10', page_printed: 12, number: '10' },
            { id: 'page-11-20', page_printed: 11, number: '20' },
            { id: 'page-12-2', page_printed: 12, number: '2' },
            { id: 'page-11-3', page_printed: 11, number: '3' },
        ];

        expect(sortByProblemOrder(rows).map((row) => row.id)).toEqual([
            'page-11-3',
            'page-11-20',
            'page-12-2',
            'page-12-10',
        ]);
    });

    it('accepts camel-case page fields from UI summaries', () => {
        const rows = [
            { id: 'b', pagePrinted: 2, number: '1' },
            { id: 'a', pagePrinted: 1, number: '1' },
        ];

        expect(sortByProblemOrder(rows).map((row) => row.id)).toEqual(['a', 'b']);
    });
});
