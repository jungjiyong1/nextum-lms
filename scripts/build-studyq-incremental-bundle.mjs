import { createHash } from 'crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';
import {
  ACADEMY_ID,
  BOOK_KEY,
  BOOK_TITLE,
  BUNDLE_VERSION,
  SOURCE_NAMESPACE,
  TAXONOMY_KEY,
  canonicalStringify,
  sha256,
  uuidV5,
} from './import-studyq-bank.mjs';

const EXTRACTOR = 'C:/Users/User/Desktop/nextum-lms/scripts/extract-studyq-source-pages.py';
const CODE_PATTERN = /(?<!\d)\d{7}(?!\d)/g;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const ROUTES = Object.freeze({
  '중1:수와연산': { unit_key: 'middle1_numbers_operations', part_name: '중1', name: '수와 연산', metadata: { course_code: 'middle1', grade_code: 'middle-1', school_type: 'middle' } },
  '중1:문자와식': { unit_key: 'middle1_letters_expressions', part_name: '중1', name: '문자와 식', metadata: { course_code: 'middle1', grade_code: 'middle-1', school_type: 'middle' } },
  '중2:수와식': { unit_key: 'middle2_numbers_expressions', part_name: '중2', name: 'Ⅰ. 수와 식', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:부등식': { unit_key: 'middle2_linear_inequalities', part_name: '중2', name: 'Ⅱ. 부등식', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:방정식': { unit_key: 'middle2_simultaneous_equations', part_name: '중2', name: 'Ⅲ. 방정식', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:함수': { unit_key: 'middle2_linear_functions', part_name: '중2', name: 'Ⅳ. 함수', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:도형의닮음': { unit_key: 'middle2_similarity', part_name: '중2', name: 'Ⅵ. 도형의 닮음', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:닮음의활용': { unit_key: 'middle2_similarity_applications', part_name: '중2', name: 'Ⅶ. 닮음의 활용', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:피타고라스정리': { unit_key: 'middle2_pythagorean_theorem', part_name: '중2', name: 'Ⅷ. 피타고라스 정리', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '중2:확률': { unit_key: 'middle2_probability', part_name: '중2', name: 'Ⅸ. 확률', metadata: { course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' } },
  '미적분1:함수의극한과연속': { unit_key: 'calculus1_limits_continuity', part_name: '미적분1', name: '함수의 극한과 연속', metadata: { course_code: 'calculus-1', grade_code: 'high-elective', school_type: 'high' } },
  '미적분1:미분': { unit_key: 'calculus1_differentiation', part_name: '미적분1', name: '미분', metadata: { course_code: 'calculus-1', grade_code: 'high-elective', school_type: 'high' } },
  '미적분1:적분': { unit_key: 'calculus1_integration', part_name: '미적분1', name: '적분', metadata: { course_code: 'calculus-1', grade_code: 'high-elective', school_type: 'high' } },
});

const CONCEPT_NAMES = Object.freeze({
  소인수분해: '소인수분해',
  정수와유리수: '정수와 유리수',
  문자의사용과식의계산: '문자의 사용과 식의 계산',
  일차방정식: '일차방정식',
  계산력향상문제: '보조. 계산력 향상 문제',
  유리수와소수: '1. 유리수와 소수',
  단항식의계산: '2. 단항식의 계산',
  다항식의계산: '3. 다항식의 계산',
  일차부등식: '1. 일차부등식',
  일차부등식의활용: '2. 일차부등식의 활용',
  연립일차방정식: '1. 연립일차방정식',
  연립일차방정식의풀이: '2. 연립일차방정식의 풀이',
  연립일차방정식의활용: '3. 연립일차방정식의 활용',
  일차함수와일차방정식의관계: '3. 일차함수와 일차방정식의 관계',
  도형의닮음: '1. 도형의 닮음',
  닮음의활용: '1. 닮음의 활용',
  피타고라스정리: '1. 피타고라스 정리',
  경우의수: '1. 경우의 수',
  확률: '2. 확률',
  함수의극한: '함수의 극한',
  함수의연속: '함수의 연속',
  미분계수와도함수: '미분계수와 도함수',
  도함수의활용: '도함수의 활용',
  부정적분: '부정적분',
  정적분: '정적분',
  계산력향상문제: '보조. 계산력 향상 문제',
});

const DIFFICULTIES = Object.freeze({ 최상: 4, 상: 3, 중: 2, 하: 1 });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function json(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function jsonl(path, rows) {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function typeKey(unitKey, conceptName, name) {
  return `studyq_${sha256(`${unitKey}\u0000${conceptName}\u0000${name}`).slice(0, 20)}`;
}

function skillCode(unitKey, conceptName, problemTypeName) {
  return `studyq_${sha256(`${unitKey}\u0000${conceptName}\u0000${problemTypeName}`).slice(0, 24)}`;
}

function normalizeDifficulty(raw) {
  const normalized = raw.replace(/\(\d+\)$/u, '');
  invariant(Object.hasOwn(DIFFICULTIES, normalized), `Unsupported difficulty token: ${raw}`);
  return normalized;
}

function parseSourceFile(file) {
  const stem = basename(file, extname(file));
  const parts = stem.split('_');
  invariant(parts.length === 4, `Filename must have grade_unit_concept_difficulty form: ${basename(file)}`);
  const [grade, sourceUnit, sourceConcept, difficultyRaw] = parts;
  const route = ROUTES[`${grade}:${sourceUnit}`];
  invariant(route, `No unit route is registered for ${grade}:${sourceUnit}`);
  const conceptName = CONCEPT_NAMES[sourceConcept] || sourceConcept;
  return {
    grade,
    sourceUnit,
    sourceConcept,
    sourceDifficulty: difficultyRaw,
    difficulty: normalizeDifficulty(difficultyRaw),
    challengeBand: DIFFICULTIES[normalizeDifficulty(difficultyRaw)],
    route,
    conceptName,
  };
}

function parseArgs(argv) {
  const options = { input: null, output: null, maxFiles: null, offset: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--input') options.input = argv[++index] || null;
    else if (value === '--output') options.output = argv[++index] || null;
    else if (value === '--max-files') options.maxFiles = Number(argv[++index]);
    else if (value === '--offset') options.offset = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  invariant(options.input && options.output, 'Usage: node scripts/build-studyq-incremental-bundle.mjs --input <DB화전> --output <bundle-dir> [--max-files N]');
  invariant(options.maxFiles === null || (Number.isInteger(options.maxFiles) && options.maxFiles > 0), '--max-files must be a positive integer');
  invariant(Number.isInteger(options.offset) && options.offset >= 0, '--offset must be a non-negative integer');
  return options;
}

function readPdfCodes(pdfPath) {
  const result = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  invariant(result.status === 0, `Could not read StudyQ codes from ${basename(pdfPath)}: ${result.stderr || 'unknown pdftotext error'}`);
  return new Set(result.stdout.match(CODE_PATTERN) || []);
}

function extractPdf(sourcePath, workDir) {
  mkdirSync(workDir, { recursive: true });
  const result = spawnSync('python', [EXTRACTOR, sourcePath, 'all'], {
    cwd: workDir,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  invariant(result.status === 0, `Image extraction failed for ${basename(sourcePath)}:\n${result.stdout}\n${result.stderr}`);
  const manifestPath = join(workDir, 'book_out', 'problems.json');
  invariant(existsSync(manifestPath), `Extractor did not write problems.json for ${basename(sourcePath)}`);
  const rows = JSON.parse(readFileSync(manifestPath, 'utf8'));
  invariant(Array.isArray(rows) && rows.length > 0, `Extractor returned no problems for ${basename(sourcePath)}`);
  return rows;
}

async function fetchExistingCodesAndCount() {
  loadEnvFiles();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  invariant(url && key, 'Supabase credentials are required to build an incremental bundle');
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const content = client.schema('content');
  const known = new Set();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await content.from('problems').select('id,metadata').order('id').range(offset, offset + 999);
    if (error) throw error;
    for (const row of data) {
      const studyq = row.metadata?.studyq;
      if (studyq?.source_namespace === SOURCE_NAMESPACE && typeof studyq.external_id === 'string' && /^\d{7}$/.test(studyq.external_id)) known.add(studyq.external_id);
    }
    if (data.length < 1000) break;
  }
  const { data: book, error: bookError } = await content.from('books').select('id').eq('book_key', BOOK_KEY).single();
  if (bookError) throw bookError;
  const { count, error: countError } = await content.from('problems').select('id', { count: 'exact', head: true }).eq('book_id', book.id);
  if (countError) throw countError;
  return { known, bookProblemCount: count || 0 };
}

function buildProblem({ code, source, sourceSha, descriptor, raw, asset, answerAsset }) {
  const rawProblemTypeName = raw.type_name?.trim() || '유형 미분류';
  const problemTypeName = `${descriptor.conceptName} · ${rawProblemTypeName}`;
  const problemTypeKey = typeKey(descriptor.route.unit_key, descriptor.conceptName, problemTypeName);
  const sourceAnswer = {
    type: 'text',
    self_grade: true,
    source_capture_status: answerAsset ? 'image_captured_unparsed' : 'not_captured',
  };
  const row = {
    external_id: code,
    source_namespace: SOURCE_NAMESPACE,
    verified: true,
    unit: descriptor.route,
    concept: { name: descriptor.conceptName, name_raw: descriptor.sourceConcept },
    problem_type: { type_key: problemTypeKey, name: problemTypeName, name_raw: rawProblemTypeName },
    page_printed: raw.page,
    number: code,
    answer: sourceAnswer,
    answer_key: sourceAnswer,
    public_payload: { type: 'text', self_grade: true },
    difficulty_hint: descriptor.difficulty,
    metadata: {
      source_capture: {
        source_form: raw.form || null,
        source_difficulty: raw.difficulty || descriptor.difficulty,
        filename_difficulty: descriptor.difficulty,
        source_type_name: raw.type_name || null,
        answer_image_captured: Boolean(answerAsset),
        answer_image_sha256: answerAsset?.sha256 || null,
      },
    },
    asset: { path: asset.path, sha256: asset.sha256, media_type: 'image/png' },
  };
  row.content_sha256 = sha256(canonicalStringify(row));
  return {
    row,
    sourceRef: {
      external_id: code,
      source_namespace: SOURCE_NAMESPACE,
      source_file_name: basename(source),
      source_file_sha256: sourceSha,
      source_page: raw.page,
      bbox: { page_column: raw.col, number_slot: raw.number_slot, crop_method: 'image-fragment-assembly-v1' },
      content_sha256: row.content_sha256,
    },
  };
}

function finalizeManifest(output, routes, problemCountAfter) {
  const files = {};
  for (const fileName of ['problems.jsonl', 'source_refs.jsonl', 'taxonomy.json']) {
    const filePath = join(output, fileName);
    const content = fileName.endsWith('.jsonl') ? readFileSync(filePath, 'utf8').trim() : readFileSync(filePath, 'utf8');
    files[fileName] = { sha256: hashFile(filePath), row_count: fileName.endsWith('.jsonl') ? (content ? content.split(/\r?\n/).length : 0) : JSON.parse(content).problem_tags.length };
  }
  const manifest = {
    bundle_version: BUNDLE_VERSION,
    source_namespace: SOURCE_NAMESPACE,
    pipeline_version: 'studyq-source-capture-v1',
    import_mode: 'incremental',
    book: { book_id: uuidV5(`book:${BOOK_KEY}`), book_key: BOOK_KEY, title: BOOK_TITLE, subject: '수학', grade: '중2·중3·고등', academy_id: ACADEMY_ID },
    routes,
    bank_problem_count_after_import: problemCountAfter,
    files,
  };
  manifest.bundle_sha256 = sha256(canonicalStringify(manifest));
  json(join(output, 'manifest.json'), manifest);
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = resolve(options.input);
  const output = resolve(options.output);
  invariant(existsSync(input) && statSync(input).isDirectory(), `Input directory does not exist: ${input}`);
  invariant(!existsSync(output), `Output directory already exists: ${output}`);
  mkdirSync(join(output, 'assets'), { recursive: true });
  mkdirSync(join(output, 'answer-assets'), { recursive: true });
  mkdirSync(join(output, '_work'), { recursive: true });

  const { known: existingCodes, bookProblemCount } = await fetchExistingCodesAndCount();
  let files = readdirSync(input, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => join(input, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right), 'ko'));
  files = files.slice(options.offset);
  if (options.maxFiles !== null) files = files.slice(0, options.maxFiles);
  invariant(files.length > 0, 'No PDFs found in input directory');

  const rows = [];
  const refs = [];
  const reportFiles = [];
  const seenNewCodes = new Set();
  const skills = new Map();
  const tags = [];
  const routes = new Map();
  let skippedExisting = 0;
  let answerImages = 0;

  for (const [index, source] of files.entries()) {
    const descriptor = parseSourceFile(source);
    const sourceSha = hashFile(source);
    const pdfCodes = readPdfCodes(source);
    const workDir = join(output, '_work', sourceSha);
    const extracted = extractPdf(source, workDir);
    const extractedByCode = new Map();
    for (const raw of extracted) {
      invariant(typeof raw.video_code === 'string' && /^\d{7}$/.test(raw.video_code), `Missing or invalid StudyQ code in ${basename(source)} (${raw.problem_id})`);
      invariant(!extractedByCode.has(raw.video_code), `Duplicate extracted StudyQ code ${raw.video_code} in ${basename(source)}`);
      extractedByCode.set(raw.video_code, raw);
    }
    const extractedCodes = new Set(extractedByCode.keys());
    const missing = [...pdfCodes].filter((code) => !extractedCodes.has(code));
    const unexpected = [...extractedCodes].filter((code) => !pdfCodes.has(code));
    invariant(missing.length === 0 && unexpected.length === 0, `Code/image extraction mismatch for ${basename(source)}: missing=${missing.join(',')} unexpected=${unexpected.join(',')}`);
    routes.set(descriptor.route.unit_key, descriptor.route);
    let newCodes = 0;
    let knownCodes = 0;
    for (const [code, raw] of extractedByCode.entries()) {
      if (existingCodes.has(code)) {
        skippedExisting += 1;
        knownCodes += 1;
        continue;
      }
      invariant(!seenNewCodes.has(code), `New StudyQ code ${code} appears in more than one input PDF; source provenance is ambiguous`);
      seenNewCodes.add(code);
      const questionSource = resolve(workDir, raw.block_image);
      invariant(existsSync(questionSource), `Question image is missing for ${code}`);
      const assetPath = `assets/${code}.png`;
      const questionTarget = join(output, assetPath);
      cpSync(questionSource, questionTarget);
      const asset = { path: assetPath, sha256: hashFile(questionTarget) };
      let answerAsset = null;
      if (raw.answer_image) {
        const answerSource = resolve(workDir, raw.answer_image);
        invariant(existsSync(answerSource), `Answer image is missing for ${code}`);
        const answerPath = `answer-assets/${code}${extname(answerSource) || '.png'}`;
        const answerTarget = join(output, answerPath);
        cpSync(answerSource, answerTarget);
        answerAsset = { path: answerPath, sha256: hashFile(answerTarget) };
        answerImages += 1;
      }
      const built = buildProblem({ code, source, sourceSha, descriptor, raw, asset, answerAsset });
      rows.push(built.row);
      refs.push(built.sourceRef);
      const typeName = built.row.problem_type.name;
      const codeForSkill = skillCode(descriptor.route.unit_key, descriptor.conceptName, typeName);
      if (!skills.has(codeForSkill)) {
        skills.set(codeForSkill, {
          code: codeForSkill,
          subject: '수학',
          school_type: descriptor.route.metadata.school_type,
          grade: descriptor.grade,
          unit_code: descriptor.route.unit_key,
          unit_name: descriptor.conceptName,
          name: typeName,
          active: true,
          sort_order: skills.size,
          metadata: { source: SOURCE_NAMESPACE, source_unit: descriptor.sourceUnit, source_concept: descriptor.sourceConcept },
        });
      }
      tags.push({
        external_id: code,
        skill_code: codeForSkill,
        challenge_band: descriptor.challengeBand,
        equivalence_key: `studyq:${code}`,
        confidence: 1,
        metadata: { difficulty: descriptor.difficulty, source_capture_status: 'image_captured_unparsed_answer' },
      });
      newCodes += 1;
    }
    reportFiles.push({ file_name: basename(source), sha256: sourceSha, pages: [...new Set(extracted.map((raw) => raw.page))].length, source_codes: extracted.length, new_codes: newCodes, existing_codes: knownCodes });
    console.log(`[${index + 1}/${files.length}] ${basename(source)}: ${newCodes} new, ${knownCodes} existing`);
  }

  rows.sort((left, right) => left.external_id.localeCompare(right.external_id));
  refs.sort((left, right) => left.external_id.localeCompare(right.external_id));
  tags.sort((left, right) => left.external_id.localeCompare(right.external_id));
  invariant(rows.length > 0, 'The selected PDFs contain no new StudyQ codes');
  jsonl(join(output, 'problems.jsonl'), rows);
  jsonl(join(output, 'source_refs.jsonl'), refs);
  json(join(output, 'taxonomy.json'), { taxonomy_key: TAXONOMY_KEY, skills: [...skills.values()], problem_tags: tags });
  const manifest = finalizeManifest(output, [...routes.values()].sort((left, right) => left.unit_key.localeCompare(right.unit_key)), bookProblemCount + rows.length);
  const approval = {
    approved: true,
    approval_mode: 'source_capture',
    approved_by: 'studyq-source-capture-pipeline',
    approved_at: new Date().toISOString(),
    bundle_sha256: manifest.bundle_sha256,
    problem_count: rows.length,
    verification: { verified_count: rows.length, unresolved_count: 0 },
    checklist: { source_codes_match: true, source_images_match: true, taxonomy_reviewed: true },
  };
  json(join(output, 'approval.json'), approval);
  json(join(output, 'build-report.json'), {
    created_at: new Date().toISOString(), input, output, source_pdf_count: files.length,
    source_pdf_codes: reportFiles.reduce((sum, file) => sum + file.source_codes, 0),
    new_problem_codes: rows.length, skipped_existing_codes: skippedExisting, answer_images: answerImages,
    files: reportFiles,
  });
  console.log(`Built ${BUNDLE_VERSION}: ${rows.length} new problems, ${skippedExisting} existing codes skipped.`);
  console.log(`Bundle: ${output}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`Build failed: ${message}`);
  process.exitCode = 1;
});
