import { describe, expect, it } from 'vitest';
import {
    assessPdfDocumentText,
    assessScannedAnswerLayout,
    duplicateStudyqCodes,
    extractOrderedStudyqCodes,
    findStudyqExternalCodes,
    parseManualStudyqCodes,
    planPdfPageCodeExtraction,
    needsScannedAnswerOcr,
} from './pdf-problem-codes';

describe('PDF StudyQ problem code extraction', () => {
    it('finds bounded seven-digit and full-width codes', () => {
        expect(findStudyqExternalCodes('문항 1234567 / １２３４５６８ / 9912345670')).toEqual(['1234567', '1234568']);
    });

    it('orders page content by left column then right column', () => {
        const codes = extractOrderedStudyqCodes([{
            pageNumber: 1,
            width: 600,
            items: [
                { str: '3333333', transform: [1, 0, 0, 1, 420, 700] },
                { str: '2222222', transform: [1, 0, 0, 1, 80, 400] },
                { str: '1111111', transform: [1, 0, 0, 1, 80, 700] },
            ],
        }]);

        expect(codes.map((item) => item.externalCode)).toEqual(['1111111', '2222222', '3333333']);
    });

    it('joins a code split into adjacent text items and preserves physical duplicates', () => {
        const codes = extractOrderedStudyqCodes([{
            pageNumber: 2,
            width: 600,
            items: [
                { str: '123', width: 21, transform: [1, 0, 0, 1, 80, 700] },
                { str: '4567', width: 28, transform: [1, 0, 0, 1, 105, 700] },
                { str: '1234567', transform: [1, 0, 0, 1, 80, 400] },
            ],
        }]);

        expect(codes.map((item) => item.externalCode)).toEqual(['1234567', '1234567']);
        expect(duplicateStudyqCodes(codes)).toEqual(['1234567']);
    });

    it('does not synthesize a code from unrelated same-row digit fragments', () => {
        const codes = extractOrderedStudyqCodes([{
            pageNumber: 1,
            width: 600,
            items: [
                { str: '123', width: 21, transform: [1, 0, 0, 1, 80, 700] },
                { str: '4567', width: 28, transform: [1, 0, 0, 1, 300, 700] },
            ],
        }]);

        expect(codes).toEqual([]);
    });

    it('plans OCR only for code-empty pages in a mixed text/scanned PDF', () => {
        const plan = planPdfPageCodeExtraction([
            { pageNumber: 1, width: 600, items: [{ str: '1111111', transform: [1, 0, 0, 1, 80, 700] }] },
            { pageNumber: 2, width: 600, items: [] },
            { pageNumber: 3, width: 600, items: [{ str: '3333333', transform: [1, 0, 0, 1, 80, 700] }] },
        ]);

        expect(plan.textCodes.map((code) => [code.page, code.externalCode])).toEqual([
            [1, '1111111'],
            [3, '3333333'],
        ]);
        expect(plan.ocrPages.map((page) => page.pageNumber)).toEqual([2]);
    });

    it('preserves a top-left bounding box from the PDF text layer', () => {
        const [code] = extractOrderedStudyqCodes([{
            pageNumber: 3,
            width: 600,
            height: 800,
            items: [{ str: '7654321', width: 42, height: 10, transform: [1, 0, 0, 1, 80, 700] }],
        }]);

        expect(code.bbox).toEqual({ x: 80, y: 90, width: 42, height: 10 });
    });

    it('lets teachers enter ordered page-aware codes when OCR finds none', () => {
        const codes = parseManualStudyqCodes('2: 1234567\n2, 1234568\n3 1234569', 3);
        expect(codes.map(({ externalCode, page, bbox }) => ({ externalCode, page, bbox }))).toEqual([
            { externalCode: '1234567', page: 2, bbox: null },
            { externalCode: '1234568', page: 2, bbox: null },
            { externalCode: '1234569', page: 3, bbox: null },
        ]);
        expect(() => parseManualStudyqCodes('1234567', 2)).toThrow('페이지: 7자리 코드');
    });

    it('blocks answer-key text characteristics without blocking ordinary questions', () => {
        expect(assessPdfDocumentText([{
            pageNumber: 1,
            text: '정답 및 해설\n1. ③\n2. 4\n3. ①',
        }]).blocked).toBe(true);
        expect(assessPdfDocumentText([{
            pageNumber: 1,
            text: '다음 방정식의 정답을 구하여라.\n1. x + 2 = 5',
        }]).blocked).toBe(false);
    });

    it('detects only high-density compact scanned answer layouts', () => {
        const answerLines = Array.from({ length: 20 }, (_, index) => `${index + 1}. ${(index % 5) + 1}`).join('\n');
        const worksheetLines = Array.from(
            { length: 20 },
            (_, index) => `${index + 1}. 다음 조건을 만족하는 식의 값을 구하고 풀이 과정을 자세히 쓰시오.`,
        ).join('\n');

        expect(assessScannedAnswerLayout([{ pageNumber: 1, text: answerLines }])).toMatchObject({
            blocked: true,
            pairCount: 20,
        });
        expect(assessScannedAnswerLayout([{ pageNumber: 1, text: worksheetLines }]).blocked).toBe(false);
        expect(assessScannedAnswerLayout([{
            pageNumber: 1,
            text: Array.from({ length: 30 }, (_, index) => String(1_000_000 + index)).join('\n'),
        }]).blocked).toBe(false);

        const compactCodeAnswerPages = [1, 2].map((pageNumber) => ({
            pageNumber,
            text: Array.from(
                { length: 10 },
                (_, index) => `${1_400_000 + pageNumber * 100 + index} [${(index % 5) + 1}]`,
            ).join('\n'),
        }));
        expect(assessScannedAnswerLayout(compactCodeAnswerPages)).toMatchObject({
            blocked: true,
            compactCodeAnswerLineCount: 20,
            compactCodePageCount: 2,
        });
    });

    it('requests limited OCR for code-only searchable layers, not text-rich PDFs', () => {
        expect(needsScannedAnswerOcr([{
            pageNumber: 1,
            text: '1234567\n2345678\n종합 테스트',
        }])).toBe(true);
        expect(needsScannedAnswerOcr([{
            pageNumber: 1,
            text: '다음 조건을 만족하는 수학 문제를 풀고 풀이 과정을 작성하시오. '.repeat(8),
        }])).toBe(false);
    });
});
