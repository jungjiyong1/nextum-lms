import { describe, expect, it } from 'vitest';

import {
    DEFAULT_LAYOUT_CONFIG,
    deriveLayoutMetrics,
    layoutWorksheet,
    type LayoutItemInput,
} from './worksheet-layout';

function item(seq: number, heightPx = 600): LayoutItemInput {
    return { seq, widthPx: 1000, heightPx };
}

describe('deriveLayoutMetrics', () => {
    it('matches the documented A4 derivation', () => {
        const metrics = deriveLayoutMetrics(DEFAULT_LAYOUT_CONFIG);
        expect(metrics.contentWidthMm).toBe(190);
        expect(metrics.columnWidthMm).toBe(92);
        expect(metrics.contentHeightMm).toBe(253);
        expect(metrics.rowHeightMm).toBeCloseTo(124.5, 1);
    });
});

describe('layoutWorksheet', () => {
    it('places four items in row-major quadrant order', () => {
        const result = layoutWorksheet([1, 2, 3, 4].map((seq) => item(seq)));
        expect(result.pages).toHaveLength(1);
        const [a, b, c, d] = result.pages[0].items;
        expect(a.xMm).toBeLessThan(b.xMm);
        expect(a.yMm).toBe(b.yMm);
        expect(c.xMm).toBe(a.xMm);
        expect(c.yMm).toBeGreaterThan(a.yMm);
        expect(d.xMm).toBe(b.xMm);
        expect(d.yMm).toBe(c.yMm);
        expect(result.pages[0].items.map((placed) => placed.kind))
            .toEqual(['quarter', 'quarter', 'quarter', 'quarter']);
    });

    it('always keeps tall items in one of the four quadrants', () => {
        const result = layoutWorksheet([1, 2, 3, 4].map((seq) => item(seq, 1300)));
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].items).toHaveLength(4);
        for (const placed of result.pages[0].items) {
            expect(placed.kind).toBe('quarter');
            expect(placed.imageHeightMm)
                .toBeLessThanOrEqual(deriveLayoutMetrics(DEFAULT_LAYOUT_CONFIG).rowHeightMm);
        }
    });

    it('starts a new page after every four items', () => {
        const result = layoutWorksheet([1, 2, 3, 4, 5, 6].map((seq) => item(seq)));
        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].items.map((placed) => placed.seq)).toEqual([1, 2, 3, 4]);
        expect(result.pages[1].items.map((placed) => placed.seq)).toEqual([5, 6]);
    });

    it('uses the shared image width for a consistent text scale', () => {
        const result = layoutWorksheet([{ seq: 1, widthPx: 2000, heightPx: 1000 }]);
        const placed = result.pages[0].items[0];
        expect(placed.imageWidthMm).toBeCloseTo(80, 5);
        expect(placed.imageHeightMm).toBeCloseTo(40, 5);
    });

    it('warns when the effective print resolution is low', () => {
        const result = layoutWorksheet([{ seq: 1, widthPx: 300, heightPx: 180 }]);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].code).toBe('low_effective_dpi');
    });

    it('rejects invalid dimensions', () => {
        expect(() => layoutWorksheet([{ seq: 1, widthPx: 0, heightPx: 100 }])).toThrow();
    });
});
