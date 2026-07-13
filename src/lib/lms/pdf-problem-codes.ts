export const STUDYQ_EXTERNAL_CODE_PATTERN = /(?<!\d)(\d{7})(?!\d)/gu;

export interface PdfTextItemLike {
    str: string;
    transform?: readonly number[];
    width?: number;
    height?: number;
}

export interface PdfTextPageLike {
    pageNumber: number;
    width: number;
    height?: number;
    items: readonly PdfTextItemLike[];
}

export interface PdfProblemCodeBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ExtractedPdfProblemCode {
    externalCode: string;
    page: number;
    x: number;
    y: number;
    column: number;
    bbox?: PdfProblemCodeBoundingBox | null;
}

interface PositionedTextItem {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PdfDocumentTextPageLike {
    pageNumber: number;
    text: string;
}

export interface PdfAnswerDocumentAssessment {
    blocked: boolean;
    evidence: string[];
    keywordCount: number;
    answerRowCount: number;
}

export interface PdfScannedAnswerLayoutAssessment {
    blocked: boolean;
    evidence: string[];
    pairCount: number;
    answerLikeLineCount: number;
    relevantLineCount: number;
    longLineCount: number;
    narrativeLineCount: number;
    compactCodeAnswerLineCount: number;
    compactCodePageCount: number;
}

export interface PdfPageCodeExtractionPlan {
    textCodes: ExtractedPdfProblemCode[];
    ocrPages: PdfTextPageLike[];
}

function normalizeDigits(value: string): string {
    return value.replace(/[０-９]/gu, (digit) => String(digit.charCodeAt(0) - 0xff10));
}

export function findStudyqExternalCodes(value: string): string[] {
    return [...normalizeDigits(value).matchAll(STUDYQ_EXTERNAL_CODE_PATTERN)].map((match) => match[1]);
}

function positionOf(item: PdfTextItemLike): { x: number; y: number; width: number; height: number } {
    const transform = item.transform;
    return {
        x: typeof transform?.[4] === 'number' ? transform[4] : 0,
        y: typeof transform?.[5] === 'number' ? transform[5] : 0,
        width: typeof item.width === 'number' && item.width > 0 ? item.width : 1,
        height: typeof item.height === 'number' && item.height > 0 ? item.height : 1,
    };
}

function rowKey(y: number): number {
    return Math.round(y / 4) * 4;
}

function numericFragmentWidth(item: PositionedTextItem): number {
    const digitCount = Math.max(1, item.text.replace(/\D/gu, '').length);
    return item.width / digitCount;
}

function fragmentsAreAdjacent(left: PositionedTextItem, right: PositionedTextItem): boolean {
    const gap = right.x - (left.x + left.width);
    const characterWidth = Math.max(numericFragmentWidth(left), numericFragmentWidth(right));
    return gap <= Math.max(4, Math.min(24, characterWidth * 2.5));
}

function codeKey(code: ExtractedPdfProblemCode): string {
    return `${code.page}:${Math.round(code.x)}:${Math.round(code.y)}:${code.externalCode}`;
}

function codesFromPage(page: PdfTextPageLike): ExtractedPdfProblemCode[] {
    const items: PositionedTextItem[] = page.items
        .map((item) => ({ text: normalizeDigits(item.str), ...positionOf(item) }))
        .filter((item) => item.text.trim().length > 0);
    const found: ExtractedPdfProblemCode[] = [];
    const physicalMatches = new Set<string>();

    const add = (externalCode: string, item: PositionedTextItem) => {
        const match: ExtractedPdfProblemCode = {
            externalCode,
            page: page.pageNumber,
            x: item.x,
            y: item.y,
            column: page.width > 0 && item.x >= page.width / 2 ? 1 : 0,
            bbox: {
                x: item.x,
                y: Math.max(0, (page.height ?? 0) - item.y - item.height),
                width: item.width,
                height: item.height,
            },
        };
        const key = codeKey(match);
        if (!physicalMatches.has(key)) {
            physicalMatches.add(key);
            found.push(match);
        }
    };

    for (const item of items) {
        for (const externalCode of findStudyqExternalCodes(item.text)) add(externalCode, item);
    }

    const rows = new Map<number, PositionedTextItem[]>();
    for (const item of items) {
        const key = rowKey(item.y);
        const row = rows.get(key) ?? [];
        row.push(item);
        rows.set(key, row);
    }

    for (const row of rows.values()) {
        row.sort((left, right) => left.x - right.x);
        for (let start = 0; start < row.length; start += 1) {
            let digits = '';
            for (let end = start; end < Math.min(start + 4, row.length); end += 1) {
                if (end > start && !fragmentsAreAdjacent(row[end - 1], row[end])) break;
                const fragment = row[end].text.replace(/\D/gu, '');
                if (!fragment || fragment.length > 7) break;
                digits += fragment;
                if (digits.length === 7) {
                    const last = row[end];
                    add(digits, {
                        ...row[start],
                        width: Math.max(row[start].width, last.x + last.width - row[start].x),
                        height: Math.max(...row.slice(start, end + 1).map((entry) => entry.height)),
                    });
                    break;
                }
                if (digits.length > 7) break;
            }
        }
    }

    return found.sort((left, right) => (
        left.column - right.column
        || right.y - left.y
        || left.x - right.x
    ));
}

export function extractOrderedStudyqCodes(pages: readonly PdfTextPageLike[]): ExtractedPdfProblemCode[] {
    return [...pages]
        .sort((left, right) => left.pageNumber - right.pageNumber)
        .flatMap(codesFromPage);
}

/** Plans OCR per page so mixed text/scanned PDFs do not lose scanned-page codes. */
export function planPdfPageCodeExtraction(
    pages: readonly PdfTextPageLike[],
): PdfPageCodeExtractionPlan {
    const orderedPages = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
    const textCodes: ExtractedPdfProblemCode[] = [];
    const ocrPages: PdfTextPageLike[] = [];
    for (const page of orderedPages) {
        const pageCodes = extractOrderedStudyqCodes([page]);
        if (pageCodes.length > 0) textCodes.push(...pageCodes);
        else ocrPages.push(page);
    }
    return { textCodes, ocrPages };
}

export function duplicateStudyqCodes(codes: readonly ExtractedPdfProblemCode[]): string[] {
    const counts = new Map<string, number>();
    for (const code of codes) counts.set(code.externalCode, (counts.get(code.externalCode) ?? 0) + 1);
    return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([code]) => code)
        .sort();
}

