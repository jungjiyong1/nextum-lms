/**
 * A4 세로 2열 × 2행 고정 조판. 모든 문항은 크기와 관계없이 한 사분면에
 * 하나씩 들어가며, 마지막 페이지의 남는 칸은 풀이 공간으로 비워 둔다.
 */

export interface LayoutConfig {
    pageWidthMm: number;
    pageHeightMm: number;
    outerMarginMm: number;
    headerMm: number;
    footerMm: number;
    columnGapMm: number;
    rowGapMm: number;
    /** 문제 번호를 위한 칸 왼쪽 여백 */
    numberGutterMm: number;
    /** 각 문제 영역 안쪽의 상하좌우 여백 */
    problemPaddingMm: number;
    /** 공통 글자 배율을 결정하는 문제 이미지 최대 너비 */
    problemImageWidthMm: number;
    /** 인쇄 해상도가 이 값보다 낮으면 검수 경고를 남긴다. */
    minEffectiveDpi: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    pageWidthMm: 210,
    pageHeightMm: 297,
    outerMarginMm: 10,
    headerMm: 16,
    footerMm: 8,
    columnGapMm: 6,
    rowGapMm: 4,
    numberGutterMm: 7,
    problemPaddingMm: 2.5,
    problemImageWidthMm: 80,
    minEffectiveDpi: 150,
};

export interface LayoutItemInput {
    seq: number;
    widthPx: number;
    heightPx: number;
}

export type LayoutPlacementKind = 'quarter';

export interface PlacedItem {
    seq: number;
    kind: LayoutPlacementKind;
    /** 페이지 좌상단 기준 문제 칸의 좌상단 위치 (mm) */
    xMm: number;
    yMm: number;
    /** 이미지 표시 크기 (mm) */
    imageWidthMm: number;
    imageHeightMm: number;
    /** 실제 출력 크기에서의 유효 해상도 */
    effectiveDpi: number;
}

export interface LayoutPage {
    items: PlacedItem[];
}

export interface LayoutWarning {
    seq: number;
    code: 'low_effective_dpi';
    detail: string;
}

export interface WorksheetLayoutResult {
    pages: LayoutPage[];
    warnings: LayoutWarning[];
}

export interface DerivedLayoutMetrics {
    contentWidthMm: number;
    contentHeightMm: number;
    columnWidthMm: number;
    rowHeightMm: number;
    contentTopMm: number;
    contentLeftMm: number;
}

export function deriveLayoutMetrics(config: LayoutConfig): DerivedLayoutMetrics {
    const contentWidthMm = config.pageWidthMm - config.outerMarginMm * 2;
    const contentHeightMm =
        config.pageHeightMm - config.outerMarginMm * 2 - config.headerMm - config.footerMm;
    return {
        contentWidthMm,
        contentHeightMm,
        columnWidthMm: (contentWidthMm - config.columnGapMm) / 2,
        rowHeightMm: (contentHeightMm - config.rowGapMm) / 2,
        contentTopMm: config.outerMarginMm + config.headerMm,
        contentLeftMm: config.outerMarginMm,
    };
}

function fitImage(
    item: LayoutItemInput,
    boxWidthMm: number,
    boxHeightMm: number,
): { widthMm: number; heightMm: number; effectiveDpi: number } {
    const mmPerPixel = Math.min(boxWidthMm / item.widthPx, boxHeightMm / item.heightPx);
    return {
        widthMm: item.widthPx * mmPerPixel,
        heightMm: item.heightPx * mmPerPixel,
        effectiveDpi: 25.4 / mmPerPixel,
    };
}

/** 문항을 좌상 → 우상 → 좌하 → 우하 순서로 네 칸에 고정 배치한다. */
export function layoutWorksheet(
    items: readonly LayoutItemInput[],
    config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): WorksheetLayoutResult {
    const metrics = deriveLayoutMetrics(config);
    const pages: LayoutPage[] = [];
    const warnings: LayoutWarning[] = [];
    const boxWidthMm = Math.min(
        config.problemImageWidthMm,
        metrics.columnWidthMm - config.numberGutterMm - config.problemPaddingMm * 2,
    );
    const boxHeightMm = metrics.rowHeightMm - config.problemPaddingMm * 2;

    for (const [index, item] of items.entries()) {
        if (item.widthPx <= 0 || item.heightPx <= 0) {
            throw new Error(`item ${item.seq} has invalid image dimensions`);
        }

        const slot = index % 4;
        if (slot === 0) pages.push({ items: [] });
        const column = slot % 2;
        const row = Math.floor(slot / 2);
        const fitted = fitImage(item, boxWidthMm, boxHeightMm);

        pages[pages.length - 1].items.push({
            seq: item.seq,
            kind: 'quarter',
            xMm: metrics.contentLeftMm
                + column * (metrics.columnWidthMm + config.columnGapMm),
            yMm: metrics.contentTopMm
                + row * (metrics.rowHeightMm + config.rowGapMm),
            imageWidthMm: fitted.widthMm,
            imageHeightMm: fitted.heightMm,
            effectiveDpi: fitted.effectiveDpi,
        });

        if (fitted.effectiveDpi < config.minEffectiveDpi) {
            warnings.push({
                seq: item.seq,
                code: 'low_effective_dpi',
                detail: `${item.seq}번 문항의 인쇄 해상도가 약 ${Math.round(fitted.effectiveDpi)} DPI입니다. 원본 이미지를 확인해 주세요.`,
            });
        }
    }

    return { pages, warnings };
}
