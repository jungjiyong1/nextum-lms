import 'server-only';

import { resolve } from 'node:path';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import {
    assessPdfDocumentText,
    assessScannedAnswerLayout,
    needsScannedAnswerOcr,
    type PdfAnswerDocumentAssessment,
} from './pdf-problem-codes';

const SCANNED_ANSWER_OCR_PAGE_LIMIT = 3;

export class PdfUploadInspectionError extends Error {
    constructor(
        public readonly code: 'INVALID_PDF_FILE' | 'PDF_PAGE_LIMIT_EXCEEDED' | 'PDF_SCAN_INSPECTION_FAILED',
        message: string,
    ) {
        super(message);
        this.name = 'PdfUploadInspectionError';
    }
}

export interface PdfUploadInspection {
    pageCount: number;
    answerAssessment: PdfAnswerDocumentAssessment;
    scannedAnswerInspection: {
        performed: boolean;
        inspectedPages: number;
        pairCount: number;
        answerLikeLineCount: number;
        relevantLineCount: number;
        longLineCount: number;
        narrativeLineCount: number;
        compactCodeAnswerLineCount: number;
        compactCodePageCount: number;
        evidence: string[];
    };
}

export interface PdfUploadInspectionOptions {
    scanImageOnly?: boolean;
}

type PdfJsWorkerGlobal = typeof globalThis & {
    pdfjsWorker?: {
        WorkerMessageHandler: unknown;
    };
};

async function loadServerPdfJs() {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as PdfJsWorkerGlobal).pdfjsWorker ??= worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function assetDirectory(relativePath: string): string {
    return `${resolve(process.cwd(), 'node_modules', 'pdfjs-dist', relativePath).replace(/\\/gu, '/')}/`;
}

function scannedRenderScale(width: number, height: number): number {
    const maxPixels = 1_800_000;
    return Math.max(1, Math.min(1.8, Math.sqrt(maxPixels / Math.max(1, width * height))));
}

async function ocrScannedPages(
    document: PDFDocumentProxy,
    pageLimit: number,
): Promise<Array<{ pageNumber: number; text: string }>> {
    const [{ createCanvas }, tesseract] = await Promise.all([
        import('@napi-rs/canvas'),
        import('tesseract.js'),
    ]);
    const worker = await tesseract.createWorker(['kor', 'eng'], tesseract.OEM.LSTM_ONLY, {
        langPath: resolve(process.cwd(), 'public', 'tesseract', 'lang'),
        cacheMethod: 'none',
        gzip: true,
    });
    const pages: Array<{ pageNumber: number; text: string }> = [];
    try {
        await worker.setParameters({
            tessedit_pageseg_mode: tesseract.PSM.AUTO,
            preserve_interword_spaces: '1',
        });
        for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, pageLimit); pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = scannedRenderScale(baseViewport.width, baseViewport.height);
            const viewport = page.getViewport({ scale });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext('2d');
            await page.render({
                canvas: canvas as unknown as HTMLCanvasElement,
                canvasContext: context as unknown as CanvasRenderingContext2D,
                viewport,
            }).promise;
            const recognition = await worker.recognize(canvas.toBuffer('image/png'), { rotateAuto: true }, { text: true });
            pages.push({ pageNumber, text: recognition.data.text.slice(0, 30_000) });
            page.cleanup();
        }
        return pages;
    } finally {
        await worker.terminate();
    }
}

/** Parses the actual stored bytes; caller must hash the same byte array before this call. */
export async function inspectPdfBytes(
    bytes: Uint8Array,
    maxPages: number,
    options: PdfUploadInspectionOptions = {},
): Promise<PdfUploadInspection> {
    if (bytes.byteLength < 5 || new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
        throw new PdfUploadInspectionError('INVALID_PDF_FILE', 'The uploaded object does not have a PDF signature.');
    }

    const pdfjs = await loadServerPdfJs();
    const loadingTask = pdfjs.getDocument({
        data: bytes,
        cMapUrl: assetDirectory('cmaps'),
        cMapPacked: true,
        standardFontDataUrl: assetDirectory('standard_fonts'),
        wasmUrl: assetDirectory('wasm'),
        useWorkerFetch: false,
    });
    try {
        const document = await loadingTask.promise;
        if (document.numPages < 1 || document.numPages > maxPages) {
            throw new PdfUploadInspectionError(
                'PDF_PAGE_LIMIT_EXCEEDED',
                `PDF page count must be between 1 and ${maxPages}.`,
            );
        }
        const textPages: Array<{ pageNumber: number; text: string }> = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = content.items
                .filter((item): item is TextItem => 'str' in item)
                .map((item) => item.str)
                .join('\n')
                .slice(0, 20_000);
            textPages.push({ pageNumber, text });
            page.cleanup();
        }
        let answerAssessment = assessPdfDocumentText(textPages);
        let scannedAnswerInspection: PdfUploadInspection['scannedAnswerInspection'] = {
            performed: false,
            inspectedPages: 0,
            pairCount: 0,
            answerLikeLineCount: 0,
            relevantLineCount: 0,
            longLineCount: 0,
            narrativeLineCount: 0,
            compactCodeAnswerLineCount: 0,
            compactCodePageCount: 0,
            evidence: [],
        };
        if (
            options.scanImageOnly !== false
            && !answerAssessment.blocked
            && needsScannedAnswerOcr(textPages, SCANNED_ANSWER_OCR_PAGE_LIMIT)
        ) {
            let ocrPages: Array<{ pageNumber: number; text: string }>;
            try {
                ocrPages = await ocrScannedPages(document, SCANNED_ANSWER_OCR_PAGE_LIMIT);
            } catch {
                throw new PdfUploadInspectionError(
                    'PDF_SCAN_INSPECTION_FAILED',
                    'The image-only PDF could not be safety-checked for answer content. Try again.',
                );
            }
            const ocrTextAssessment = assessPdfDocumentText(ocrPages);
            const layout = assessScannedAnswerLayout(ocrPages);
            const evidence = [
                ...ocrTextAssessment.evidence.map((item) => `scanned_ocr_${item}`),
                ...layout.evidence,
            ];
            answerAssessment = {
                blocked: ocrTextAssessment.blocked || layout.blocked,
                evidence,
                keywordCount: ocrTextAssessment.keywordCount,
                answerRowCount: ocrTextAssessment.answerRowCount,
            };
            scannedAnswerInspection = {
                performed: true,
                inspectedPages: ocrPages.length,
                pairCount: layout.pairCount,
                answerLikeLineCount: layout.answerLikeLineCount,
                relevantLineCount: layout.relevantLineCount,
                longLineCount: layout.longLineCount,
                narrativeLineCount: layout.narrativeLineCount,
                compactCodeAnswerLineCount: layout.compactCodeAnswerLineCount,
                compactCodePageCount: layout.compactCodePageCount,
                evidence,
            };
        }
        return { pageCount: document.numPages, answerAssessment, scannedAnswerInspection };
    } catch (error) {
        if (error instanceof PdfUploadInspectionError) throw error;
        console.error('[PDF upload inspection] PDF.js parsing failed:', {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : String(error),
        });
        throw new PdfUploadInspectionError('INVALID_PDF_FILE', 'The uploaded object is not a readable PDF document.');
    } finally {
        await loadingTask.destroy();
    }
}
