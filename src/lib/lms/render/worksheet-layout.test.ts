import { describe, expect, it } from 'vitest';

import {
    DEFAULT_LAYOUT_CONFIG,
    deriveLayoutMetrics,
    layoutWorksheet,
    type LayoutItemInput,
} from './worksheet-layout';

function normalItem(seq: number): LayoutItemInput {
    return { seq, widthPx: 1000, heightPx: 600 };
}

function tallItem(seq: number): LayoutItemInput {
    return { seq, widthPx: 1000, heightPx: 1100 };
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
    it('places four normal items in two columns on one page', () => {
        const result = layoutWorksheet([1, 2, 3, 4].map(normalItem));
        expect(result.pages).toHaveLength(1);
        const [a, b, c, d] = result.pages[0].items;
        expect(a.xMm).toBe(b.xMm);
        expect(b.yMm).toBeGreaterThan(a.yMm);
        expect(c.xMm).toBeGreaterThan(a.xMm);
        expect(c.yMm).toBe(a.yMm);
        expect(d.xMm).toBe(c.xMm);
        expect(d.yMm).toBe(b.yMm);
        expect(result.warnings).toHaveLength(0);
    });

    it('starts a new page after four normal items', () => {
        const result = layoutWorksheet([1, 2, 3, 4, 5, 6].map(normalItem));
        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].items.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
        expect(result.pages[1].items.map((item) => item.seq)).toEqual([5, 6]);
    });

    it('gives tall items one full column and places two on a page', () => {
        const result = layoutWorksheet([tallItem(1), tallItem(2)]);
        expect(result.pages).toHaveLength(1);
        expect(result.pages[0].items.map((item) => item.kind))
            .toEqual(['full_column', 'full_column']);
        expect(result.pages[0].items[1].xMm).toBeGreaterThan(result.pages[0].items[0].xMm);
    });

    it('uses content proportions for placement while keeping a common canvas width', () => {
        const result = layoutWorksheet([{
            seq: 1,
            widthPx: 1024,
            heightPx: 700,
            contentHeightToWidthRatio: 1.1,
        }]);
        expect(result.pages[0].items[0].kind).toBe('full_column');
    });

    it('keeps mixed items in sequence and leaves a partial column blank when needed', () => {
        const result = layoutWorksheet([normalItem(1), tallItem(2), normalItem(3)]);
        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].items.map((item) => item.seq)).toEqual([1, 2]);
        expect(result.pages[0].items[1].kind).toBe('full_column');
        expect(result.pages[1].items[0].seq).toBe(3);
    });

    it('uses image proportions rather than DPI metadata to determine placement', () => {
        const result = layoutWorksheet([{ seq: 1, widthPx: 2000, heightPx: 1000 }]);
        const placed = result.pages[0].items[0];
        expect(placed.kind).toBe('half_column');
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
