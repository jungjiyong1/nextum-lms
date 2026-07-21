import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { normalizeProblemImage } from './worksheet-images';

describe('normalizeProblemImage', () => {
    it('keeps horizontal framing, trims vertical margins, and normalizes canvas width', async () => {
        const foreground = await sharp({
            create: {
                width: 800,
                height: 300,
                channels: 4,
                background: { r: 20, g: 80, b: 160, alpha: 0.5 },
            },
        }).png().toBuffer();
        const source = await sharp({
            create: {
                width: 1000,
                height: 500,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
        }).composite([{ input: foreground, left: 100, top: 100 }]).png().toBuffer();

        const normalized = await normalizeProblemImage(new Uint8Array(source));
        const metadata = await sharp(normalized.png).metadata();

        expect(normalized.widthPx).toBe(1024);
        expect(normalized.heightPx).toBe(307);
        expect(metadata.format).toBe('png');
        expect(metadata.hasAlpha).toBe(false);
    });
});