const STRONG_ANSWER_HEADING_PATTERN = /(?:^|\n)\s*(?:(?:빠른\s*)?정답\s*(?:(?:및|과|·|&)\s*해설)?|정답\s*해설|해설\s*정답|answer\s*key|answers?\s*(?:(?:and|&)\s*)?solutions?|solutions?)\s*(?:$|\n)/gimu;
const ANSWER_KEYWORD_PATTERN = /정답|해설|답지|answer\s*key|answers?|solutions?/gimu;
const ANSWER_ROW_PATTERN = /^\s*(?:\d{1,3}|[①-⑳])\s*[.)]?\s*(?:[①-⑤]|[1-5](?!\d)|[-+]?\d+(?:[./]\d+)?)\s*(?:[,;|]|\s{2,}|$)/u;

/**
 * Detects answer/solution documents conservatively. A standalone answer heading is
 * sufficient; otherwise answer keywords must be accompanied by a dense answer-key
 * shape so ordinary questions containing the word "정답" are not rejected.
 */
export function assessPdfDocumentText(
    pages: readonly PdfDocumentTextPageLike[],
): PdfAnswerDocumentAssessment {
    const text = pages
        .map((page) => page.text.normalize('NFC').slice(0, 20_000))
        .join('\n');
    const strongHeadings = [...text.matchAll(STRONG_ANSWER_HEADING_PATTERN)].length;
    const keywordCount = [...text.matchAll(ANSWER_KEYWORD_PATTERN)].length;
    const answerRowCount = text
        .split(/\r?\n/gu)
        .filter((line) => ANSWER_ROW_PATTERN.test(line))
        .length;
    const evidence: string[] = [];
    if (strongHeadings > 0) evidence.push('answer_heading');
    if (keywordCount >= 2 && answerRowCount >= 5) evidence.push('answer_key_layout');
    return {
        blocked: evidence.length > 0,
        evidence,
        keywordCount,
        answerRowCount,
    };
}

const ANSWER_PAIR_PATTERN = /(?:^|\s)(?:\d{1,3}|[①-⑳])(?:\s*[.)\-:]\s*|\s+)(?:[①-⑤]|[OXox]|[가-마]|[-+]?\d+(?:[./]\d+)?)(?=\s|$|[,;|])/gu;
const PAGE_MARKER_PATTERN = /^\s*-?\s*\d{1,3}\s*-?\s*$/u;
const SOURCE_CODE_IN_LINE_PATTERN = /(?<!\d)\d{7}(?!\d)/gu;

/**
 * Conservatively identifies a compact answer-key grid in OCR text. It requires
 * many short question-answer pairs and rejects narrative-heavy worksheet pages.
 */
