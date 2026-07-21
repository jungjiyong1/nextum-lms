import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { layoutWorksheet } from './worksheet-layout';
import {
    composeAnswerKeyPdf,
    composeStudentPdf,
    formatAnswerText,
    type WorksheetPdfFonts,
} from './worksheet-pdf';

let fonts: WorksheetPdfFonts;

beforeAll(() => {
    const directory = join(process.cwd(), 'src', 'lib', 'lms', 'render', 'fonts');
    fonts = {
        regular: new Uint8Array(readFileSync(join(directory, 'NotoSansKR_400Regular.ttf'))),
        bold: new Uint8Array(readFileSync(join(directory, 'NotoSansKR_700Bold.ttf'))),
    };
});

async function testImage(widthPx: number, heightPx: number): Promise<Uint8Array> {
    const png = await sharp({
        create: {
            width: widthPx,
            height: heightPx,
            channels: 3,
            background: { r: 240, g: 240, b: 240 },
        },
    }).png().toBuffer();
    return new Uint8Array(png);
}

const HEADER = {
    academyName: '플립수학 종암',
    title: '맞춤 학습지',
    studentName: '김한별',
    dateLabel: '2026-07-20',
    versionCode: 'WS-TEST01',
};

describe('composeStudentPdf', () => {
    it('renders korean text and matches the layout page count', async () => {
        const inputs = [1, 2, 3, 4, 5].map((seq) => ({ seq, widthPx: 472, heightPx: 531, dpi: 150 }));
        const layout = layoutWorksheet(inputs);
        const images = await Promise.all(
            inputs.map(async (input) => ({ seq: input.seq, png: await testImage(input.widthPx, input.heightPx) })),
        );

        const bytes = await composeStudentPdf({ header: HEADER, layout, images, fonts });
        const loaded = await PDFDocument.load(bytes);
        expect(loaded.getPageCount()).toBe(layout.pages.length);
        expect(loaded.getPageCount()).toBe(2);
        expect(bytes.byteLength).toBeGreaterThan(10_000);
    });

    it('is deterministic for identical input', async () => {
        const inputs = [{ seq: 1, widthPx: 472, heightPx: 531, dpi: 150 }];
        const layout = layoutWorksheet(inputs);
        const image = await testImage(472, 531);

        const first = await composeStudentPdf({ header: HEADER, layout, images: [{ seq: 1, png: image }], fonts });
        const second = await composeStudentPdf({ header: HEADER, layout, images: [{ seq: 1, png: image }], fonts });
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    });

    it('fails clearly when an image is missing', async () => {
        const layout = layoutWorksheet([{ seq: 1, widthPx: 472, heightPx: 531 }]);
        await expect(
            composeStudentPdf({ header: HEADER, layout, images: [], fonts }),
        ).rejects.toThrow(/missing a normalized image/);
    });
});

describe('composeAnswerKeyPdf', () => {
    it('renders an answer list with korean skill names', async () => {
        const bytes = await composeAnswerKeyPdf({
            ...HEADER,
            entries: [
                { seq: 1, answerText: '③', challengeBand: 2, skillName: '일차함수 그래프 해석', role: 'verification' },
                { seq: 2, answerText: '1) 12  2) x=3', challengeBand: 1, skillName: null, role: 'practice' },
            ],
            fonts,
        });
        const loaded = await PDFDocument.load(bytes);
        expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
    });
});

describe('formatAnswerText', () => {
    it('formats scalar, object, and multi-part answers', () => {
        expect(formatAnswerText(null)).toBe('-');
        expect(formatAnswerText('12')).toBe('12');
        expect(formatAnswerText({ value: '③' })).toBe('③');
        expect(formatAnswerText({ subs: [{ label: '(1)', value: 12 }, { value: 'x=3' }] }))
            .toBe('(1) 12  2) x=3');
        expect(formatAnswerText({ unexpected: true })).toBe('-');
    });
});
