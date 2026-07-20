import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';
import { validateGaeppulHighTypeUnitBoundaries } from './lib/grade-app-fixture-validation.mjs';

loadEnvFiles();

const DEFAULT_GRADE_APP_DIR = resolve(process.cwd(), '..', 'grade-app');
const PROBLEM_IMAGES_BUCKET = process.env.NEXTUM_PROBLEM_IMAGES_BUCKET || 'problem-images';
const CHUNK_SIZE = 200;
const UPLOAD_CONCURRENCY = Math.max(
  1,
  Math.min(32, Number.parseInt(process.env.NEXTUM_IMPORT_UPLOAD_CONCURRENCY || '8', 10) || 8),
);

function fail(message) {
  console.error(`Import failed: ${message}`);
  process.exit(1);
}

function chunk(values, size = CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
  );
}

function publicAnswerPart(answer) {
  const choices = Array.isArray(answer?.choices) ? answer.choices : null;
  const distractors = Array.isArray(answer?.distractors) ? answer.distractors : null;
  return compactObject({
    label: typeof answer?.label === 'string' ? answer.label : null,
    type: typeof answer?.type === 'string' ? answer.type : null,
    choice_count: Number.isInteger(answer?.choice_count)
      ? answer.choice_count
      : choices?.length,
    choices,
    options: choices || distractors,
    multiple: typeof answer?.multiple === 'boolean' ? answer.multiple : null,
    generated_choice:
      typeof answer?.generated_choice === 'boolean' ? answer.generated_choice : null,
    self_grade:
      typeof answer?.self_grade === 'boolean' ? answer.self_grade : answer?.type === 'text',
  });
}

function publicAnswerPayload(answer) {
  return compactObject({
    ...publicAnswerPart(answer),
    label: undefined,
    subs: Array.isArray(answer?.subs) ? answer.subs.map(publicAnswerPart) : null,
  });
}

function parseArgs(argv) {
  const options = {
    academyId: null,
    gradeAppDir: DEFAULT_GRADE_APP_DIR,
    includeUnverified: false,
    inputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--academy-id') {
      options.academyId = argv[++index] || null;
    } else if (arg === '--include-unverified') {
      options.includeUnverified = true;
    } else if (arg === '--grade-app-dir') {
      options.gradeAppDir = resolve(argv[++index] || DEFAULT_GRADE_APP_DIR);
    } else if (arg.startsWith('--academy-id=')) {
      options.academyId = arg.slice('--academy-id='.length) || null;
    } else if (arg.startsWith('--grade-app-dir=')) {
      options.gradeAppDir = resolve(arg.slice('--grade-app-dir='.length) || DEFAULT_GRADE_APP_DIR);
    } else {
      options.inputs.push(resolve(arg));
    }
  }

  return options;
}

function discoverFixtureInputs(gradeAppDir) {
  const fixturesDir = join(gradeAppDir, 'fixtures');
  if (!existsSync(fixturesDir)) return [];

  const inputs = [];
  const rootExport = join(fixturesDir, 'export.json');
  if (existsSync(rootExport)) inputs.push(rootExport);

  for (const name of readdirSync(fixturesDir).sort()) {
    const fullPath = join(fixturesDir, name);
    if (!statSync(fullPath).isDirectory()) continue;
    const exportPath = join(fullPath, 'export.json');
    if (existsSync(exportPath)) inputs.push(fullPath);
  }

  return inputs;
}

function loadBundle(input) {
  if (!existsSync(input)) fail(`Path does not exist: ${input}`);
  const stats = statSync(input);
  const exportPath = stats.isDirectory() ? join(input, 'export.json') : input;
  if (!existsSync(exportPath)) fail(`export.json not found: ${input}`);

  const baseDir = dirname(exportPath);
  const exportJson = JSON.parse(readFileSync(exportPath, 'utf8'));
  return {
    input,
    exportJson,
    readImage(path) {
      if (!path) return null;
      const imagePath = join(baseDir, path);
      return existsSync(imagePath) ? readFileSync(imagePath) : null;
    },
  };
}

function flattenProblems(exportJson, includeUnverified = false) {
  const rows = [];
  for (const [partIndex, part] of (exportJson.parts || []).entries()) {
    for (const [unitIndex, unit] of (part.units || []).entries()) {
      for (const [problemIndex, problem] of (unit.problems || []).entries()) {
        if (!includeUnverified && problem.verified === false) continue;
        rows.push({ part, unit, problem, partIndex, unitIndex, problemIndex });
      }
    }
  }
  return rows;
}

async function ensureBucket(client, bucket) {
  const { data, error } = await client.storage.listBuckets();
  if (error) fail(`Could not list storage buckets: ${error.message}`);
  if ((data || []).some((row) => row.name === bucket)) return;

  const { error: createError } = await client.storage.createBucket(bucket, { public: false });
  if (createError) fail(`Could not create ${bucket} bucket: ${createError.message}`);
}

async function upsertChunks(table, rows, options) {
  for (const rowsChunk of chunk(rows)) {
    const { error } = await table.upsert(rowsChunk, options);
    if (error) throw error;
  }
}

