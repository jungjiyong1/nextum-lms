import fontkit from 'pdf-fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import {
    DEFAULT_LAYOUT_CONFIG,
    deriveLayoutMetrics,
    type LayoutConfig,
    type WorksheetLayoutResult,
} from './worksheet-layout';

const MM_TO_PT = 72 / 25.4;
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.45, 0.45, 0.45);
const DIVIDER_GRAY = rgb(0.72, 0.72, 0.72);
// 재렌더 시 바이트가 흔들리지 않도록 문서 시각 메타데이터를 고정한다.
const FIXED_DOCUMENT_DATE = new Date('2026-01-01T00:00:00.000Z');

export interface WorksheetPdfFonts {
    regular: Uint8Array;
    bold: Uint8Array;
}

export interface StudentPdfHeader {
    academyName: string;
    title: string;
    studentName: string;
    dateLabel: string;
    versionCode: string;
}

export interface StudentPdfItemImage {
    seq: number;
    png: Uint8Array;
}

export interface ComposeStudentPdfInput {
    header: StudentPdfHeader;
    layout: WorksheetLayoutResult;
    images: readonly StudentPdfItemImage[];
    fonts: WorksheetPdfFonts;
    config?: LayoutConfig;
}

function mm(value: number): number {
    return value * MM_TO_PT;
}

function drawHeader(
    page: PDFPage,
    header: StudentPdfHeader,
    fonts: { regular: PDFFont; bold: PDFFont },
    config: LayoutConfig,
    pageIndex: number,
    pageCount: number,
): void {
    const pageHeightPt = mm(config.pageHeightMm);
    const left = mm(config.outerMarginMm);
    const right = mm(config.pageWidthMm - config.outerMarginMm);
    const titleY = pageHeightPt - mm(config.outerMarginMm) - 12;
    const metaY = titleY - 13;

    page.drawText(header.title, { x: left, y: titleY, size: 13, font: fonts.bold, color: BLACK });
    const nameText = header.studentName;
    const nameWidth = fonts.bold.widthOfTextAtSize(nameText, 12);
    page.drawText(nameText, { x: right - nameWidth, y: titleY, size: 12, font: fonts.bold, color: BLACK });

    const meta = `${header.academyName} · ${header.dateLabel} · ${header.versionCode}`;
    page.drawText(meta, { x: left, y: metaY, size: 8, font: fonts.regular, color: GRAY });

    const separatorY = pageHeightPt - mm(config.outerMarginMm + config.headerMm) + 2;
    page.drawLine({
        start: { x: left, y: separatorY },
        end: { x: right, y: separatorY },
        thickness: 0.7,
        color: BLACK,
    });

    const footer = `${pageIndex + 1} / ${pageCount}`;
    const footerWidth = fonts.regular.widthOfTextAtSize(footer, 8);
    page.drawText(footer, {
        x: (mm(config.pageWidthMm) - footerWidth) / 2,
        y: mm(config.outerMarginMm) - 2,
        size: 8,
        font: fonts.regular,
        color: GRAY,
    });
}

/** 네 문제 영역의 경계를 한눈에 볼 수 있도록 본문 중앙에 십자 분할선을 그린다. */
function drawQuadrantDividers(page: PDFPage, config: LayoutConfig): void {
    const metrics = deriveLayoutMetrics(config);
    const pageHeightPt = mm(config.pageHeightMm);
    const left = mm(metrics.contentLeftMm);
    const right = mm(metrics.contentLeftMm + metrics.contentWidthMm);
    const top = pageHeightPt - mm(metrics.contentTopMm);
    const bottom = pageHeightPt - mm(metrics.contentTopMm + metrics.contentHeightMm);
    const centerX = mm(metrics.contentLeftMm + metrics.contentWidthMm / 2);
    const centerY = pageHeightPt - mm(metrics.contentTopMm + metrics.contentHeightMm / 2);

    page.drawLine({
        start: { x: centerX, y: bottom },
        end: { x: centerX, y: top },
        thickness: 0.6,
        color: DIVIDER_GRAY,
    });
    page.drawLine({
        start: { x: left, y: centerY },
        end: { x: right, y: centerY },
        thickness: 0.6,
        color: DIVIDER_GRAY,
    });
}

/**
 * 조판 결과와 정규화된 이미지로 학생용 PDF를 합성한다. 지면에는 학원명,
 * 과제명, 학생명, 날짜, 버전 코드, 문제 번호만 표시한다 — 외부 출처 코드나
 * DB 식별자는 노출하지 않는다.
 */
