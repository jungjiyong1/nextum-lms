import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clientExtractor = readFileSync('src/lib/lms/pdf-problem-codes-client.ts', 'utf8');
const page = readFileSync('src/features/lms/pdf-assignment-match-page.tsx', 'utf8');
const service = readFileSync('src/lib/lms/assignment-match.ts', 'utf8');
const serverInspection = readFileSync('src/lib/lms/pdf-upload-inspection.ts', 'utf8');
const assetScript = readFileSync('scripts/copy-pdfjs-assets.mjs', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

describe('PDF assignment intake hardening contract', () => {
    it('ships a local numbers-only OCR fallback and retains OCR bounding boxes', () => {
        expect(clientExtractor).toContain("await import('tesseract.js')");
        expect(clientExtractor).toContain("tessedit_char_whitelist: '0123456789'");
        expect(clientExtractor).toContain('for (const missingPage of extractionPlan.ocrPages)');
        expect(clientExtractor).toContain("? 'hybrid'");
        expect(clientExtractor).toContain('bbox: { x, y: top, width, height }');
        expect(assetScript).toContain("'eng.traineddata.gz'");
        expect(assetScript).toContain("'worker.min.js'");
    });

    it('pauses before creating jobs so teachers can enter page-aware codes after OCR failure', () => {
        expect(page).toContain('requiresManualCodes: true');
        expect(page).toContain('parseManualStudyqCodes(job.manualCodeDraft, job.pageCount)');
        expect(page).toContain('if (manualRequired.length > 0)');
        expect(page.indexOf('if (manualRequired.length > 0)')).toBeLessThan(page.indexOf('createPdfAssignmentMatchBatch(academyId'));
    });

    it('hashes and parses stored bytes server-side before trusting client claims', () => {
        expect(service).toContain('hash.update(chunk.value)');
        expect(service).toContain('await inspectPdfBytes(downloaded.bytes, PDF_ASSIGNMENT_MAX_PAGES)');
        expect(service).toContain("'PDF_HASH_MISMATCH'");
        expect(service).toContain("'PDF_PAGE_COUNT_MISMATCH'");
        expect(service).toContain('verifyStoredPdfInspection(client, job)');
        expect(service).toContain('object_fingerprint: authoritative.objectFingerprint');
        expect(service).toContain('summary,error_message,metadata,created_by');
    });

    it('OCRs only the first pages of image-only PDFs server-side with conservative layout evidence', () => {
        expect(serverInspection).toContain('SCANNED_ANSWER_OCR_PAGE_LIMIT = 3');
        expect(serverInspection).toContain("import('@napi-rs/canvas')");
        expect(serverInspection).toContain("createWorker(['kor', 'eng']");
        expect(serverInspection).toContain('needsScannedAnswerOcr(textPages');
        expect(serverInspection).toContain('assessScannedAnswerLayout(ocrPages)');
        expect(service).toContain('scanned_answer_inspection: authoritative.scannedAnswerInspection');
    });

    it('bundles the PDF.js fake-worker handler into the compatible production build', () => {
        expect(packageJson).toContain('"build": "next build --webpack"');
        expect(serverInspection).toContain("import('pdfjs-dist/legacy/build/pdf.worker.mjs')");
        expect(serverInspection).toContain('pdfjsWorker ??= worker');
        expect(serverInspection).toContain("console.error('[PDF upload inspection] PDF.js parsing failed:'");
        expect(serverInspection).toContain("console.error('[PDF upload inspection] PDF.js cleanup failed:'");
        expect(serverInspection).toContain("'PDF_RUNTIME_UNAVAILABLE'");
    });
});
