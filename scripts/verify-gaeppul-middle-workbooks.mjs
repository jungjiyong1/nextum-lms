import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';

loadEnvFiles();

const manifestPath = resolve(
  process.argv[2] || 'scripts/manifests/gaeppul-middle-light-v1.json',
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const content = client.schema('content');

function hasPrivateAnswerField(value) {
  if (Array.isArray(value)) return value.some(hasPrivateAnswerField);
  if (!value || typeof value !== 'object') return false;
  const privateKeys = new Set([
    'answer',
    'answer_key',
    'correct_index',
    'correct_indices',
    'display',
    'normalized',
  ]);
  return Object.entries(value).some(
    ([field, child]) => privateKeys.has(field) || hasPrivateAnswerField(child),
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((keyName) => `${JSON.stringify(keyName)}:${stableJson(value[keyName])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const bookKeys = manifest.books.map((book) => book.bookKey);
const { data: books, error: booksError } = await content
  .from('books')
  .select('id,book_key,pipeline_version')
  .in('book_key', bookKeys);
if (booksError) throw booksError;

const bookByKey = new Map((books || []).map((book) => [book.book_key, book]));
const failures = [];
let totalProblems = 0;

for (const expected of manifest.books) {
  const book = bookByKey.get(expected.bookKey);
  if (!book) {
    failures.push(`${expected.bookKey}: book missing`);
    continue;
  }
  if (book.pipeline_version !== manifest.pipelineVersion) {
    failures.push(
      `${expected.bookKey}: pipeline=${book.pipeline_version || 'null'} expected=${manifest.pipelineVersion}`,
    );
  }

  const { data: problems, error: problemsError } = await content
    .from('problems')
    .select(
      'id,concept_id,problem_type_id,image_path,answer,answer_key,public_payload,verified,metadata',
    )
    .eq('book_id', book.id)
    .order('id');
  if (problemsError) throw problemsError;

  const { data: assets, error: assetsError } = await content
    .from('assets')
    .select('problem_id,storage_path')
    .eq('book_id', book.id)
    .eq('kind', 'problem_image');
  if (assetsError) throw assetsError;
  const assetByProblem = new Map((assets || []).map((asset) => [asset.problem_id, asset.storage_path]));

  const supersededRows = (problems || []).filter(
    (problem) => problem.metadata?.superseded_by_pipeline === manifest.pipelineVersion,
  );
  const rows = (problems || []).filter(
    (problem) => problem.metadata?.superseded_by_pipeline !== manifest.pipelineVersion,
  );
  totalProblems += rows.length;
  if (rows.length !== expected.problemCount) {
    failures.push(`${expected.bookKey}: problems=${rows.length} expected=${expected.problemCount}`);
  }

  for (const problem of rows) {
    const prefix = `${expected.bookKey}/${problem.id}`;
    if (!problem.image_path) failures.push(`${prefix}: image_path missing`);
    if (assetByProblem.get(problem.id) !== problem.image_path) {
      failures.push(`${prefix}: problem_image asset mismatch`);
    }
    if (problem.answer?.type !== 'choice') failures.push(`${prefix}: answer is not choice`);
    if (stableJson(problem.answer) !== stableJson(problem.answer_key)) {
      failures.push(`${prefix}: answer_key mismatch`);
    }
    if (!problem.public_payload || hasPrivateAnswerField(problem.public_payload)) {
      failures.push(`${prefix}: invalid public_payload`);
    }
    if (problem.metadata?.delivery_verified !== true) {
      failures.push(`${prefix}: delivery_verified is not true`);
    }
    const splitStatus = problem.metadata?.objective_conversion?.split_status;
    if (splitStatus === 'unresolved' || splitStatus === 'count_mismatch') {
      failures.push(`${prefix}: unresolved subquestions`);
    }
  }

  const verifiedCount = rows.filter((problem) => problem.verified).length;
  const conceptLinkedCount = rows.filter((problem) => problem.concept_id).length;
  const typeLinkedCount = rows.filter((problem) => problem.problem_type_id).length;
  if (verifiedCount !== expected.verifiedCount) {
    failures.push(
      `${expected.bookKey}: verified=${verifiedCount} expected=${expected.verifiedCount}`,
    );
  }
  if (conceptLinkedCount !== expected.conceptLinkedCount) {
    failures.push(
      `${expected.bookKey}: concept links=${conceptLinkedCount} expected=${expected.conceptLinkedCount}`,
    );
  }
  if (typeLinkedCount !== expected.typeLinkedCount) {
    failures.push(
      `${expected.bookKey}: type links=${typeLinkedCount} expected=${expected.typeLinkedCount}`,
    );
  }

  console.log(
    `${expected.bookKey}: problems=${rows.length} verified=${verifiedCount} concepts=${conceptLinkedCount} types=${typeLinkedCount} superseded=${supersededRows.length}`,
  );
}

if (totalProblems !== manifest.problemCount) {
  failures.push(`total problems=${totalProblems} expected=${manifest.problemCount}`);
}
if (failures.length > 0) {
  throw new Error(
    `Gaeppul ${manifest.family} verification failed (${failures.length}):\n${failures.slice(0, 30).join('\n')}`,
  );
}

console.log(`Verified ${manifest.books.length} ${manifest.family} books and ${totalProblems} problems.`);
