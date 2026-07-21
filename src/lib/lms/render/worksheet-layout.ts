/**
 * A4 세로 2단 조판. 짧은 문항은 한 단에 2개, 세로로 긴 문항은 한 단 전체를
 * 사용한다. 원본 픽셀 수나 DPI는 지면 크기가 아니라 해상도이므로 배치 결정에
 * 사용하지 않는다.
 */

export interface LayoutConfig {
    pageWidthMm: number;
    pageHeightMm: number;
    outerMarginMm: number;
    headerMm: number;
    footerMm: number;
    columnGapMm: number;
    rowGapMm: number;
    /** 문제 번호를 위한 단 왼쪽 여백 */
    numberGutterMm: number;
    /** 각 문제 영역 안쪽의 상하좌우 여백 */
    problemPaddingMm: number;
    /** 공통 글자 배율을 결정하는 문제 이미지 최대 너비 */
    problemImageWidthMm: number;
    /** 세로/가로 비율이 이 값 이상이면 한 단 전체를 사용한다. */
    fullColumnHeightToWidthRatio: number;
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
    fullColumnHeightToWidthRatio: 0.9,
    minEffectiveDpi: 150,
};

export interface LayoutItemInput {
    seq: number;
    widthPx: number;
    heightPx: number;
    /** 외곽 여백을 제외한 실제 문항 내용의 세로/가로 비율 */
    contentHeightToWidthRatio?: number;
}

export type LayoutPlacementKind = 'half_column' | 'full_column';

export interface PlacedItem {
    seq: number;
    kind: LayoutPlacementKind;
    /** 페이지 좌상단 기준 라벨 포함 영역의 좌상단 위치 (mm) */
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

interface Derived {
    contentWidthMm: number;
    contentHeightMm: number;
    columnWidthMm: number;
    rowHeightMm: number;
    contentTopMm: number;
    contentLeftMm: number;
}

export function deriveLayoutMetrics(config: LayoutConfig): Derived {
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

/**
 * 문항을 왼쪽 단 위에서 아래로, 이어서 오른쪽 단 위에서 아래로 배치한다.
 * 짧은 문항은 반 단, 세로로 긴 문항은 한 단을 차지하므로 한 페이지에는
 * 마지막 페이지를 제외하고 2~4문항이 들어간다.
 */
export function layoutWorksheet(
    items: readonly LayoutItemInput[],
    config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): WorksheetLayoutResult {
    const metrics = deriveLayoutMetrics(config);
    const pages: LayoutPage[] = [];
    const warnings: LayoutWarning[] = [];

    let page: LayoutPage = { items: [] };
    let column = 0;
    let occupiedHalfRows = 0;

    const flushPage = () => {
        if (page.items.length > 0) {
            pages.push(page);
            page = { items: [] };
        }
        column = 0;
        occupiedHalfRows = 0;
    };

    const advanceColumn = () => {
        column += 1;
        occupiedHalfRows = 0;
        if (column >= 2) flushPage();
    };

    const columnX = () =>
        metrics.contentLeftMm + column * (metrics.columnWidthMm + config.columnGapMm);

    for (const item of items) {
        if (item.widthPx <= 0 || item.heightPx <= 0) {
            throw new Error(`item ${item.seq} has invalid image dimensions`);
        }

        const usesFullColumn =
            (item.contentHeightToWidthRatio ?? item.heightPx / item.widthPx)
                >= config.fullColumnHeightToWidthRatio;

        if (usesFullColumn && occupiedHalfRows > 0) advanceColumn();
        if (column >= 2) flushPage();

        const kind: LayoutPlacementKind = usesFullColumn ? 'full_column' : 'half_column';
        const boxHeightMm = usesFullColumn
            ? metrics.contentHeightMm - config.problemPaddingMm * 2
            : metrics.rowHeightMm - config.problemPaddingMm * 2;
        const fitted = fitImage(
            item,
            Math.min(
                config.problemImageWidthMm,
                metrics.columnWidthMm - config.numberGutterMm - config.problemPaddingMm * 2,
            ),
            boxHeightMm,
        );
        const yMm = usesFullColumn
            ? metrics.contentTopMm
            : metrics.contentTopMm + occupiedHalfRows * (metrics.rowHeightMm + config.rowGapMm);

        page.items.push({
            seq: item.seq,
            kind,
            xMm: columnX(),
            yMm,
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

        if (usesFullColumn) {
            advanceColumn();
        } else {
            occupiedHalfRows += 1;
            if (occupiedHalfRows >= 2) advanceColumn();
        }
    }

    flushPage();
    return { pages, warnings };
}