export async function composeStudentPdf(input: ComposeStudentPdfInput): Promise<Uint8Array> {
    const config = input.config ?? DEFAULT_LAYOUT_CONFIG;
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    document.setCreationDate(FIXED_DOCUMENT_DATE);
    document.setModificationDate(FIXED_DOCUMENT_DATE);
    document.setTitle(input.header.title);

    const regular = await document.embedFont(input.fonts.regular, { subset: true });
    const bold = await document.embedFont(input.fonts.bold, { subset: true });
    const imagesBySeq = new Map(input.images.map((image) => [image.seq, image.png]));
    const pageHeightPt = mm(config.pageHeightMm);
    const pageCount = input.layout.pages.length;

    for (const [pageIndex, layoutPage] of input.layout.pages.entries()) {
        const page = document.addPage([mm(config.pageWidthMm), mm(config.pageHeightMm)]);
        drawHeader(page, input.header, { regular, bold }, config, pageIndex, pageCount);
        drawQuadrantDividers(page, config);

        for (const item of layoutPage.items) {
            const png = imagesBySeq.get(item.seq);
            if (!png) throw new Error(`item ${item.seq} is missing a normalized image`);
            const embedded = await document.embedPng(png);

            const itemTopMm = item.yMm + config.problemPaddingMm;
            const itemLeftMm = item.xMm + config.problemPaddingMm;
            const labelBaselineY = pageHeightPt - mm(itemTopMm) - 10;
            page.drawText(`${item.seq}.`, {
                x: mm(itemLeftMm),
                y: labelBaselineY,
                size: 11,
                font: bold,
                color: BLACK,
            });

            page.drawImage(embedded, {
                x: mm(itemLeftMm + config.numberGutterMm),
                y: pageHeightPt - mm(itemTopMm) - mm(item.imageHeightMm),
                width: mm(item.imageWidthMm),
                height: mm(item.imageHeightMm),
            });
        }
    }

    return document.save();
}

export interface AnswerKeyEntry {
    seq: number;
    answerText: string;
    challengeBand: number | null;
    skillName: string | null;
    role: string;
}

export interface ComposeAnswerKeyInput {
    academyName: string;
    title: string;
    studentName: string;
    dateLabel: string;
    versionCode: string;
    entries: readonly AnswerKeyEntry[];
    fonts: WorksheetPdfFonts;
    config?: LayoutConfig;
}

const ROLE_LABELS: Record<string, string> = {
    verification: '확인',
    practice: '연습',
    review: '복습',
    exam_prep: '시험대비',
    teacher_added: '직접추가',
};

/** answer_snapshot jsonb를 정답지 표기 문자열로 바꾼다. */
export function formatAnswerText(snapshot: unknown): string {
    if (snapshot == null) return '-';
    if (typeof snapshot === 'string' || typeof snapshot === 'number') return String(snapshot);
    if (typeof snapshot === 'object' && !Array.isArray(snapshot)) {
        const record = snapshot as Record<string, unknown>;
        const subs = record.subs;
        if (Array.isArray(subs) && subs.length > 0) {
            return subs
                .map((sub, index) => {
                    const entry = (sub ?? {}) as Record<string, unknown>;
                    const label = typeof entry.label === 'string' && entry.label.trim()
                        ? entry.label
                        : `${index + 1})`;
                    const value = entry.value == null ? '-' : String(entry.value);
                    return `${label} ${value}`;
                })
                .join('  ');
        }
        if (record.value != null) return String(record.value);
    }
    return '-';
}

/** 교사용 정답지. 학생용과 같은 버전 코드로 매칭한다. */
export async function composeAnswerKeyPdf(input: ComposeAnswerKeyInput): Promise<Uint8Array> {
    const config = input.config ?? DEFAULT_LAYOUT_CONFIG;
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    document.setCreationDate(FIXED_DOCUMENT_DATE);
    document.setModificationDate(FIXED_DOCUMENT_DATE);
    document.setTitle(`${input.title} 정답지`);

    const regular = await document.embedFont(input.fonts.regular, { subset: true });
    const bold = await document.embedFont(input.fonts.bold, { subset: true });

    const left = mm(config.outerMarginMm);
    const lineHeight = 16;
    const topStart = mm(config.pageHeightMm - config.outerMarginMm) - 14;
    const bottomLimit = mm(config.outerMarginMm + config.footerMm);

    let page = document.addPage([mm(config.pageWidthMm), mm(config.pageHeightMm)]);
    page.drawText(`${input.title} — 정답지 (교사용)`, {
        x: left, y: topStart, size: 13, font: bold, color: BLACK,
    });
    page.drawText(
        `${input.academyName} · ${input.studentName} · ${input.dateLabel} · ${input.versionCode}`,
        { x: left, y: topStart - 14, size: 8, font: regular, color: GRAY },
    );

    let y = topStart - 36;
    for (const entry of input.entries) {
        if (y < bottomLimit) {
            page = document.addPage([mm(config.pageWidthMm), mm(config.pageHeightMm)]);
            y = topStart;
        }
        const parts = [
            entry.challengeBand === null ? null : `난이도 ${entry.challengeBand}`,
            ROLE_LABELS[entry.role] ?? entry.role,
            entry.skillName,
        ].filter(Boolean).join(' · ');

        page.drawText(`${entry.seq}.`, { x: left, y, size: 10, font: bold, color: BLACK });
        page.drawText(entry.answerText, { x: left + 22, y, size: 10, font: regular, color: BLACK });
        if (parts) {
            page.drawText(parts, { x: left + 220, y, size: 8, font: regular, color: GRAY });
        }
        y -= lineHeight;
    }

    return document.save();
}
