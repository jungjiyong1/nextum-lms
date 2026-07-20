import 'server-only';

import sharp from 'sharp';

export interface NormalizedProblemImage {
    png: Uint8Array;
    widthPx: number;
    heightPx: number;
    /** 원본 메타데이터의 논리 DPI. 없으면 null. */
    dpi: number | null;
}

/**
 * 문항 이미지를 조판 가능한 상태로 정규화한다: EXIF 회전 반영, 투명 배경
 * 흰색 합성, PNG 통일. 자르거나 비율을 바꾸지 않는다.
 */
export async function normalizeProblemImage(buffer: Uint8Array): Promise<NormalizedProblemImage> {
    const source = sharp(Buffer.from(buffer));
    const metadata = await source.metadata();
    const normalized = await source
        .rotate()
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer({ resolveWithObject: true });

    return {
        png: new Uint8Array(normalized.data),
        widthPx: normalized.info.width,
        heightPx: normalized.info.height,
        dpi: typeof metadata.density === 'number' && metadata.density > 0
            ? metadata.density
            : null,
    };
}
