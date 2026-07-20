import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WorksheetFonts {
    regular: Uint8Array;
    bold: Uint8Array;
}

let cached: WorksheetFonts | null = null;

/** PDF 임베드용 한글 전체 커버리지 TTF. 웹폰트 슬라이스와 별개로 저장소에 커밋되어 있다. */
export function loadWorksheetFonts(): WorksheetFonts {
    if (!cached) {
        const directory = join(process.cwd(), 'src', 'lib', 'lms', 'render', 'fonts');
        cached = {
            regular: new Uint8Array(readFileSync(join(directory, 'NotoSansKR_400Regular.ttf'))),
            bold: new Uint8Array(readFileSync(join(directory, 'NotoSansKR_700Bold.ttf'))),
        };
    }
    return cached;
}
