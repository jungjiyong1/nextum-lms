import 'server-only';

import sharp from 'sharp';

const NORMALIZED_CANVAS_WIDTH_PX = 1024;

export interface NormalizedProblemImage {
    png: Uint8Array;
    widthPx: number;
    heightPx: number;
    contentHeightToWidthRatio: number;
}

/**
 * 문항 이미지를 조판 가능한 상태로 정규화한다: EXIF 회전 반영, 투명 배경
 * 흰색 합성, 위아래 외곽 여백 제거, 공통 캔버스 폭, PNG 통일. 좌우 구도는
 * 유지하므로 모든 문항의 글자 크기가 같은 물리 배율로 출력된다.
 */
export async function normalizeProblemImage(buffer: Uint8Array): Promise<NormalizedProblemImage> {
    const base = sharp(Buffer.from(buffer))
        .rotate()
        .flatten({ background: '#ffffff' });
    const [oriented, trimProbe] = await Promise.all([
        base.clone().raw().toBuffer({ resolveWithObject: true }),
        base.clone()
            .trim({ background: '#ffffff', threshold: 10 })
            .raw()
            .toBuffer({ resolveWithObject: true }),
    ]);
    const trimTopPx = Math.max(0, -(trimProbe.info.trimOffsetTop ?? 0));
    const trimHeightPx = Math.min(
        trimProbe.info.height,
        oriented.info.height - trimTopPx,
    );
    const normalized = await sharp(oriented.data, {
        raw: {
            width: oriented.info.width,
            height: oriented.info.height,
            channels: oriented.info.channels,
        },
    })
        .extract({
            left: 0,
            top: trimTopPx,
            width: oriented.info.width,
            height: trimHeightPx,
        })
        .resize({ width: NORMALIZED_CANVAS_WIDTH_PX })
        .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: true,
            colours: 256,
            effort: 10,
            dither: 0,
        })
        .toBuffer({ resolveWithObject: true });

    return {
        png: new Uint8Array(normalized.data),
        widthPx: normalized.info.width,
        heightPx: normalized.info.height,
        contentHeightToWidthRatio: trimProbe.info.height / trimProbe.info.width,
    };
}
