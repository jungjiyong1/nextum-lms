'use client';

import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Block, Line, Word } from 'tesseract.js';
import {
    assessPdfDocumentText,
    findStudyqExternalCodes,
    planPdfPageCodeExtraction,
    type ExtractedPdfProblemCode,
    type PdfAnswerDocumentAssessment,
    type PdfTextPageLike,
} from './pdf-problem-codes';

export interface PdfCodeExtractionResult {
    pageCount: number;
    codes: ExtractedPdfProblemCode[];
    method: 'text_layer' | 'numbers_ocr' | 'hybrid' | 'none';
    answerAssessment: PdfAnswerDocumentAssessment;
}

export interface PdfCodeExtractionOptions {
    maxPages?: number;
    onProgress?: (progress: { phase: 'text' | 'ocr'; page: number; pageCount: number }) => void;
}

interface OcrWordLike {
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
}

function wordsFromBlocks(blocks: Block[] | null): Array<{ line: Line; words: Word[] }> {
    if (!blocks) return [];
    return blocks.flatMap((block) => block.paragraphs.flatMap((paragraph) => (
        paragraph.lines.map((line) => ({ line, words: line.words }))
    )));
}

function ocrCodesFromBlocks(
    blocks: Block[] | null,
    pageNumber: number,
    pageWidth: number,
    pageHeight: number,
    scale: number,
): ExtractedPdfProblemCode[] {
    const result: ExtractedPdfProblemCode[] = [];
    const seen = new Set<string>();
    const add = (externalCode: string, word: OcrWordLike) => {
        const x = word.bbox.x0 / scale;
        const top = word.bbox.y0 / scale;
        const width = Math.max(1, (word.bbox.x1 - word.bbox.x0) / scale);
        const height = Math.max(1, (word.bbox.y1 - word.bbox.y0) / scale);
        const key = `${externalCode}:${Math.round(x)}:${Math.round(top)}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push({
            externalCode,
            page: pageNumber,
            x,
            y: Math.max(0, pageHeight - top - height),
            column: pageWidth > 0 && x >= pageWidth / 2 ? 1 : 0,
            bbox: { x, y: top, width, height },
        });
    };

    for (const { words } of wordsFromBlocks(blocks)) {
        const numericWords = words
            .map((word) => ({ ...word, text: word.text.replace(/\D/gu, '') }))
            .filter((word) => word.text.length > 0 && word.text.length <= 7)
            .sort((left, right) => left.bbox.x0 - right.bbox.x0);
        for (const word of numericWords) {
            for (const code of findStudyqExternalCodes(word.text)) add(code, word);
        }
        for (let start = 0; start < numericWords.length; start += 1) {
            let digits = '';
            let rightEdge = numericWords[start].bbox.x0;
            for (let end = start; end < Math.min(start + 4, numericWords.length); end += 1) {
                const word = numericWords[end];
                const averageCharacterWidth = (word.bbox.x1 - word.bbox.x0) / Math.max(1, word.text.length);
                if (end > start && word.bbox.x0 - rightEdge > Math.max(12, averageCharacterWidth * 2.5)) break;
                digits += word.text;
                rightEdge = word.bbox.x1;
                if (digits.length === 7) {
                    add(digits, {
                        ...numericWords[start],
                        bbox: {
                            ...numericWords[start].bbox,
                            x1: rightEdge,
                            y1: Math.max(...numericWords.slice(start, end + 1).map((entry) => entry.bbox.y1)),
                        },
                    });
                    break;
                }
                if (digits.length > 7) break;
            }
        }
    }
    return result.sort((left, right) => (
        left.column - right.column
        || right.y - left.y
        || left.x - right.x
    ));
}

function renderScale(width: number, height: number): number {
    const maxPixels = 2_500_000;
    return Math.max(1.25, Math.min(2, Math.sqrt(maxPixels / Math.max(1, width * height))));
}

export async function extractStudyqCodesFromPdf(
    file: File,
    options: PdfCodeExtractionOptions = {},
): Promise<PdfCodeExtractionResult> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
    ).toString();

    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
        data: bytes,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
    });
    const document = await loadingTask.promise;
    const maxPages = options.maxPages ?? 200;
    if (document.numPages < 1 || document.numPages > maxPages) {
        await loadingTask.destroy();
        throw new Error(`PDF는 ${maxPages}페이지 이하여야 합니다.`);
    }
    const pages: PdfTextPageLike[] = [];
    const textPages: Array<{ pageNumber: number; text: string }> = [];

    try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            options.onProgress?.({ phase: 'text', page: pageNumber, pageCount: document.numPages });
            const page = await document.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent();
            const textItems = content.items.filter((item): item is TextItem => 'str' in item);
            pages.push({
                pageNumber,
                width: viewport.width,
                height: viewport.height,
                items: textItems.map((item) => ({
                    str: item.str,
                    transform: item.transform,
                    width: item.width,
                    height: item.height,
                })),
            });
            textPages.push({ pageNumber, text: textItems.map((item) => item.str).join('\n') });
            page.cleanup();
        }

        const answerAssessment = assessPdfDocumentText(textPages);
        const extractionPlan = planPdfPageCodeExtraction(pages);
        if (extractionPlan.ocrPages.length === 0 || answerAssessment.blocked) {
            return {
                pageCount: document.numPages,
                codes: extractionPlan.textCodes,
                method: extractionPlan.textCodes.length > 0 ? 'text_layer' : 'none',
                answerAssessment,
            };
        }

        const { createWorker, OEM, PSM } = await import('tesseract.js');
        const worker = await createWorker('eng', OEM.LSTM_ONLY, {
            workerPath: '/tesseract/worker.min.js',
            corePath: '/tesseract/core',
            langPath: '/tesseract/lang',
            gzip: true,
        });
        const ocrCodes: ExtractedPdfProblemCode[] = [];
        try {
            await worker.setParameters({
                tessedit_char_whitelist: '0123456789',
                tessedit_pageseg_mode: PSM.SPARSE_TEXT,
                preserve_interword_spaces: '1',
            });
            for (const missingPage of extractionPlan.ocrPages) {
                const pageNumber = missingPage.pageNumber;
                options.onProgress?.({ phase: 'ocr', page: pageNumber, pageCount: document.numPages });
                const page = await document.getPage(pageNumber);
                const baseViewport = page.getViewport({ scale: 1 });
                const scale = renderScale(baseViewport.width, baseViewport.height);
                const viewport = page.getViewport({ scale });
                const canvas = window.document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
                if (!context) throw new Error('PDF OCR용 캔버스를 만들 수 없습니다.');
                await page.render({ canvas, canvasContext: context, viewport }).promise;
                const recognition = await worker.recognize(canvas, {}, { text: true, blocks: true });
                ocrCodes.push(...ocrCodesFromBlocks(
                    recognition.data.blocks,
                    pageNumber,
                    baseViewport.width,
                    baseViewport.height,
                    scale,
                ));
                canvas.width = 1;
                canvas.height = 1;
                page.cleanup();
            }
        } finally {
            await worker.terminate();
        }

        const codes = [...extractionPlan.textCodes, ...ocrCodes].sort((left, right) => (
            left.page - right.page
            || left.column - right.column
            || right.y - left.y
            || left.x - right.x
        ));
        const method = extractionPlan.textCodes.length > 0 && ocrCodes.length > 0
            ? 'hybrid'
            : extractionPlan.textCodes.length > 0
                ? 'text_layer'
                : ocrCodes.length > 0
                    ? 'numbers_ocr'
                    : 'none';

        return {
            pageCount: document.numPages,
            codes,
            method,
            answerAssessment,
        };
    } finally {
        await loadingTask.destroy();
    }
}
