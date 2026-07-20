/**
 * 4문제/페이지 고정 조판 (A4 세로, 2열 × 2행). 복잡한 패킹은 하지 않는다.
 * 문항 순서는 항상 유지되고, 빈 셀은 풀이 공간으로 남는다.
 * 모든 치수는 밀리미터. PDF 포인트 변환은 합성 단계에서 한다.
 */

export interface LayoutConfig {
    pageWidthMm: number;
    pageHeightMm: number;
    outerMarginMm: number;
    headerMm: number;
    footerMm: number;
    columnGapMm: number;
    rowGapMm: number;
    /** 문제 번호 라벨 영역 높이 */
    labelMm: number;
    /** 원본 대비 최대 확대 배율 */
    maxScale: number;
    /** 이 축소율 미만이면 검수 경고 */
    minScaleWarning: number;
    /** 이 비율 이상이면 전폭 배치 */
    fullWidthAspectRatio: number;
    /** 치수 정보가 없는 이미지에 가정하는 DPI */
    fallbackDpi: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    pageWidthMm: 210,
    pageHeightMm: 297,
    outerMarginMm: 10,
    headerMm: 16,
    footerMm: 8,
    columnGapMm: 6,
    rowGapMm: 4,
    labelMm: 6,
    maxScale: 1.25,
    minScaleWarning: 0.7,
    fullWidthAspectRatio: 1.6,
    fallbackDpi: 150,
};

export interface LayoutItemInput {
    seq: number;
    widthPx: number;
    heightPx: number;
    dpi?: number | null;
}

export type LayoutPlacementKind = 'cell' | 'full_width' | 'own_page';

export interface PlacedItem {
    seq: number;
    kind: LayoutPlacementKind;
    /** 페이지 좌상단 기준 위치 (mm) — 라벨 포함 영역의 좌상단 */
    xMm: number;
    yMm: number;
    /** 이미지 표시 크기 (mm) */
    imageWidthMm: number;
    imageHeightMm: number;
    /** 원본 논리 크기 대비 배율 */
    scale: number;
    scaleWarning: boolean;
}

export interface LayoutPage {
    items: PlacedItem[];
}

export interface LayoutWarning {
    seq: number;
    code: 'scale_below_minimum';
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

function naturalSizeMm(item: LayoutItemInput, config: LayoutConfig): { width: number; height: number } {
    const dpi = item.dpi && item.dpi > 0 ? item.dpi : config.fallbackDpi;
    return {
        width: (item.widthPx / dpi) * 25.4,
        height: (item.heightPx / dpi) * 25.4,
    };
}

function fitInto(
    natural: { width: number; height: number },
    boxWidth: number,
    boxHeight: number,
    maxScale: number,
): { width: number; height: number; scale: number } {
    const scale = Math.min(boxWidth / natural.width, boxHeight / natural.height, maxScale);
    return { width: natural.width * scale, height: natural.height * scale, scale };
}

/**
 * 문항 이미지들을 페이지에 배치한다. 규칙:
 * - 기본 2열 × 2행 고정 셀.
 * - 가로세로 비율이 기준 이상이면 전폭 행(그 페이지는 3문항이 된다).
 * - 전폭으로도 행 높이에서 기준 축소율 미만이 되는 초대형 문항은 단독 페이지.
 * - 문항은 절대 분할하지 않고, 순서를 유지하며, 빈 셀은 채우지 않는다.
 */
export function layoutWorksheet(
    items: readonly LayoutItemInput[],
    config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): WorksheetLayoutResult {
    const metrics = deriveLayoutMetrics(config);
    const pages: LayoutPage[] = [];
    const warnings: LayoutWarning[] = [];

    let page: LayoutPage = { items: [] };
    // slot: 0=좌상, 1=우상, 2=좌하, 3=우하. 행 단위 점유 관리.
    let slot = 0;

    const flushPage = () => {
        if (page.items.length > 0) {
            pages.push(page);
            page = { items: [] };
        }
        slot = 0;
    };

    const cellImageHeight = metrics.rowHeightMm - config.labelMm;
    const columnX = (column: number) =>
        metrics.contentLeftMm + column * (metrics.columnWidthMm + config.columnGapMm);
    const rowY = (row: number) => metrics.contentTopMm + row * (metrics.rowHeightMm + config.rowGapMm);

    for (const item of items) {
        if (item.widthPx <= 0 || item.heightPx <= 0) {
            throw new Error(`item ${item.seq} has invalid image dimensions`);
        }
        const natural = naturalSizeMm(item, config);
        const aspect = item.widthPx / item.heightPx;
        const inCell = fitInto(natural, metrics.columnWidthMm, cellImageHeight, config.maxScale);
        // 넓은 이미지뿐 아니라 셀에서 기준 미만으로 줄어드는 문항도 전폭으로 승격한다.
        const wantsFullWidth =
            aspect >= config.fullWidthAspectRatio || inCell.scale < config.minScaleWarning;

        if (wantsFullWidth) {
            const inRow = fitInto(
                natural,
                metrics.contentWidthMm,
                cellImageHeight,
                config.maxScale,
            );
            if (inRow.scale < config.minScaleWarning) {
                // 전폭 행으로도 너무 줄어드는 초대형 문항은 단독 페이지에 놓는다.
                flushPage();
                const alone = fitInto(
                    natural,
                    metrics.contentWidthMm,
                    metrics.contentHeightMm - config.labelMm,
                    config.maxScale,
                );
                const scaleWarning = alone.scale < config.minScaleWarning;
                if (scaleWarning) {
                    warnings.push({
                        seq: item.seq,
                        code: 'scale_below_minimum',
                        detail: `${item.seq}번 문항이 단독 페이지에서도 원본의 ${Math.round(alone.scale * 100)}%로 축소됩니다.`,
                    });
                }
                page.items.push({
                    seq: item.seq,
                    kind: 'own_page',
                    xMm: metrics.contentLeftMm,
                    yMm: metrics.contentTopMm,
                    imageWidthMm: alone.width,
                    imageHeightMm: alone.height,
                    scale: alone.scale,
                    scaleWarning,
                });
                flushPage();
                continue;
            }

            // 전폭 문항은 새 행이 필요하다. 현재 행이 부분 점유면 그 행의 남은 셀은 빈다.
            if (slot % 2 === 1) slot += 1;
            if (slot >= 4) flushPage();
            const row = Math.floor(slot / 2);
            page.items.push({
                seq: item.seq,
                kind: 'full_width',
                xMm: metrics.contentLeftMm,
                yMm: rowY(row),
                imageWidthMm: inRow.width,
                imageHeightMm: inRow.height,
                scale: inRow.scale,
                scaleWarning: false,
            });
            slot += 2;
            if (slot >= 4) flushPage();
            continue;
        }

        if (slot >= 4) flushPage();
        const row = Math.floor(slot / 2);
        const column = slot % 2;
        page.items.push({
            seq: item.seq,
            kind: 'cell',
            xMm: columnX(column),
            yMm: rowY(row),
            imageWidthMm: inCell.width,
            imageHeightMm: inCell.height,
            scale: inCell.scale,
            scaleWarning: inCell.scale < config.minScaleWarning,
        });
        slot += 1;
    }

    flushPage();
    return { pages, warnings };
}
