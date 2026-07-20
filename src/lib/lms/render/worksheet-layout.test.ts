import { describe, expect, it } from 'vitest';

import {
    DEFAULT_LAYOUT_CONFIG,
    deriveLayoutMetrics,
    layoutWorksheet,
    type LayoutItemInput,
} from './worksheet-layout';

// 150dpi 기준 일반 문항: 약 80 × 90mm 원본 → 92mm 셀에 여유 있게 들어간다.
function normalItem(seq: number): LayoutItemInput {
    return { seq, widthPx: 472, heightPx: 531, dpi: 150 };
}

// 가로세로 비율 2.0 → 전폭 배치 대상
function wideItem(seq: number): LayoutItemInput {
    return { seq, widthPx: 1000, heightPx: 500, dpi: 150 };
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
    it('places four normal items on one page in reading order', () => {
        const result = layoutWorksheet([1, 2, 3, 4].map(normalItem));
        expect(result.pages).toHaveLength(1);
        const [a, b, c, d] = result.pages[0].items;
        expect(a.xMm).toBeLessThan(b.xMm);
        expect(a.yMm).toBe(b.yMm);
        expect(c.yMm).toBeGreaterThan(a.yMm);
        expect(c.xMm).toBe(a.xMm);
        expect(d.xMm).toBeGreaterThan(c.xMm);
        expect(result.warnings).toHaveLength(0);
    });

    it('starts a new page after four items and leaves last-page cells empty', () => {
        const result = layoutWorksheet([1, 2, 3, 4, 5, 6].map(normalItem));
        expect(result.pages).toHaveLength(2);
        expect(result.pages[0].items.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
        expect(result.pages[1].items.map((item) => item.seq)).toEqual([5, 6]);
    });

    it('keeps image aspect ratio and never exceeds the 125% scale cap', () => {
        // 아주 작은 이미지: 25.4 × 25.4mm 원본
        const tiny = layoutWorksheet([{ seq: 1, widthPx: 150, heightPx: 150, dpi: 150 }]);
        const placed = tiny.pages[0].items[0];
        expect(placed.scale).toBeCloseTo(1.25, 5);
        expect(placed.imageWidthMm).toBeCloseTo(placed.imageHeightMm, 5);
    });

    it('gives wide items a full-width row so the page holds three items', () => {
        const result = layoutWorksheet([normalItem(1), normalItem(2), wideItem(3), normalItem(4)]);
        expect(result.pages).toHaveLength(2);
        const first = result.pages[0];
        expect(first.items.map((item) => item.seq)).toEqual([1, 2, 3]);
        expect(first.items[2].kind).toBe('full_width');
        // 순서 유지: 전폭 문항을 뒤로 미루지 않는다.
        expect(result.pages[1].items[0].seq).toBe(4);
    });

    it('leaves a blank cell when a full-width item follows a half-filled row', () => {
        const result = layoutWorksheet([normalItem(1), wideItem(2), normalItem(3)]);
        const first = result.pages[0];
        expect(first.items.map((item) => item.seq)).toEqual([1, 2]);
        // 1번이 좌상, 2번 전폭은 다음 행 — 우상 셀은 빈 풀이 공간
        expect(first.items[1].yMm).toBeGreaterThan(first.items[0].yMm);
        expect(result.pages[1].items[0].seq).toBe(3);
    });

    it('promotes items that would shrink below 70% in a cell to full width', () => {
        // 150dpi에서 180mm 폭 원본: 셀(92mm)에서는 51%, 전폭(190mm)에서는 100%
        const result = layoutWorksheet([
            { seq: 1, widthPx: 1063, heightPx: 700, dpi: 150 },
        ]);
        const placed = result.pages[0].items[0];
        expect(placed.kind).toBe('full_width');
        expect(placed.scale).toBeGreaterThanOrEqual(0.7);
        expect(result.warnings).toHaveLength(0);
    });

    it('gives oversized items their own page and warns when still below 70%', () => {
        // 150dpi에서 250 × 400mm 원본: 전폭 행에서도 크게 축소 → 단독 페이지
        const result = layoutWorksheet([
            normalItem(1),
            { seq: 2, widthPx: 1476, heightPx: 2362, dpi: 150 },
            normalItem(3),
        ]);
        expect(result.pages).toHaveLength(3);
        expect(result.pages[1].items[0].kind).toBe('own_page');
        expect(result.pages[1].items).toHaveLength(1);
        expect(result.warnings.some((warning) => warning.seq === 2)).toBe(true);
        expect(result.pages[2].items[0].seq).toBe(3);
    });

    it('uses the fallback dpi when image metadata is missing', () => {
        const withDpi = layoutWorksheet([{ seq: 1, widthPx: 472, heightPx: 531, dpi: 150 }]);
        const withoutDpi = layoutWorksheet([{ seq: 1, widthPx: 472, heightPx: 531 }]);
        expect(withoutDpi.pages[0].items[0].imageWidthMm)
            .toBeCloseTo(withDpi.pages[0].items[0].imageWidthMm, 5);
    });

    it('rejects invalid dimensions', () => {
        expect(() => layoutWorksheet([{ seq: 1, widthPx: 0, heightPx: 100 }])).toThrow();
    });
});
