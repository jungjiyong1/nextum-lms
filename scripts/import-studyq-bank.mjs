import {
  createHash,
  randomUUID,
} from 'crypto';
import {
  existsSync,
  readFileSync,
  statSync,
} from 'fs';
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'path';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';

export const BUNDLE_VERSION = 'studyq-bank-bundle-v2';
export const BOOK_KEY = 'nextum_math_bank';
export const BOOK_TITLE = '넥섬 수학 문제은행';
export const ACADEMY_ID = '2da7ffc5-9582-4056-8a7c-26b179878b55';
export const SOURCE_NAMESPACE = 'studyq';
export const TAXONOMY_KEY = 'pbl_math_v1';
// Shared with grade-app/scripts/studyq/bank_contract.py. Changing this would
// remap every stable bank, unit, problem, type, and asset identifier.
export const UUID_NAMESPACE = '07e3034f-87ab-5415-95ae-bb654a6730b3';

export const ROUTE_CONTRACTS = Object.freeze({
  middle2_numbers_expressions: Object.freeze({ part_name: '중2', name: 'Ⅰ. 수와 식', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle1_numbers_operations: Object.freeze({ part_name: '중1', name: '수와 연산', course_code: 'middle1', grade_code: 'middle-1', school_type: 'middle' }),
  middle1_letters_expressions: Object.freeze({ part_name: '중1', name: '문자와 식', course_code: 'middle1', grade_code: 'middle-1', school_type: 'middle' }),
  middle2_linear_inequalities: Object.freeze({ part_name: '중2', name: 'Ⅱ. 부등식', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_simultaneous_equations: Object.freeze({ part_name: '중2', name: 'Ⅲ. 방정식', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_linear_functions: Object.freeze({ part_name: '중2', name: 'Ⅳ. 함수', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_geometry_properties: Object.freeze({ part_name: '중2', name: '도형의 성질', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_linear_function_graphs: Object.freeze({ part_name: '중2', name: '일차함수와 그래프', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_similarity: Object.freeze({ part_name: '중2', name: 'Ⅵ. 도형의 닮음', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_similarity_applications: Object.freeze({ part_name: '중2', name: 'Ⅶ. 닮음의 활용', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_pythagorean_theorem: Object.freeze({ part_name: '중2', name: 'Ⅷ. 피타고라스 정리', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  middle2_probability: Object.freeze({ part_name: '중2', name: 'Ⅸ. 확률', course_code: 'middle2', grade_code: 'middle-2', school_type: 'middle' }),
  calculus1_differentiation: Object.freeze({ part_name: '미적분1', name: '미분', course_code: 'calculus-1', grade_code: 'high-elective', school_type: 'high' }),
  calculus1_integration: Object.freeze({ part_name: '미적분1', name: '적분', course_code: 'calculus-1', grade_code: 'high-elective', school_type: 'high' }),
  middle3_real_numbers: Object.freeze({ part_name: '중3', name: '실수', course_code: 'middle3', grade_code: 'middle-3', school_type: 'middle' }),
  middle3_quadratic_functions: Object.freeze({ part_name: '중3', name: '이차함수', course_code: 'middle3', grade_code: 'middle-3', school_type: 'middle' }),
  common_math1_equations_inequalities: Object.freeze({ part_name: '공통수학1', name: '방정식과 부등식', course_code: 'common-math-1', grade_code: 'high-common-1', school_type: 'high' }),
  common_math2_functions: Object.freeze({ part_name: '공통수학2', name: '함수', course_code: 'common-math-2', grade_code: 'high-common-2', school_type: 'high' }),
  algebra_exponential_log_trig: Object.freeze({ part_name: '대수', name: '지수·로그·삼각함수', course_code: 'algebra', grade_code: 'high-elective', school_type: 'high' }),
  calculus1_limits_continuity: Object.freeze({ part_name: '미적분1', name: '함수의 극한과 연속', course_code: 'calculus-1', grade_code: 'high-elective', school_type: 'high' }),
});

// The historical initial bundle intentionally contains only these eight
// routes. New routes are admitted through incremental bundles.
const INITIAL_ROUTE_KEYS = Object.freeze([
  'middle2_geometry_properties',
  'middle2_linear_function_graphs',
  'middle3_real_numbers',
  'middle3_quadratic_functions',
  'common_math1_equations_inequalities',
  'common_math2_functions',
  'algebra_exponential_log_trig',
  'calculus1_limits_continuity',
]);

export const INITIAL_PART_COUNTS = Object.freeze({
  중2: 3205,
  중3: 2609,
  공통수학1: 957,
  공통수학2: 1295,
  대수: 821,
  미적분1: 651,
});

const PROBLEM_IMAGES_BUCKET = process.env.NEXTUM_PROBLEM_IMAGES_BUCKET || 'problem-images';
const CHUNK_SIZE = 200;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[0-9]{7}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_SECRET_KEYS = new Set([
  'answer',
  'answer_key',
  'correct',
  'correct_answer',
  'correct_index',
  'display',
  'explanation',
  'normalized',
  'solution',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function asObject(value, label) {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function asNonEmptyString(value, label) {
  invariant(typeof value === 'string' && value.trim(), `${label} must be a non-empty string`);
  return value.trim();
}

function asOptionalObject(value, label) {
  if (value === undefined || value === null) return {};
  return asObject(value, label);
}

function chunk(values, size = CHUNK_SIZE) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

export function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function uuidToBytes(uuid) {
  invariant(UUID_PATTERN.test(uuid), `Invalid namespace UUID: ${uuid}`);
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

export function uuidV5(name, namespace = UUID_NAMESPACE) {
  const digest = createHash('sha1')
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, 'utf8')]))
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readJson(path, label) {
  invariant(existsSync(path), `${label} is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJsonLines(path, label) {
  invariant(existsSync(path), `${label} is missing: ${path}`);
  const rows = [];
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${label}:${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return rows;
}

function safeBundlePath(bundleDir, input, label) {
  const normalized = String(input || '').replaceAll('\\', '/');
  invariant(normalized && !isAbsolute(normalized), `${label} must be a relative path`);
  const fullPath = resolve(bundleDir, normalized);
  const relativePath = relative(bundleDir, fullPath);
  invariant(relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`), `${label} escapes the bundle directory`);
  return fullPath;
}

function fileContract(manifest, fileName) {
  const entry = asObject(manifest.files?.[fileName], `manifest.files[${fileName}]`);
  invariant(SHA256_PATTERN.test(entry.sha256), `manifest.files[${fileName}].sha256 must be lowercase SHA-256`);
  invariant(Number.isInteger(entry.row_count) && entry.row_count >= 0, `manifest.files[${fileName}].row_count must be a non-negative integer`);
  return entry;
}

function assertNoPublicSecrets(value, path = 'public_payload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPublicSecrets(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    invariant(!PUBLIC_SECRET_KEYS.has(key.toLowerCase()), `${path}.${key} exposes a private answer field`);
    assertNoPublicSecrets(child, `${path}.${key}`);
  }
  if (Array.isArray(value.choices)) {
    invariant(value.self_grade !== true, `${path}.self_grade cannot be true when fixed choices exist`);
  }
}

function withoutKey(object, key) {
  const clone = { ...object };
  delete clone[key];
  return clone;
}

function normalizeProblem(raw, index, bundleDir) {
  const row = asObject(raw, `problems[${index}]`);
  const externalId = asNonEmptyString(row.external_id, `problems[${index}].external_id`);
  invariant(CODE_PATTERN.test(externalId), `problems[${index}].external_id must contain exactly seven digits`);
  const sourceNamespace = row.source_namespace ?? SOURCE_NAMESPACE;
  invariant(sourceNamespace === SOURCE_NAMESPACE, `problems[${index}].source_namespace must be ${SOURCE_NAMESPACE}`);
  invariant(row.verified === true, `problems[${index}] (${externalId}) is not verified`);
  invariant(SHA256_PATTERN.test(row.content_sha256), `problems[${index}].content_sha256 must be lowercase SHA-256`);
  const computedContentHash = sha256(canonicalStringify(withoutKey(row, 'content_sha256')));
  invariant(computedContentHash === row.content_sha256, `problems[${index}] (${externalId}) content_sha256 mismatch`);

  const unit = asObject(row.unit, `problems[${index}].unit`);
  const unitKey = asNonEmptyString(unit.unit_key, `problems[${index}].unit.unit_key`);
  const partName = asNonEmptyString(unit.part_name, `problems[${index}].unit.part_name`);
  const unitName = asNonEmptyString(unit.name, `problems[${index}].unit.name`);
  const unitMetadata = asObject(unit.metadata, `problems[${index}].unit.metadata`);
  asNonEmptyString(unitMetadata.course_code, `problems[${index}].unit.metadata.course_code`);
  asNonEmptyString(unitMetadata.grade_code, `problems[${index}].unit.metadata.grade_code`);
  invariant(['middle', 'high'].includes(unitMetadata.school_type), `problems[${index}].unit.metadata.school_type must be middle or high`);
  const routeContract = ROUTE_CONTRACTS[unitKey];
  invariant(routeContract, `problems[${index}].unit.unit_key is not one of the eight fixed routes`);
  invariant(
    canonicalStringify({
      part_name: partName,
      name: unitName,
      course_code: unitMetadata.course_code,
      grade_code: unitMetadata.grade_code,
      school_type: unitMetadata.school_type,
    }) === canonicalStringify(routeContract),
    `problems[${index}].unit does not match the fixed route tuple for ${unitKey}`,
  );

  const concept = asObject(row.concept, `problems[${index}].concept`);
  const conceptName = asNonEmptyString(concept.name, `problems[${index}].concept.name`);
  const problemType = asObject(row.problem_type, `problems[${index}].problem_type`);
  const typeKey = asNonEmptyString(problemType.type_key, `problems[${index}].problem_type.type_key`);
  const typeName = asNonEmptyString(problemType.name, `problems[${index}].problem_type.name`);

  const answer = asObject(row.answer, `problems[${index}].answer`);
  const answerKey = asObject(row.answer_key, `problems[${index}].answer_key`);
  const publicPayload = asObject(row.public_payload, `problems[${index}].public_payload`);
  asNonEmptyString(answer.type, `problems[${index}].answer.type`);
  asNonEmptyString(answerKey.type, `problems[${index}].answer_key.type`);
  assertNoPublicSecrets(publicPayload, `problems[${index}].public_payload`);
  asOptionalObject(row.metadata, `problems[${index}].metadata`);

  const asset = asObject(row.asset, `problems[${index}].asset`);
  const assetRelativePath = asNonEmptyString(asset.path, `problems[${index}].asset.path`).replaceAll('\\', '/');
  invariant(assetRelativePath.startsWith('assets/'), `problems[${index}].asset.path must be under assets/`);
  invariant(SHA256_PATTERN.test(asset.sha256), `problems[${index}].asset.sha256 must be lowercase SHA-256`);
  const assetPath = safeBundlePath(bundleDir, assetRelativePath, `problems[${index}].asset.path`);
  invariant(existsSync(assetPath) && statSync(assetPath).isFile(), `problems[${index}] asset is missing: ${assetRelativePath}`);
  invariant(sha256File(assetPath) === asset.sha256, `problems[${index}] asset SHA-256 mismatch: ${assetRelativePath}`);
  const mediaType = asset.media_type ?? 'image/png';
  invariant(['image/png', 'image/jpeg', 'image/webp'].includes(mediaType), `problems[${index}].asset.media_type is unsupported`);

  const problemId = uuidV5(`problem:${sourceNamespace}:${externalId}`);
  if (row.problem_id !== undefined) {
    invariant(row.problem_id === problemId, `problems[${index}].problem_id is not the stable UUIDv5 value`);
  }
  invariant(Number.isInteger(row.page_printed) && row.page_printed > 0, `problems[${index}].page_printed must be positive`);
  const number = asNonEmptyString(String(row.number ?? externalId), `problems[${index}].number`);

  return {
    raw: row,
    externalId,
    sourceNamespace,
    contentSha256: row.content_sha256,
    problemId,
    unit,
    unitKey,
    partName,
    unitName,
    unitMetadata,
    unitId: uuidV5(`unit:${BOOK_KEY}:${unitKey}`),
    concept,
    conceptName,
    conceptId: uuidV5(`concept:${BOOK_KEY}:${unitKey}:${conceptName}`),
    problemType,
    typeKey,
    typeName,
    typeId: uuidV5(`type:${BOOK_KEY}:${unitKey}:${typeKey}`),
    answer,
    answerKey,
    publicPayload,
    asset,
    assetPath,
    mediaType,
    assetId: uuidV5(`asset:${problemId}:${asset.sha256}`),
    pagePrinted: row.page_printed,
    number,
  };
}

function normalizeSourceRef(raw, index) {
  const row = asObject(raw, `source_refs[${index}]`);
  const externalId = asNonEmptyString(row.external_id, `source_refs[${index}].external_id`);
  invariant(CODE_PATTERN.test(externalId), `source_refs[${index}].external_id must contain exactly seven digits`);
  const sourceNamespace = row.source_namespace ?? SOURCE_NAMESPACE;
  invariant(sourceNamespace === SOURCE_NAMESPACE, `source_refs[${index}].source_namespace must be ${SOURCE_NAMESPACE}`);
  const sourceFileName = asNonEmptyString(row.source_file_name, `source_refs[${index}].source_file_name`);
  invariant(SHA256_PATTERN.test(row.source_file_sha256), `source_refs[${index}].source_file_sha256 must be lowercase SHA-256`);
  invariant(SHA256_PATTERN.test(row.content_sha256), `source_refs[${index}].content_sha256 must be lowercase SHA-256`);
  invariant(Number.isInteger(row.source_page) && row.source_page > 0, `source_refs[${index}].source_page must be positive`);
  invariant(row.bbox === undefined || row.bbox === null || typeof row.bbox === 'object', `source_refs[${index}].bbox must be an object or array`);
  return {
    raw: row,
    externalId,
    sourceNamespace,
    sourceFileName,
  };
}

function validateTaxonomy(taxonomy, problems) {
  const root = asObject(taxonomy, 'taxonomy.json');
  invariant(root.taxonomy_key === TAXONOMY_KEY, `taxonomy.taxonomy_key must be ${TAXONOMY_KEY}`);
  invariant(Array.isArray(root.skills) && root.skills.length > 0, 'taxonomy.skills must be a non-empty array');
  invariant(Array.isArray(root.problem_tags), 'taxonomy.problem_tags must be an array');
  const skills = root.skills.map((raw, index) => {
    const skill = asObject(raw, `taxonomy.skills[${index}]`);
    const code = asNonEmptyString(skill.code, `taxonomy.skills[${index}].code`);
    asNonEmptyString(skill.unit_name, `taxonomy.skills[${index}].unit_name`);
    asNonEmptyString(skill.name, `taxonomy.skills[${index}].name`);
    invariant((skill.subject ?? '수학') === '수학', `taxonomy.skills[${index}].subject must be 수학`);
    invariant(skill.school_type === null || skill.school_type === undefined || ['middle', 'high'].includes(skill.school_type), `taxonomy.skills[${index}].school_type is invalid`);
    asOptionalObject(skill.metadata, `taxonomy.skills[${index}].metadata`);
    return { ...skill, code };
  });
  const skillCodes = new Set(skills.map((skill) => skill.code));
  invariant(skillCodes.size === skills.length, 'taxonomy.skills contains duplicate codes');

  const tagsByCode = new Map();
  for (const [index, raw] of root.problem_tags.entries()) {
    const tag = asObject(raw, `taxonomy.problem_tags[${index}]`);
    const externalId = asNonEmptyString(tag.external_id, `taxonomy.problem_tags[${index}].external_id`);
    invariant(CODE_PATTERN.test(externalId), `taxonomy.problem_tags[${index}].external_id must contain seven digits`);
    invariant(!tagsByCode.has(externalId), `taxonomy.problem_tags has duplicate external_id ${externalId}`);
    invariant(skillCodes.has(tag.skill_code), `taxonomy.problem_tags[${index}] references unknown skill ${tag.skill_code}`);
    invariant(Number.isInteger(tag.challenge_band) && tag.challenge_band >= 1 && tag.challenge_band <= 4, `taxonomy.problem_tags[${index}].challenge_band must be 1..4`);
    asNonEmptyString(tag.equivalence_key, `taxonomy.problem_tags[${index}].equivalence_key`);
    asOptionalObject(tag.metadata, `taxonomy.problem_tags[${index}].metadata`);
    tagsByCode.set(externalId, tag);
  }
  invariant(tagsByCode.size === problems.length, 'taxonomy.problem_tags must contain exactly one tag per problem');
  for (const problem of problems) {
    invariant(tagsByCode.has(problem.externalId), `taxonomy.problem_tags is missing ${problem.externalId}`);
  }
  return { root, skills, tagsByCode };
}

export function validateBundle(inputDir, academyId = ACADEMY_ID) {
  const bundleDir = resolve(inputDir);
  invariant(existsSync(bundleDir) && statSync(bundleDir).isDirectory(), `Bundle directory does not exist: ${bundleDir}`);
  const manifestPath = resolve(bundleDir, 'manifest.json');
  const approvalPath = resolve(bundleDir, 'approval.json');
  const manifest = asObject(readJson(manifestPath, 'manifest.json'), 'manifest.json');
  const approval = asObject(readJson(approvalPath, 'approval.json'), 'approval.json');

  invariant(manifest.bundle_version === BUNDLE_VERSION, `manifest.bundle_version must be ${BUNDLE_VERSION}`);
  invariant(manifest.source_namespace === SOURCE_NAMESPACE, `manifest.source_namespace must be ${SOURCE_NAMESPACE}`);
  const book = asObject(manifest.book, 'manifest.book');
  invariant(book.book_id === uuidV5(`book:${BOOK_KEY}`), 'manifest.book.book_id is not the stable UUIDv5 value');
  invariant(book.book_key === BOOK_KEY, `manifest.book.book_key must be ${BOOK_KEY}`);
  invariant(book.title === BOOK_TITLE, `manifest.book.title must be ${BOOK_TITLE}`);
  invariant(book.subject === '수학', 'manifest.book.subject must be 수학');
  invariant(book.grade === '중2·중3·고등', 'manifest.book.grade must be 중2·중3·고등');
  if (book.academy_id !== undefined) invariant(book.academy_id === academyId, 'manifest.book.academy_id does not match the target academy');
  const pipelineVersion = asNonEmptyString(manifest.pipeline_version, 'manifest.pipeline_version');
  invariant(['initial', 'incremental'].includes(manifest.import_mode), 'manifest.import_mode must be initial or incremental');
  invariant(Array.isArray(manifest.routes) && manifest.routes.length > 0, 'manifest.routes must be a non-empty array');
  const manifestRouteKeys = new Set();
  for (const [index, rawRoute] of manifest.routes.entries()) {
    const route = asObject(rawRoute, `manifest.routes[${index}]`);
    const unitKey = asNonEmptyString(route.unit_key, `manifest.routes[${index}].unit_key`);
    const expected = ROUTE_CONTRACTS[unitKey];
    invariant(expected, `manifest.routes[${index}] is not one of the eight fixed routes`);
    invariant(!manifestRouteKeys.has(unitKey), `manifest.routes contains duplicate route ${unitKey}`);
    manifestRouteKeys.add(unitKey);
    const metadata = asObject(route.metadata, `manifest.routes[${index}].metadata`);
    invariant(
      canonicalStringify({
        part_name: route.part_name,
        name: route.name,
        course_code: metadata.course_code,
        grade_code: metadata.grade_code,
        school_type: metadata.school_type,
      }) === canonicalStringify(expected),
      `manifest.routes[${index}] does not match the fixed route tuple for ${unitKey}`,
    );
  }
  invariant(
    Number.isInteger(manifest.bank_problem_count_after_import) && manifest.bank_problem_count_after_import > 0,
    'manifest.bank_problem_count_after_import must be a positive integer',
  );
  if (manifest.import_mode === 'initial') {
    invariant(manifest.bank_problem_count_after_import === 9538, 'The initial bank manifest must declare exactly 9,538 problems');
    invariant(
      manifestRouteKeys.size === INITIAL_ROUTE_KEYS.length
      && INITIAL_ROUTE_KEYS.every((key) => manifestRouteKeys.has(key)),
      'The initial bank manifest must contain all eight fixed routes exactly once',
    );
  }
  invariant(SHA256_PATTERN.test(manifest.bundle_sha256), 'manifest.bundle_sha256 must be lowercase SHA-256');
  const computedBundleHash = sha256(canonicalStringify(withoutKey(manifest, 'bundle_sha256')));
  invariant(computedBundleHash === manifest.bundle_sha256, 'manifest.bundle_sha256 mismatch');

  const coreFiles = ['problems.jsonl', 'source_refs.jsonl', 'taxonomy.json'];
  for (const fileName of coreFiles) {
    const contract = fileContract(manifest, fileName);
    const path = safeBundlePath(bundleDir, fileName, fileName);
    invariant(existsSync(path) && statSync(path).isFile(), `${fileName} is missing`);
    invariant(sha256File(path) === contract.sha256, `${fileName} SHA-256 mismatch`);
  }

  const problemRows = readJsonLines(resolve(bundleDir, 'problems.jsonl'), 'problems.jsonl');
  const sourceRefRows = readJsonLines(resolve(bundleDir, 'source_refs.jsonl'), 'source_refs.jsonl');
  const taxonomyJson = readJson(resolve(bundleDir, 'taxonomy.json'), 'taxonomy.json');
  invariant(problemRows.length > 0, 'problems.jsonl must contain at least one problem');
  invariant(problemRows.length === fileContract(manifest, 'problems.jsonl').row_count, 'problems.jsonl row count mismatch');
  invariant(sourceRefRows.length === fileContract(manifest, 'source_refs.jsonl').row_count, 'source_refs.jsonl row count mismatch');

  const problems = problemRows.map((row, index) => normalizeProblem(row, index, bundleDir));
  const refs = sourceRefRows.map((row, index) => normalizeSourceRef(row, index));
  const problemRouteKeys = new Set(problems.map((problem) => problem.unitKey));
  invariant(
    problemRouteKeys.size === manifestRouteKeys.size
    && [...problemRouteKeys].every((key) => manifestRouteKeys.has(key)),
    'manifest.routes must exactly match the routes used by problems.jsonl',
  );
  if (manifest.import_mode === 'initial') {
    const countsByPart = Object.fromEntries(Object.keys(INITIAL_PART_COUNTS).map((key) => [key, 0]));
    for (const problem of problems) countsByPart[problem.partName] = (countsByPart[problem.partName] || 0) + 1;
    invariant(
      canonicalStringify(countsByPart) === canonicalStringify(INITIAL_PART_COUNTS),
      `Initial source counts must be ${canonicalStringify(INITIAL_PART_COUNTS)}; received ${canonicalStringify(countsByPart)}`,
    );
  }
  const problemByCode = new Map();
  const unitSignatureByKey = new Map();
  const conceptSignatureByKey = new Map();
  const typeSignatureByKey = new Map();
  const typeKeyByUniqueName = new Map();
  for (const problem of problems) {
    invariant(!problemByCode.has(problem.externalId), `problems.jsonl contains duplicate code ${problem.externalId}`);
    problemByCode.set(problem.externalId, problem);
    const unitSignature = canonicalStringify({
      id: problem.unitId,
      part_name: problem.partName,
      name: problem.unitName,
      metadata: problem.unitMetadata,
    });
    const priorUnitSignature = unitSignatureByKey.get(problem.unitKey);
    invariant(!priorUnitSignature || priorUnitSignature === unitSignature, `unit ${problem.unitKey} has conflicting definitions`);
    unitSignatureByKey.set(problem.unitKey, unitSignature);

    const conceptKey = `${problem.unitKey}::${problem.conceptName}`;
    const conceptSignature = canonicalStringify({ id: problem.conceptId, name: problem.conceptName });
    const priorConceptSignature = conceptSignatureByKey.get(conceptKey);
    invariant(!priorConceptSignature || priorConceptSignature === conceptSignature, `concept ${conceptKey} has conflicting definitions`);
    conceptSignatureByKey.set(conceptKey, conceptSignature);

    const scopedTypeKey = `${problem.unitKey}::${problem.typeKey}`;
    const typeSignature = canonicalStringify({ id: problem.typeId, name: problem.typeName, concept: problem.conceptName });
    const priorTypeSignature = typeSignatureByKey.get(scopedTypeKey);
    invariant(!priorTypeSignature || priorTypeSignature === typeSignature, `problem type ${scopedTypeKey} has conflicting definitions`);
    typeSignatureByKey.set(scopedTypeKey, typeSignature);
    const uniqueNameKey = `${problem.unitKey}::${problem.typeName}`;
    const priorTypeKey = typeKeyByUniqueName.get(uniqueNameKey);
    invariant(!priorTypeKey || priorTypeKey === problem.typeKey, `problem type name ${uniqueNameKey} maps to multiple type keys`);
    typeKeyByUniqueName.set(uniqueNameKey, problem.typeKey);
  }
  const refByCode = new Map();
  for (const ref of refs) {
    invariant(!refByCode.has(ref.externalId), `source_refs.jsonl contains duplicate code ${ref.externalId}`);
    refByCode.set(ref.externalId, ref);
  }
  invariant(refByCode.size === problemByCode.size, 'source_refs.jsonl must contain exactly one row per problem');
  for (const problem of problems) {
    const ref = refByCode.get(problem.externalId);
    invariant(ref, `source_refs.jsonl is missing ${problem.externalId}`);
    invariant(ref.raw.content_sha256 === problem.contentSha256, `source ref ${problem.externalId} content_sha256 mismatch`);
  }

  const taxonomy = validateTaxonomy(taxonomyJson, problems);
  invariant(fileContract(manifest, 'taxonomy.json').row_count === taxonomy.root.problem_tags.length, 'taxonomy.json row count must equal problem_tags length');

  invariant(approval.approved === true, 'approval.approved must be true');
  const approvedBy = asNonEmptyString(approval.approved_by, 'approval.approved_by');
  const approvedAt = new Date(approval.approved_at);
  invariant(!Number.isNaN(approvedAt.valueOf()), 'approval.approved_at must be an ISO timestamp');
  invariant(approval.bundle_sha256 === manifest.bundle_sha256, 'approval.bundle_sha256 must match manifest.bundle_sha256');
  invariant(approval.problem_count === problems.length, 'approval.problem_count mismatch');
  const verification = asObject(approval.verification, 'approval.verification');
  invariant(verification.verified_count === problems.length, 'approval.verification.verified_count mismatch');
  invariant(verification.unresolved_count === 0, 'approval.verification.unresolved_count must be zero');
  const approvalChecklist = asObject(approval.checklist, 'approval.checklist');
  const approvalMode = approval.approval_mode ?? 'delivery_ready';
  invariant(['delivery_ready', 'source_capture'].includes(approvalMode), 'approval.approval_mode is invalid');
  const requiredChecklist = approvalMode === 'source_capture'
    ? ['source_codes_match', 'source_images_match', 'taxonomy_reviewed']
    : ['answers_match', 'crops_match', 'generated_choices_reviewed', 'taxonomy_reviewed'];
  for (const key of requiredChecklist) {
    invariant(approvalChecklist[key] === true, `approval.checklist.${key} must be true`);
  }

  return {
    bundleDir,
    manifest,
    manifestPath,
    approval,
    approvalPath,
    approvalSha256: sha256File(approvalPath),
    approvalMode,
    approvedBy,
    approvedAt: approvedAt.toISOString(),
    pipelineVersion,
    book,
    problems,
    problemByCode,
    refs,
    refByCode,
    taxonomy,
    bundleSha256: manifest.bundle_sha256,
  };
}

export function parseArgs(argv) {
  const options = {
    academyId: ACADEMY_ID,
    apply: false,
    publish: false,
    executionSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null,
    input: null,
    help: false,
    validateOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--dry-run') options.apply = false;
    else if (argument === '--publish') options.publish = true;
    else if (argument === '--validate-only') options.validateOnly = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--academy-id') options.academyId = argv[++index] || '';
    else if (argument.startsWith('--academy-id=')) options.academyId = argument.slice('--academy-id='.length);
    else if (argument === '--execution-sha') options.executionSha = argv[++index] || null;
    else if (argument.startsWith('--execution-sha=')) options.executionSha = argument.slice('--execution-sha='.length) || null;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (options.input) throw new Error('Provide exactly one bundle directory');
    else options.input = resolve(argument);
  }
  invariant(options.help || options.input, 'Provide a studyq-bank-bundle-v2 directory');
  invariant(UUID_PATTERN.test(options.academyId), '--academy-id must be a UUID');
  invariant(options.academyId === ACADEMY_ID, `This importer is pinned to academy ${ACADEMY_ID}`);
  if (options.publish) invariant(options.apply, '--publish requires --apply');
  if (options.validateOnly) {
    invariant(!options.apply, '--validate-only cannot be combined with --apply');
    invariant(!options.publish, '--validate-only cannot be combined with --publish');
  }
  if (options.apply) {
    invariant(
      typeof options.executionSha === 'string' && options.executionSha.trim().length > 0,
      '--apply requires a non-empty --execution-sha (or VERCEL_GIT_COMMIT_SHA/GITHUB_SHA)',
    );
    options.executionSha = options.executionSha.trim();
  }
  return options;
}

function formatError(error) {
  if (!error) return 'Unknown error';
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(' | ');
}

function ensureNoError(error, context) {
  if (error) throw new Error(`${context}: ${formatError(error)}`);
}

async function loadInChunks(factory, values) {
  const rows = [];
  for (const valuesChunk of chunk(values, 300)) {
    const { data, error } = await factory(valuesChunk);
    ensureNoError(error, 'Database read failed');
    rows.push(...(data || []));
  }
  return rows;
}

async function upsertChunks(table, rows, options) {
  for (const rowsChunk of chunk(rows)) {
    const { error } = await table.upsert(rowsChunk, options);
    ensureNoError(error, 'Database upsert failed');
  }
}

async function inspectTarget(client, bundle, academyId) {
  const content = client.schema('content');
  const { data: academy, error: academyError } = await client
    .schema('core')
    .from('academies')
    .select('id')
    .eq('id', academyId)
    .maybeSingle();
  ensureNoError(academyError, 'Could not load target academy');
  invariant(academy?.id, `Target academy does not exist: ${academyId}`);

  const { data: book, error: bookError } = await content
    .from('books')
    .select('id,academy_id,book_key,title,metadata')
    .eq('book_key', BOOK_KEY)
    .maybeSingle();
  ensureNoError(bookError, 'Could not load Nextum math bank');
  if (book) {
    invariant(book.academy_id === academyId, `${BOOK_KEY} already belongs to another academy`);
  }
  const expectedBookId = book?.id || uuidV5(`book:${BOOK_KEY}`);
  const codes = bundle.problems.map((problem) => problem.externalId);
  const problemIds = bundle.problems.map((problem) => problem.problemId);
  const existingRefs = await loadInChunks(
    (codesChunk) => content
      .from('problem_source_refs')
      .select('academy_id,source_namespace,external_id,problem_id,content_sha256')
      .eq('academy_id', academyId)
      .eq('source_namespace', SOURCE_NAMESPACE)
      .in('external_id', codesChunk),
    codes,
  );
  const existingProblems = await loadInChunks(
    (idsChunk) => content
      .from('problems')
      .select('id,book_id,image_path,verified,metadata')
      .in('id', idsChunk),
    problemIds,
  );
  const existingAssets = await loadInChunks(
    (idsChunk) => content
      .from('assets')
      .select('problem_id,storage_path,metadata')
      .eq('kind', 'problem_image')
      .in('problem_id', idsChunk),
    problemIds,
  );
  const { data: revisions, error: revisionsError } = await content
    .from('analysis_taxonomy_revisions')
    .select('id,status,metadata')
    .order('revision_number', { ascending: false });
  ensureNoError(revisionsError, 'Could not inspect PBL Math taxonomy revision');
  const taxonomyRevision = (revisions || []).find((row) => row.metadata?.import_key === TAXONOMY_KEY);
  const approvedTags = taxonomyRevision
    ? await loadInChunks(
      (idsChunk) => content
        .from('problem_analysis_tags')
        .select('problem_id')
        .eq('taxonomy_revision_id', taxonomyRevision.id)
        .eq('review_status', 'approved')
        .in('problem_id', idsChunk),
      problemIds,
    )
    : [];
  const refByCode = new Map(existingRefs.map((row) => [row.external_id, row]));
  const existingProblemById = new Map(existingProblems.map((row) => [row.id, row]));
  const approvedTagProblemIds = new Set(approvedTags.map((row) => row.problem_id));
  const expectedAssetShaByProblemId = new Map(bundle.problems.map((problem) => [
    problem.problemId,
    problem.asset.sha256,
  ]));
  const completeAssetProblemIds = new Set(existingAssets
    .filter((row) => (
      expectedAssetShaByProblemId.has(row.problem_id)
        && typeof row.storage_path === 'string'
        && row.storage_path.length > 0
        && row.metadata?.sha256 === expectedAssetShaByProblemId.get(row.problem_id)
    ))
    .map((row) => row.problem_id));
  const added = [];
  const unchanged = [];
  const repaired = [];
  const conflicts = [];
  for (const problem of bundle.problems) {
    const sourceRef = refByCode.get(problem.externalId);
    const existingProblem = existingProblemById.get(problem.problemId);
    if (sourceRef) {
      if (sourceRef.problem_id !== problem.problemId) {
        conflicts.push(`${problem.externalId}: existing source ref points to ${sourceRef.problem_id}, expected ${problem.problemId}`);
      } else if (sourceRef.content_sha256 !== problem.contentSha256) {
        conflicts.push(`${problem.externalId}: content changed under an existing source code`);
      } else if (!existingProblem || existingProblem.book_id !== expectedBookId) {
        conflicts.push(`${problem.externalId}: mapped problem is missing or belongs to another book`);
      } else if (
        existingProblem.verified !== true
        || !existingProblem.image_path
        || !completeAssetProblemIds.has(problem.problemId)
        || !approvedTagProblemIds.has(problem.problemId)
      ) {
        repaired.push(problem);
      } else {
        unchanged.push(problem);
      }
    } else if (existingProblem) {
      const existingHash = existingProblem.metadata?.studyq?.content_sha256;
      if (existingProblem.book_id === expectedBookId && existingHash === problem.contentSha256) {
        repaired.push(problem);
      } else {
        conflicts.push(`${problem.externalId}: stable problem ID already exists without the matching source ref`);
      }
    } else {
      added.push(problem);
    }
  }

  const { data: existingRun, error: runError } = await content
    .from('import_runs')
    .select('id,status,stats,finished_at,publish_requested')
    .eq('academy_id', academyId)
    .eq('bundle_sha256', bundle.bundleSha256)
    .maybeSingle();
  ensureNoError(runError, 'Could not inspect import run idempotency');
  const { count: existingProblemCount, error: countError } = await content
    .from('problems')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', expectedBookId);
  ensureNoError(countError, 'Could not count existing bank problems');
  const predictedProblemCount = (existingProblemCount || 0) + added.length;
  if (predictedProblemCount !== bundle.manifest.bank_problem_count_after_import) {
    conflicts.push(
      `bank count after import would be ${predictedProblemCount}, manifest declares ${bundle.manifest.bank_problem_count_after_import}`,
    );
  }
  if (!book && bundle.manifest.import_mode !== 'initial') {
    conflicts.push('the first bundle for the bank must use import_mode=initial');
  }
  if (book?.metadata?.visibility === 'import_staging' && bundle.manifest.import_mode === 'incremental') {
    conflicts.push('incremental bundles require the initial bank import to be completed first');
  }
  return {
    book,
    expectedBookId,
    existingRun,
    existingProblemCount: existingProblemCount || 0,
    predictedProblemCount,
    added,
    unchanged,
    repaired,
    conflicts,
  };
}

function printPreview(bundle, target, options) {
  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'} ${BUNDLE_VERSION}`);
  console.log(`  bundle: ${bundle.bundleDir}`);
  console.log(`  sha256: ${bundle.bundleSha256}`);
  console.log(`  academy: ${options.academyId}`);
  console.log(`  book: ${BOOK_TITLE} (${BOOK_KEY})`);
  console.log(`  problems: ${bundle.problems.length}`);
  console.log(`  bank count before / after: ${target.existingProblemCount} / ${target.predictedProblemCount}`);
  console.log(`  add / unchanged / repair / conflict: ${target.added.length} / ${target.unchanged.length} / ${target.repaired.length} / ${target.conflicts.length}`);
  console.log(`  current visibility: ${target.book?.metadata?.visibility || '(new: import_staging)'}`);
  if (options.publish) console.log('  requested visibility: catalog');
  if (
    target.existingRun?.status === 'succeeded'
    && target.added.length === 0
    && target.repaired.length === 0
  ) console.log('  bundle was already imported successfully and remains complete; content writes will be skipped');
  if (!options.apply) console.log('  No database or Storage writes were made. Re-run with --apply after review.');
  if (target.conflicts.length) {
    console.log('  conflicts:');
    target.conflicts.slice(0, 20).forEach((conflict) => console.log(`    - ${conflict}`));
    if (target.conflicts.length > 20) console.log(`    - ... ${target.conflicts.length - 20} more`);
  }
}

async function ensureBucket(client) {
  const { data, error } = await client.storage.listBuckets();
  ensureNoError(error, 'Could not list Storage buckets');
  if ((data || []).some((bucket) => bucket.id === PROBLEM_IMAGES_BUCKET || bucket.name === PROBLEM_IMAGES_BUCKET)) return;
  const { error: createError } = await client.storage.createBucket(PROBLEM_IMAGES_BUCKET, { public: false });
  if (!createError) return;
  const { data: afterCreate, error: afterCreateError } = await client.storage.listBuckets();
  ensureNoError(afterCreateError, `Could not verify concurrently created ${PROBLEM_IMAGES_BUCKET}`);
  if ((afterCreate || []).some((bucket) => bucket.id === PROBLEM_IMAGES_BUCKET || bucket.name === PROBLEM_IMAGES_BUCKET)) return;
  ensureNoError(createError, `Could not create ${PROBLEM_IMAGES_BUCKET}`);
}

async function ensureBook(content, bundle, target, options) {
  if (target.book) return target.book;
  const metadata = {
    visibility: 'import_staging',
    source: SOURCE_NAMESPACE,
    bundle_version: BUNDLE_VERSION,
    course_scope: ['중2', '중3', '공통수학1', '공통수학2', '대수', '미적분1'],
    imported_by: 'scripts/import-studyq-bank.mjs',
  };
  const row = {
    id: target.expectedBookId,
    academy_id: options.academyId,
    book_key: BOOK_KEY,
    title: BOOK_TITLE,
    subject: '수학',
    grade: '중2·중3·고등',
    schema_version: 2,
    pipeline_version: bundle.pipelineVersion,
    metadata,
  };
  let { data, error } = await content
    .from('books')
    .insert(row)
    .select('id,academy_id,book_key,title,metadata')
    .single();
  if (error?.code === '23505') {
    const raced = await content
      .from('books')
      .select('id,academy_id,book_key,title,metadata')
      .eq('book_key', BOOK_KEY)
      .single();
    ensureNoError(raced.error, 'Could not load concurrently created Nextum math bank');
    data = raced.data;
    error = null;
  }
  ensureNoError(error, 'Could not create Nextum math bank');
  invariant(data?.id === target.expectedBookId, 'Book creation returned an unexpected stable ID');
  invariant(data?.academy_id === options.academyId, 'Nextum math bank belongs to another academy');
  return data;
}

function storagePathFor(problem, academyId) {
  const extension = problem.mediaType === 'image/jpeg'
    ? 'jpg'
    : problem.mediaType === 'image/webp'
      ? 'webp'
      : 'png';
  return `${academyId}/${BOOK_KEY}/by-sha256/${problem.asset.sha256}.${extension}`;
}

function buildStageRows(bundle, options) {
  const skillRows = bundle.taxonomy.skills.map((skill, index) => {
    const skillId = uuidV5(`analysis-skill:${TAXONOMY_KEY}:${skill.code}`);
    return {
      import_run_id: null,
      code: skill.code,
      skill_id: skillId,
      payload: {
        id: skillId,
        code: skill.code,
        subject: '수학',
        school_type: skill.school_type ?? null,
        grade: skill.grade ?? null,
        semester: skill.semester ?? null,
        unit_code: skill.unit_code ?? null,
        unit_name: skill.unit_name,
        name: skill.name,
        active: skill.active ?? true,
        sort_order: skill.sort_order ?? index,
        metadata: asOptionalObject(skill.metadata, `taxonomy skill ${skill.code} metadata`),
      },
    };
  });
  const skillIdByCode = new Map(skillRows.map((row) => [row.code, row.skill_id]));
  const problemRows = bundle.problems.map((problem) => {
    const sourceRef = bundle.refByCode.get(problem.externalId);
    const tag = bundle.taxonomy.tagsByCode.get(problem.externalId);
    const storagePath = storagePathFor(problem, options.academyId);
    return {
      import_run_id: null,
      external_id: problem.externalId,
      problem_id: problem.problemId,
      content_sha256: problem.contentSha256,
      payload: {
        external_id: problem.externalId,
        problem_id: problem.problemId,
        content_sha256: problem.contentSha256,
        unit: {
          id: problem.unitId,
          unit_key: problem.unitKey,
          part_name: problem.partName,
          name: problem.unitName,
          page_start: problem.unit.page_start ?? null,
          page_end: problem.unit.page_end ?? null,
          sort_order: problem.unit.sort_order ?? 0,
          metadata: problem.unitMetadata,
        },
        concept: {
          id: problem.conceptId,
          unit_id: problem.unitId,
          name: problem.conceptName,
          name_raw: problem.concept.name_raw ?? null,
          sort_order: problem.concept.sort_order ?? 0,
          detail: problem.concept.detail ?? null,
        },
        problem_type: {
          id: problem.typeId,
          unit_id: problem.unitId,
          concept_id: problem.conceptId,
          name: problem.typeName,
          name_raw: problem.problemType.name_raw ?? null,
          sort_order: problem.problemType.sort_order ?? 0,
        },
        problem: {
          id: problem.problemId,
          unit_id: problem.unitId,
          concept_id: problem.conceptId,
          problem_type_id: problem.typeId,
          type_id: problem.typeId,
          page_printed: problem.pagePrinted,
          number: problem.number,
          image_path: storagePath,
          answer: problem.answer,
          answer_key: problem.answerKey,
          public_payload: problem.publicPayload,
          position_in_type: problem.raw.position_in_type ?? null,
          is_example: problem.raw.is_example ?? false,
          difficulty_hint: problem.raw.difficulty_hint ?? null,
          metadata: {
            ...asOptionalObject(problem.raw.metadata, `problem ${problem.externalId} metadata`),
            studyq: {
              source_namespace: SOURCE_NAMESPACE,
              external_id: problem.externalId,
              content_sha256: problem.contentSha256,
              asset_sha256: problem.asset.sha256,
              bundle_sha256: bundle.bundleSha256,
            },
            verification: {
              approved: true,
              approval_mode: bundle.approvalMode,
              approved_by: bundle.approvedBy,
              approved_at: bundle.approvedAt,
            },
          },
        },
        asset: {
          id: problem.assetId,
          bucket_id: PROBLEM_IMAGES_BUCKET,
          problem_id: problem.problemId,
          kind: 'problem_image',
          storage_path: storagePath,
          media_type: problem.mediaType,
          metadata: {
            source: SOURCE_NAMESPACE,
            source_path: problem.asset.path,
            sha256: problem.asset.sha256,
            bundle_sha256: bundle.bundleSha256,
          },
        },
        source_ref: {
          source_namespace: SOURCE_NAMESPACE,
          external_id: problem.externalId,
          problem_id: problem.problemId,
          source_file_name: sourceRef.sourceFileName,
          source_file_sha256: sourceRef.raw.source_file_sha256,
          source_page: sourceRef.raw.source_page,
          // Omit absent JSON values so PostgreSQL's #> operator yields SQL
          // NULL. Serializing `bbox: null` would yield jsonb `null`, which is
          // intentionally rejected by the bbox shape constraint.
          ...(sourceRef.raw.bbox == null ? {} : { bbox: sourceRef.raw.bbox }),
          content_sha256: problem.contentSha256,
          metadata: {
            ...asOptionalObject(sourceRef.raw.metadata, `source ref ${problem.externalId} metadata`),
            bundle_sha256: bundle.bundleSha256,
          },
        },
        tag: {
          skill_code: tag.skill_code,
          skill_id: skillIdByCode.get(tag.skill_code),
          challenge_band: tag.challenge_band,
          equivalence_key: tag.equivalence_key,
          confidence: tag.confidence ?? 1,
          metadata: {
            ...asOptionalObject(tag.metadata, `taxonomy tag ${problem.externalId} metadata`),
            bundle_sha256: bundle.bundleSha256,
            approved_by_external: bundle.approvedBy,
            change_reason: 'approved StudyQ bundle import',
          },
        },
      },
    };
  });
  return { problemRows, skillRows };
}

async function createOrResumeImportRun(content, bundle, book, target, options) {
  const startedAt = new Date().toISOString();
  const runBase = {
    academy_id: options.academyId,
    book_id: book.id,
    bundle_version: BUNDLE_VERSION,
    bundle_sha256: bundle.bundleSha256,
    pipeline_version: bundle.pipelineVersion,
    import_mode: bundle.manifest.import_mode,
    bundle_problem_count: bundle.problems.length,
    expected_bank_problem_count: bundle.manifest.bank_problem_count_after_import,
    publish_requested: options.publish,
    asset_bucket: PROBLEM_IMAGES_BUCKET,
    status: 'running',
    approved_by: bundle.approvedBy,
    approved_at: bundle.approvedAt,
    approval_sha256: bundle.approvalSha256,
    execution_sha: options.executionSha,
    source_path: bundle.bundleDir,
    stats: {
      planned_add: target.added.length,
      unchanged: target.unchanged.length,
      planned_repair: target.repaired.length,
      conflicts: 0,
    },
    error_message: null,
    started_at: startedAt,
    finished_at: null,
  };

  let existing = target.existingRun || null;
  if (!existing) {
    const { data, error } = await content.from('import_runs').insert(runBase).select('id,status,publish_requested').single();
    if (!error) existing = data;
    else if (error.code === '23505') {
      const { data: racedRun, error: racedRunError } = await content
        .from('import_runs')
        .select('id,status,publish_requested')
        .eq('academy_id', options.academyId)
        .eq('bundle_sha256', bundle.bundleSha256)
        .single();
      ensureNoError(racedRunError, 'Could not load concurrently created import run');
      existing = racedRun;
    } else {
      ensureNoError(error, 'Could not create import run');
    }
  }

  invariant(existing?.id, 'Import run creation returned no ID');
  if (existing.status === 'succeeded') {
    if (options.publish && !existing.publish_requested) {
      const { error } = await content
        .from('import_runs')
        .update({ publish_requested: true })
        .eq('id', existing.id)
        .eq('status', 'succeeded');
      ensureNoError(error, 'Could not request publication for the completed import run');
    }
    return { id: existing.id, status: existing.status };
  }

  const { error: restartError } = await content
    .from('import_runs')
    .update(runBase)
    .eq('id', existing.id)
    .neq('status', 'succeeded');
  ensureNoError(restartError, 'Could not prepare the import run');
  return { id: existing.id, status: existing.status };
}

async function createImportAttempt(content, runId, options) {
  const attemptId = randomUUID();
  const { error } = await content.from('studyq_import_attempts').insert({
    id: attemptId,
    import_run_id: runId,
    status: 'running',
    stats: {
      execution_sha: options.executionSha,
      importer: 'scripts/import-studyq-bank.mjs',
    },
  });
  ensureNoError(error, 'Could not create StudyQ import attempt audit');
  return attemptId;
}

async function planAttemptUploads(content, attemptId, problems, academyId) {
  const problemByPath = new Map(problems.map((problem) => [
    storagePathFor(problem, academyId),
    problem,
  ]));
  const shouldUpload = new Set();
  for (const pathChunk of chunk([...problemByPath.keys()], 1000)) {
    const { data, error } = await content.rpc('register_studyq_import_asset_attempt_v1', {
      p_attempt_id: attemptId,
      p_storage_paths: pathChunk,
    });
    ensureNoError(error, 'Could not register StudyQ asset upload attempt');
    invariant(data?.length === pathChunk.length, 'StudyQ asset registration returned an incomplete path set');
    for (const row of data) {
      invariant(problemByPath.has(row.storage_path), `StudyQ asset registration returned an unknown path: ${row.storage_path}`);
      if (row.should_upload === true) shouldUpload.add(row.storage_path);
    }
  }
  return [...problemByPath.entries()]
    .filter(([storagePath]) => shouldUpload.has(storagePath))
    .map(([, problem]) => problem);
}

async function updateAttemptAssetRows(content, attemptId, storagePaths, values) {
  for (const pathChunk of chunk(storagePaths)) {
    const { error } = await content
      .from('studyq_import_attempt_assets')
      .update(values)
      .eq('attempt_id', attemptId)
      .in('storage_path', pathChunk);
    ensureNoError(error, 'Could not update StudyQ asset attempt audit');
  }
}

export function isTransientStorageError(error) {
  if (!error) return false;
  const status = Number(error.statusCode ?? error.status ?? error.status_code);
  if (status === 408 || status === 429 || status >= 500) return true;
  const message = [error.message, error.error, error.cause?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  // Storage occasionally returns a bare 400 "Bad Request" for an otherwise
  // valid object; an immediate isolated retry succeeds.  Keep specific 4xx
  // failures (invalid path, authorization, size, etc.) non-retryable.
  if (status === 400 && message.trim() === 'bad request') return true;
  return [
    'gateway timeout',
    'timed out',
    'timeout',
    'fetch failed',
    'network error',
    'connection reset',
    'socket hang up',
  ].some((fragment) => message.includes(fragment));
}

export async function uploadStudyqAssetWithRetry(
  bucket,
  storagePath,
  body,
  uploadOptions,
  {
    maxAttempts = 5,
    baseDelayMs = 500,
    sleep = (delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
  } = {},
) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await bucket.upload(storagePath, body, uploadOptions);
      if (!result.error) return result;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
    if (!isTransientStorageError(lastError) || attempt + 1 >= maxAttempts) break;
    await sleep(baseDelayMs * (2 ** attempt));
  }
  return { data: null, error: lastError };
}

async function uploadAttemptAssets(client, content, attemptId, problems, academyId) {
  for (const uploadBatch of chunk(problems, 8)) {
    const outcomes = await Promise.allSettled(uploadBatch.map(async (problem) => {
      const storagePath = storagePathFor(problem, academyId);
      const { error } = await uploadStudyqAssetWithRetry(
        client.storage.from(PROBLEM_IMAGES_BUCKET),
        storagePath,
        readFileSync(problem.assetPath),
        {
          contentType: problem.mediaType,
          upsert: true,
        },
      );
      ensureNoError(error, `Could not upload asset for ${problem.externalId}`);
      return storagePath;
    }));
    const uploadedPaths = outcomes
      .filter((outcome) => outcome.status === 'fulfilled')
      .map((outcome) => outcome.value);
    const failedPaths = outcomes
      .map((outcome, index) => ({ outcome, path: storagePathFor(uploadBatch[index], academyId) }))
      .filter(({ outcome }) => outcome.status === 'rejected')
      .map(({ path }) => path);
    if (uploadedPaths.length) {
      await updateAttemptAssetRows(content, attemptId, uploadedPaths, {
        upload_status: 'uploaded',
        uploaded_at: new Date().toISOString(),
      });
    }
    if (failedPaths.length) {
      await updateAttemptAssetRows(content, attemptId, failedPaths, {
        upload_status: 'upload_failed',
      });
      const firstFailure = outcomes.find((outcome) => outcome.status === 'rejected');
      throw firstFailure.reason;
    }
  }
}

async function completeCleanupWithRetry(content, attemptId, storagePaths, succeeded, errorMessage) {
  let lastError = null;
  for (let retry = 0; retry < 2; retry += 1) {
    const { data, error } = await content.rpc('complete_studyq_import_asset_cleanup_v1', {
      p_attempt_id: attemptId,
      p_storage_paths: storagePaths,
      p_succeeded: succeeded,
      p_error_message: errorMessage,
    });
    if (!error) return data?.[0] || { deleted_count: 0, failed_count: 0 };
    lastError = error;
  }
  throw new Error(`Could not audit StudyQ Storage cleanup completion: ${formatError(lastError)}`);
}

export async function cleanupStudyqAttemptAssets(client, content, attemptId) {
  const summary = { claimed: 0, deleted: 0, failed: 0, error: null };
  let cleanupFailureRetries = 0;
  for (let batchIndex = 0; batchIndex < 100; batchIndex += 1) {
    const { data: claimedRows, error: claimError } = await content.rpc('claim_studyq_import_asset_cleanup_v1', {
      p_attempt_id: attemptId,
      p_limit: 1000,
    });
    if (claimError) {
      summary.error = `cleanup claim failed: ${formatError(claimError)}`;
      return summary;
    }
    const claimedPaths = (claimedRows || []).map((row) => row.storage_path);
    if (claimedPaths.length === 0) return summary;
    summary.claimed += claimedPaths.length;

    const { error: removeError } = await client.storage
      .from(PROBLEM_IMAGES_BUCKET)
      .remove(claimedPaths);
    let completion;
    try {
      completion = await completeCleanupWithRetry(
        content,
        attemptId,
        claimedPaths,
        !removeError,
        removeError ? formatError(removeError) : null,
      );
    } catch (completionError) {
      summary.error = completionError instanceof Error ? completionError.message : String(completionError);
      return summary;
    }
    summary.deleted += Number(completion.deleted_count || 0);
    summary.failed += Number(completion.failed_count || 0);
    if (removeError || Number(completion.failed_count || 0) > 0) {
      summary.error = removeError
        ? `Storage remove failed: ${formatError(removeError)}`
        : 'Storage still reported one or more claimed paths after remove';
      if (cleanupFailureRetries < 1) {
        cleanupFailureRetries += 1;
        continue;
      }
      return summary;
    }
    summary.error = null;
  }
  summary.error = 'Storage cleanup exceeded 100 bounded batches';
  return summary;
}

async function applyImport(client, bundle, target, options) {
  const content = client.schema('content');
  const book = await ensureBook(content, bundle, target, options);
  const run = await createOrResumeImportRun(content, bundle, book, target, options);
  const runId = run.id;
  let attemptId = null;

  try {
    await ensureBucket(client);
    attemptId = await createImportAttempt(content, runId, options);
    const uploadProblems = target.existingRun?.status === 'succeeded'
      ? [...target.added, ...target.repaired]
      : bundle.problems;
    const plannedUploads = await planAttemptUploads(
      content,
      attemptId,
      uploadProblems,
      options.academyId,
    );
    await uploadAttemptAssets(client, content, attemptId, plannedUploads, options.academyId);

    const stage = buildStageRows(bundle, options);
    await upsertChunks(content.from('studyq_import_stage_skills'), stage.skillRows.map((row) => ({
      ...row,
      import_run_id: runId,
    })), {
      onConflict: 'import_run_id,code',
    });
    await upsertChunks(content.from('studyq_import_stage_problems'), stage.problemRows.map((row) => ({
      ...row,
      import_run_id: runId,
    })), {
      onConflict: 'import_run_id,external_id',
    });

    const { data: commitRows, error: commitError } = await content.rpc('commit_studyq_import_v2', {
      p_import_run_id: runId,
      p_attempt_id: attemptId,
    });
    ensureNoError(commitError, 'Could not atomically commit the staged StudyQ bundle');
    const commit = commitRows?.[0];
    invariant(commit, 'StudyQ commit RPC returned no result');
    return {
      idempotent: commit.idempotent === true,
      runId,
      stats: {
        added: commit.added_count,
        unchanged: commit.unchanged_count,
        repaired: commit.repaired_count,
        total: commit.bank_problem_count,
        taxonomy_revision_id: commit.taxonomy_revision_id,
        visibility: commit.visibility,
        mutation_id: commit.mutation_id,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await content
      .from('import_runs')
      .update({
        status: 'failed',
        error_message: message.slice(0, 4000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .neq('status', 'succeeded');
    if (attemptId) {
      const { data: failedAttemptRows, error: attemptError } = await content
        .from('studyq_import_attempts')
        .update({
          status: 'failed',
          error_message: message.slice(0, 4000),
          finished_at: new Date().toISOString(),
        })
        .eq('id', attemptId)
        .eq('status', 'running')
        .select('id');
      if (attemptError) {
        console.warn(`Could not mark StudyQ import attempt failed; Storage cleanup was skipped safely: ${formatError(attemptError)}`);
      } else if (failedAttemptRows?.length) {
        const cleanup = await cleanupStudyqAttemptAssets(client, content, attemptId);
        if (cleanup.error) {
          console.warn(`StudyQ Storage cleanup requires retry (attempt ${attemptId}): ${cleanup.error}`);
        }
      }
    }
    throw error;
  }
}

function printHelp() {
  console.log(`Usage: npm run db:import-studyq-bank -- <bundle-dir> [--validate-only|--dry-run|--apply] [--publish]\n\n` +
    '--validate-only verifies the complete local bundle contract without loading credentials or contacting Supabase.\n' +
    'The default is --dry-run. --apply writes only a fully approved studyq-bank-bundle-v2 and requires --execution-sha.\n' +
    '--publish additionally sets the one bank visibility to catalog; it requires --apply.');
}

export async function runImport(options) {
  const bundle = validateBundle(options.input, options.academyId);
  if (options.apply) {
    invariant(
      typeof options.executionSha === 'string' && options.executionSha.trim().length > 0,
      '--apply requires a non-empty execution SHA',
    );
    options.executionSha = options.executionSha.trim();
  }
  loadEnvFiles();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  invariant(url && serviceKey, 'Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const target = await inspectTarget(client, bundle, options.academyId);
  printPreview(bundle, target, options);
  invariant(target.conflicts.length === 0, 'Import stopped before mutation because source-code conflicts were found');
  if (!options.apply) return { dryRun: true, bundle, target };
  const result = await applyImport(client, bundle, target, options);
  console.log(result.idempotent
    ? `Import already succeeded (run ${result.runId}); no content rows or assets were duplicated.`
    : `Import succeeded (run ${result.runId}).`);
  return { dryRun: false, bundle, target, result };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.validateOnly) {
    const bundle = validateBundle(options.input, options.academyId);
    console.log(`VALID ${BUNDLE_VERSION}`);
    console.log(`  bundle: ${bundle.bundleDir}`);
    console.log(`  sha256: ${bundle.bundleSha256}`);
    console.log(`  problems: ${bundle.problems.length}`);
    return;
  }
  await runImport(options);
}

const invokedDirectly = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
