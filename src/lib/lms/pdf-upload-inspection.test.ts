import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { inspectPdfBytes, PdfUploadInspectionError } from './pdf-upload-inspection';

function onePagePdf(): Uint8Array {
    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
    ];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((object) => {
        const offset = new TextEncoder().encode(body).byteLength;
        body += object;
        return offset;
    });
    const xrefOffset = new TextEncoder().encode(body).byteLength;
    const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    body += `xref\n0 4\n0000000000 65535 f \n${entries}`;
    body += `trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new TextEncoder().encode(body);
}

describe('authoritative uploaded PDF inspection', () => {
    it('rejects content that merely claims a PDF MIME type without a PDF signature', async () => {
        await expect(inspectPdfBytes(new TextEncoder().encode('not-a-pdf'), 200)).rejects.toMatchObject({
            code: 'INVALID_PDF_FILE',
        } satisfies Partial<PdfUploadInspectionError>);
    });

    it('parses the actual PDF page tree and enforces the server page limit', async () => {
        const bytes = onePagePdf();
        await expect(inspectPdfBytes(bytes.slice(), 200, { scanImageOnly: false })).resolves.toMatchObject({ pageCount: 1 });
        await expect(inspectPdfBytes(bytes.slice(), 0, { scanImageOnly: false })).rejects.toMatchObject({
            code: 'PDF_PAGE_LIMIT_EXCEEDED',
        } satisfies Partial<PdfUploadInspectionError>);
    });
});