export function assessScannedAnswerLayout(
    pages: readonly PdfDocumentTextPageLike[],
): PdfScannedAnswerLayoutAssessment {
    const lines = pages
        .flatMap((page) => page.text.normalize('NFC').split(/\r?\n/gu))
        .map((line) => line.replace(/\s+/gu, ' ').trim())
        .filter((line) => line.length > 0 && !PAGE_MARKER_PATTERN.test(line));
    let pairCount = 0;
    let answerLikeLineCount = 0;
    let longLineCount = 0;
    let narrativeLineCount = 0;
    let compactCodeAnswerLineCount = 0;
    for (const line of lines) {
        const linePairs = [...line.matchAll(ANSWER_PAIR_PATTERN)].length;
        pairCount += linePairs;
        if (linePairs >= 2 || (linePairs === 1 && line.length <= 28)) answerLikeLineCount += 1;
        if (line.length >= 36) longLineCount += 1;
        if ((line.match(/[A-Za-z가-힣]/gu)?.length ?? 0) >= 12) narrativeLineCount += 1;
        const sourceCodes = [...line.matchAll(SOURCE_CODE_IN_LINE_PATTERN)];
        if (sourceCodes.length > 0 && line.length <= 32) {
            const residualLength = line
                .replace(SOURCE_CODE_IN_LINE_PATTERN, '')
                .replace(/[^A-Za-z가-힣0-9①-⑤]/gu, '')
                .length;
            if (residualLength >= 1 && residualLength <= 12) compactCodeAnswerLineCount += sourceCodes.length;
        }
    }
    const density = lines.length > 0 ? answerLikeLineCount / lines.length : 0;
    const longDensity = lines.length > 0 ? longLineCount / lines.length : 0;
    const narrativeDensity = lines.length > 0 ? narrativeLineCount / lines.length : 0;
    const compactCodePageCount = pages.filter((page) => {
        const compactLines = page.text
            .normalize('NFC')
            .split(/\r?\n/gu)
            .map((line) => line.replace(/\s+/gu, ' ').trim())
            .filter((line) => {
                if (line.length === 0 || line.length > 32) return false;
                const sourceCodes = [...line.matchAll(SOURCE_CODE_IN_LINE_PATTERN)];
                if (sourceCodes.length === 0) return false;
                const residualLength = line
                    .replace(SOURCE_CODE_IN_LINE_PATTERN, '')
                    .replace(/[^A-Za-z가-힣0-9①-⑤]/gu, '')
                    .length;
                return residualLength >= 1 && residualLength <= 12;
            }).length;
        return compactLines >= 8;
    }).length;
    const pairLayoutBlocked = pairCount >= 18
        && answerLikeLineCount >= 10
        && density >= 0.45
        && longDensity <= 0.2;
    const compactCodeDensity = lines.length > 0 ? compactCodeAnswerLineCount / lines.length : 0;
    const compactCodeLayoutBlocked = compactCodeAnswerLineCount >= Math.max(12, pages.length * 8)
        && compactCodePageCount >= Math.min(2, pages.length)
        && compactCodeDensity >= 0.38
        && narrativeDensity <= 0.2
        && longDensity <= 0.2;
    const blocked = pairLayoutBlocked || compactCodeLayoutBlocked;
    return {
        blocked,
        evidence: [
            ...(pairLayoutBlocked ? ['scanned_answer_key_layout'] : []),
            ...(compactCodeLayoutBlocked ? ['scanned_compact_code_answer_layout'] : []),
        ],
        pairCount,
        answerLikeLineCount,
        relevantLineCount: lines.length,
        longLineCount,
        narrativeLineCount,
        compactCodeAnswerLineCount,
        compactCodePageCount,
    };
}

/** Limits expensive OCR to pages whose searchable layer is effectively image-only. */
export function needsScannedAnswerOcr(
    pages: readonly PdfDocumentTextPageLike[],
    pageLimit = 3,
): boolean {
    const searchableLetters = pages
        .slice(0, pageLimit)
        .map((page) => page.text.replace(/\d{7}/gu, ''))
        .join('')
        .match(/[A-Za-z가-힣]/gu)?.length ?? 0;
    return searchableLetters < 120;
}

/** Parses teacher-entered lines in `page: 1234567` form, retaining PDF order. */
export function parseManualStudyqCodes(
    value: string,
    pageCount: number,
): ExtractedPdfProblemCode[] {
    if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw new Error('PDF 페이지 수를 먼저 확인해야 합니다.');
    }
    const lines = value.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error('7자리 문항코드를 한 줄에 하나씩 입력하세요.');
    return lines.map((line, index) => {
        const withPage = line.match(/^(\d{1,3})\s*[:：,\t ]\s*(\d{7})$/u);
        const codeOnly = line.match(/^(\d{7})$/u);
        if (!withPage && !(codeOnly && pageCount === 1)) {
            throw new Error(`${index + 1}번째 줄을 "페이지: 7자리 코드" 형식으로 입력하세요.`);
        }
        const page = withPage ? Number(withPage[1]) : 1;
        const externalCode = withPage?.[2] ?? codeOnly?.[1] ?? '';
        if (page < 1 || page > pageCount) {
            throw new Error(`${index + 1}번째 줄의 페이지가 PDF 범위를 벗어났습니다.`);
        }
        return {
            externalCode,
            page,
            x: 0,
            y: 0,
            column: 0,
            bbox: null,
        };
    });
}
