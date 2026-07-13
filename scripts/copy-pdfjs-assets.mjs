import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'node_modules', 'pdfjs-dist');
const outputRoot = join(root, 'public', 'pdfjs');
const tesseractRoot = join(root, 'node_modules', 'tesseract.js');
const tesseractCoreRoot = join(root, 'node_modules', 'tesseract.js-core');
const tesseractLanguageRoot = join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');
const tesseractKoreanLanguageRoot = join(root, 'node_modules', '@tesseract.js-data', 'kor', '4.0.0_best_int');
const tesseractOutputRoot = join(root, 'public', 'tesseract');

if (!existsSync(sourceRoot)) {
  throw new Error(`pdfjs-dist is not installed at ${sourceRoot}`);
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(sourceRoot, directory), join(outputRoot, directory), { recursive: true });
}

console.log(`Copied PDF.js runtime assets to ${outputRoot}`);

for (const requiredPath of [tesseractRoot, tesseractCoreRoot, tesseractLanguageRoot, tesseractKoreanLanguageRoot]) {
  if (!existsSync(requiredPath)) throw new Error(`Tesseract OCR asset is not installed at ${requiredPath}`);
}

rmSync(tesseractOutputRoot, { recursive: true, force: true });
mkdirSync(join(tesseractOutputRoot, 'core'), { recursive: true });
mkdirSync(join(tesseractOutputRoot, 'lang'), { recursive: true });
cpSync(join(tesseractRoot, 'dist', 'worker.min.js'), join(tesseractOutputRoot, 'worker.min.js'));
for (const fileName of [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]) {
  cpSync(join(tesseractCoreRoot, fileName), join(tesseractOutputRoot, 'core', fileName));
}
cpSync(
  join(tesseractLanguageRoot, 'eng.traineddata.gz'),
  join(tesseractOutputRoot, 'lang', 'eng.traineddata.gz'),
);
cpSync(
  join(tesseractKoreanLanguageRoot, 'kor.traineddata.gz'),
  join(tesseractOutputRoot, 'lang', 'kor.traineddata.gz'),
);

console.log(`Copied browser OCR runtime assets to ${tesseractOutputRoot}`);