async function insertChunks(table, rows) {
  for (const rowsChunk of chunk(rows)) {
    const { error } = await table.insert(rowsChunk);
    if (error) throw error;
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function retry(operation, { attempts = 5, initialDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw lastError;
}

async function deleteAssetsForProblems(content, problemIds) {
  for (const ids of chunk(problemIds, 300)) {
    const { error } = await content.from('assets').delete().in('problem_id', ids);
    if (error) throw error;
  }
}

async function importBundle(client, bundle, options) {
  const { exportJson, input, readImage } = bundle;
  if (exportJson.schema_version !== 1) {
    fail(`${input}: unsupported schema_version ${exportJson.schema_version}`);
  }
  if (!exportJson.book_id || !exportJson.parts?.length) {
    fail(`${input}: book_id/parts are required`);
  }
  validateGaeppulHighTypeUnitBoundaries(exportJson, {
    includeUnverified: options.includeUnverified,
  });

  const content = client.schema('content');
  const bookKey = exportJson.book_id;
  const { data: book, error: bookError } = await content
    .from('books')
    .upsert(
      {
        academy_id: options.academyId,
        book_key: bookKey,
        title: exportJson.title,
        subject: exportJson.subject ?? null,
        grade: exportJson.grade ?? null,
        schema_version: exportJson.schema_version,
        pipeline_version: exportJson.pipeline_version ?? null,
        metadata: {
          visibility: 'catalog',
          source: 'grade_app_fixture',
          source_path: input,
          imported_by: 'nextum-lms/scripts/import-grade-app-fixtures.mjs',
        },
      },
      { onConflict: 'book_key' },
    )
    .select('id')
    .single();
  if (bookError) throw bookError;
  if (!book?.id) throw new Error('Book upsert did not return an id');

  const bookId = book.id;
  const unitRows = (exportJson.parts || []).flatMap((part, partIndex) =>
    (part.units || []).map((unit, unitIndex) => ({
      book_id: bookId,
      unit_key: unit.unit_id || `${part.part_id || `part-${partIndex + 1}`}-unit-${unitIndex + 1}`,
      part_name: part.name || '',
      name: unit.name || `Unit ${unitIndex + 1}`,
      page_start: unit.page_range?.[0] ?? null,
      page_end: unit.page_range?.[1] ?? null,
      sort_order: partIndex * 1000 + unitIndex,
      metadata: {
        source_part_id: part.part_id ?? null,
      },
    })),
  );

  const { data: units, error: unitError } = await content
    .from('units')
    .upsert(unitRows, { onConflict: 'book_id,unit_key' })
    .select('id,unit_key');
  if (unitError) throw unitError;
  const unitIdByKey = new Map((units || []).map((row) => [row.unit_key, row.id]));

  const flattened = flattenProblems(exportJson, options.includeUnverified);
  if (flattened.length === 0) fail(`${input}: no verified problems found`);

  const conceptRowsByKey = new Map();
  for (const item of flattened) {
    const name = item.problem.concept_name;
    if (!name) continue;
    const unitKey = item.unit.unit_id || '';
    const unitId = unitIdByKey.get(unitKey);
    const key = `${unitId || 'none'}::${name}`;
    if (!conceptRowsByKey.has(key)) {
      conceptRowsByKey.set(key, {
        book_id: bookId,
        unit_id: unitId ?? null,
        name,
        name_raw: item.problem.concept_name_raw ?? null,
        sort_order: conceptRowsByKey.size,
      });
    }
  }

  const conceptIdByKey = new Map();
  if (conceptRowsByKey.size > 0) {
    const { data, error } = await content
      .from('concepts')
      .upsert([...conceptRowsByKey.values()], { onConflict: 'book_id,unit_id,name' })
      .select('id,unit_id,name');
    if (error) throw error;
    for (const row of data || []) conceptIdByKey.set(`${row.unit_id || 'none'}::${row.name}`, row.id);
  }

  const typeRowsByKey = new Map();
  for (const item of flattened) {
    const name = item.problem.type_name;
    if (!name) continue;
    const unitId = unitIdByKey.get(item.unit.unit_id || '') ?? null;
    const typeKey = `${unitId || 'none'}::${name}`;
    if (typeRowsByKey.has(typeKey)) continue;
    const conceptKey = `${unitId || 'none'}::${item.problem.concept_name || ''}`;
    typeRowsByKey.set(typeKey, {
      book_id: bookId,
      unit_id: unitId,
      concept_id: item.problem.concept_name ? conceptIdByKey.get(conceptKey) ?? null : null,
      name,
      name_raw: item.problem.type_name_raw ?? null,
      sort_order: typeRowsByKey.size,
    });
  }

  const typeIdByKey = new Map();
  if (typeRowsByKey.size > 0) {
    const { data, error } = await content
      .from('problem_types')
      .upsert([...typeRowsByKey.values()], { onConflict: 'book_id,unit_id,name' })
      .select('id,unit_id,name');
    if (error) throw error;
    for (const row of data || []) typeIdByKey.set(`${row.unit_id || 'none'}::${row.name}`, row.id);
  }

  await ensureBucket(client, PROBLEM_IMAGES_BUCKET);

  const problemRows = [];
  const assetRows = [];
  const uploadJobs = [];
  let uploaded = 0;

  for (const item of flattened) {
    const problem = item.problem;
    const problemId = String(problem.problem_id || `${bookKey}::${problemRows.length + 1}`);
    const unitId = unitIdByKey.get(item.unit.unit_id || '');
    if (!unitId) throw new Error(`Problem ${problemId} is missing a unit`);

    let imagePath = null;
    if (problem.image) {
      const bytes = readImage(problem.image);
      if (bytes) {
        imagePath = `${bookKey}/${problemId.replaceAll('::', '_')}.png`;
        uploadJobs.push({ imagePath, bytes });
        assetRows.push({
          book_id: bookId,
          problem_id: problemId,
          kind: 'problem_image',
          storage_path: imagePath,
          media_type: 'image/png',
          metadata: {
            source: 'grade_app_fixture',
            source_image: problem.image,
          },
        });
      }
    }

    const conceptKey = `${unitId || 'none'}::${problem.concept_name || ''}`;
    const problemTypeId = problem.type_name
      ? typeIdByKey.get(`${unitId}::${problem.type_name}`) ?? null
      : null;
    const answer = problem.answer || { type: 'text', display: '', normalized: '', self_grade: true };
    const answerKey = problem.answer_key || answer;
    const publicPayload = problem.public_payload || publicAnswerPayload(answer);
    const sourceMetadata =
      problem.metadata && typeof problem.metadata === 'object' && !Array.isArray(problem.metadata)
        ? problem.metadata
        : {};
    problemRows.push({
      id: problemId,
      book_id: bookId,
      unit_id: unitId,
      concept_id: problem.concept_name ? conceptIdByKey.get(conceptKey) ?? null : null,
      problem_type_id: problemTypeId,
      type_id: problemTypeId,
      page_printed: problem.page_printed ?? problemRows.length + 1,
      number: String(problem.number ?? problemRows.length + 1),
      image_path: imagePath,
      answer,
      answer_key: answerKey,
      public_payload: publicPayload,
      position_in_type: problem.position_in_type ?? null,
      is_example: problem.is_example ?? false,
      difficulty_hint: problem.difficulty_hint ?? null,
      verified: problem.verified !== false,
      metadata: {
        ...sourceMetadata,
        source: sourceMetadata.source || 'grade_app_fixture',
        imported_by: 'nextum-lms/scripts/import-grade-app-fixtures.mjs',
        original_problem_id: problem.problem_id ?? null,
        answer_source: sourceMetadata.answer_source ?? problem.answer_source ?? null,
        crop: {
          bbox: problem.bbox ?? null,
          bbox_pixels: problem.bbox_pixels ?? null,
          page_printed: problem.page_printed ?? null,
        },
      },
    });
  }

  if (uploadJobs.length > 0) {
    console.log(`  Uploading ${uploadJobs.length} images (concurrency=${UPLOAD_CONCURRENCY})...`);
    await runWithConcurrency(uploadJobs, UPLOAD_CONCURRENCY, async ({ imagePath, bytes }) => {
      await retry(async (attempt) => {
        const { error } = await client.storage
          .from(PROBLEM_IMAGES_BUCKET)
          .upload(imagePath, bytes, { contentType: 'image/png', upsert: true });
        if (!error) return;
        if (attempt < 5) {
          console.warn(`    retrying ${imagePath} after ${error.message} (attempt ${attempt}/5)`);
        }
        throw error;
      });
      uploaded += 1;
      if (uploaded % 100 === 0 || uploaded === uploadJobs.length) {
        console.log(`    uploaded ${uploaded}/${uploadJobs.length}`);
      }
    });
  }

  await upsertChunks(content.from('problems'), problemRows, { onConflict: 'id' });
  await deleteAssetsForProblems(content, problemRows.map((row) => row.id));
  if (assetRows.length > 0) await insertChunks(content.from('assets'), assetRows);

  console.log(`Imported ${exportJson.title}`);
  console.log(`  book=${bookId}`);
  console.log(`  units=${unitRows.length} concepts=${conceptRowsByKey.size} types=${typeRowsByKey.size} problems=${problemRows.length} images=${uploaded}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail('Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const inputs = options.inputs.length > 0 ? options.inputs : discoverFixtureInputs(options.gradeAppDir);
  if (inputs.length === 0) {
    fail(`No grade-app fixtures found under ${options.gradeAppDir}`);
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Target Supabase: ${url}`);
  console.log(`Fixture source: ${options.gradeAppDir}`);
  console.log(`Academy scope: ${options.academyId || 'global shared content'}`);
  console.log(`Include unverified: ${options.includeUnverified ? 'yes' : 'no'}`);
  console.log('');

  for (const input of inputs) {
    await importBundle(client, loadBundle(input), options);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
