#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;
const WRITE_CHUNK_SIZE = 200;
const EXACT_BAND = new Map([
  ['하', 1],
  ['중', 2],
  ['상', 3],
  ['최상', 4],
]);

function printHelp() {
  console.log(`Usage:
  npm run db:bootstrap-learning-analysis -- --book-id <uuid> [options]

Options:
  --book-id <uuid>       Source content.books id (required)
  --challenge-band <1-4> Override every tagged problem's challenge band
  --apply                Write a draft revision, skills, and pending tags
  --approve              With --apply, publish the revision and approve complete tags
  --force                Replace existing problem tags and repair bootstrap rows
  --help                 Show this help

Safety:
  The default is a read-only dry run. Without --challenge-band, only exact
  difficulty_hint values 하/중/상/최상 are mapped. Untyped or unbanded problems
  are reported and never approved. Generated equivalence keys use problem_id
  because the legacy source has no duplicate-item relationship; review this
  assumption before broad rollout.`);
}

function fail(message) {
  console.error(`Learning-analysis bootstrap failed: ${message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = {
    bookId: null,
    challengeBand: null,
    apply: false,
    approve: false,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--book-id') options.bookId = argv[++index] || null;
    else if (arg.startsWith('--book-id=')) options.bookId = arg.slice('--book-id='.length) || null;
    else if (arg === '--challenge-band') options.challengeBand = Number(argv[++index]);
    else if (arg.startsWith('--challenge-band=')) options.challengeBand = Number(arg.slice('--challenge-band='.length));
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--approve') options.approve = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (options.help) return options;
  if (!options.bookId || !UUID_PATTERN.test(options.bookId)) {
    throw new Error('--book-id must be a UUID');
  }
  if (options.challengeBand !== null && ![1, 2, 3, 4].includes(options.challengeBand)) {
    throw new Error('--challenge-band must be 1, 2, 3, or 4');
  }
  if (options.approve && !options.apply) {
    throw new Error('--approve requires --apply');
  }
  if (options.force && !options.apply) {
    throw new Error('--force requires --apply');
  }
  return options;
}

function chunks(values, size = WRITE_CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadAll(buildQuery, context) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${context}: ${error.message}`);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function inferSchoolType(grade) {
  const value = String(grade || '').trim();
  if (value.startsWith('초')) return 'elementary';
  if (value.startsWith('중')) return 'middle';
  if (value.startsWith('고')) return 'high';
  return null;
}

function inferSemester(book) {
  const value = `${book.grade || ''} ${book.title || ''}`;
  const match = value.match(/(?:초|중|고)?\s*\d+\s*-\s*([12])(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

function canonicalSkillName(value) {
  return String(value || '')
    .replace(/^유형\s*\d+\s*[:：-]\s*/u, '')
    .trim();
}

function bandForProblem(problem, override) {
  if (override !== null) return override;
  return EXACT_BAND.get(String(problem.difficulty_hint || '').trim()) || null;
}

async function loadSource(content, bookId) {
  const { data: book, error: bookError } = await content
    .from('books')
    .select('id,title,subject,grade,book_key')
    .eq('id', bookId)
    .maybeSingle();
  if (bookError) throw new Error(`Could not load book: ${bookError.message}`);
  if (!book) throw new Error('Book was not found');

  const [units, types, problems] = await Promise.all([
    loadAll(
      () => content.from('units').select('id,unit_key,name,sort_order').eq('book_id', bookId).order('sort_order').order('id'),
      'Could not load units',
    ),
    loadAll(
      () => content.from('problem_types').select('id,unit_id,name,sort_order').eq('book_id', bookId).order('sort_order').order('id'),
      'Could not load problem types',
    ),
    loadAll(
      () => content.from('problems').select('id,type_id,unit_id,difficulty_hint').eq('book_id', bookId).order('id'),
      'Could not load problems',
    ),
  ]);
  return { book, units, types, problems };
}

function buildPreview(source, options) {
  const unitById = new Map(source.units.map((unit) => [unit.id, unit]));
  const typeById = new Map(source.types.map((type) => [type.id, type]));
  const problems = source.problems.map((problem) => ({
    ...problem,
    challengeBand: bandForProblem(problem, options.challengeBand),
  }));
  const typed = problems.filter((problem) => problem.type_id && typeById.has(problem.type_id));
  const untyped = problems.filter((problem) => !problem.type_id || !typeById.has(problem.type_id));
  const unbanded = typed.filter((problem) => problem.challengeBand === null);
  const complete = typed.filter((problem) => problem.challengeBand !== null);
  const usedTypeIds = new Set(typed.map((problem) => problem.type_id));
  const skills = source.types
    .filter((type) => usedTypeIds.has(type.id))
    .map((type, index) => {
      const unit = unitById.get(type.unit_id) || null;
      return {
        code: `legacy-type:${type.id}`,
        subject: String(source.book.subject || 'unknown'),
        school_type: inferSchoolType(source.book.grade),
        grade: source.book.grade || null,
        semester: inferSemester(source.book),
        unit_code: unit?.unit_key || null,
        unit_name: String(unit?.name || '단원 미지정'),
        name: canonicalSkillName(type.name) || String(type.name || `유형 ${index + 1}`),
        active: true,
        sort_order: Number.isFinite(Number(type.sort_order)) ? Number(type.sort_order) : index,
        metadata: {
          bootstrap_source: 'legacy_problem_type',
          source_book_id: source.book.id,
          source_book_key: source.book.book_key,
          legacy_problem_type_id: type.id,
          legacy_name: type.name,
        },
      };
    });
  return { unitById, typeById, problems, typed, untyped, unbanded, complete, skills };
}

function printPreview(source, preview, options) {
  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'}: ${source.book.title} (${source.book.id})`);
  console.log(`  problems: ${source.problems.length}`);
  console.log(`  typed / skills: ${preview.typed.length} / ${preview.skills.length}`);
  console.log(`  missing type: ${preview.untyped.length}`);
  console.log(`  missing challenge band: ${preview.unbanded.length}`);
  console.log(`  eligible for approval: ${preview.complete.length}`);
  console.log('  equivalence assumption: each legacy problem_id is treated as a distinct item');
  if (!options.apply) console.log('  No rows were written. Add --apply after reviewing this summary.');
}

async function findOrCreateRevision(content, source, options) {
  const revisions = await loadAll(
    () => content.from('analysis_taxonomy_revisions').select('id,revision_number,status,metadata').order('revision_number', { ascending: false }),
    'Could not load taxonomy revisions',
  );
  const existing = revisions.find((revision) =>
    revision.metadata?.bootstrap_book_id === source.book.id
    && revision.metadata?.bootstrap_kind === 'legacy_book_pilot',
  );
  if (existing) return existing;

  const revisionNumber = (revisions[0]?.revision_number || 0) + 1;
  const { data, error } = await content
    .from('analysis_taxonomy_revisions')
    .insert({
      revision_number: revisionNumber,
      status: 'draft',
      summary: `Legacy pilot bootstrap: ${source.book.title}`,
      metadata: {
        bootstrap_kind: 'legacy_book_pilot',
        bootstrap_book_id: source.book.id,
        bootstrap_book_key: source.book.book_key,
        equivalence_assumption: 'each_problem_id_is_distinct',
        created_by_script: 'scripts/bootstrap-learning-analysis.mjs',
      },
    })
    .select('id,revision_number,status,metadata')
    .single();
  if (error) throw new Error(`Could not create taxonomy revision: ${error.message}`);
  if (!data?.id) throw new Error('Taxonomy revision insert returned no id');
  if (options.approve) console.log(`  created draft revision ${revisionNumber}; it will publish after staging rows`);
  return data;
}

async function upsertSkills(content, revision, preview, options) {
  const existing = await loadAll(
    () => content.from('analysis_skills').select('id,code').eq('taxonomy_revision_id', revision.id).order('id'),
    'Could not load existing analysis skills',
  );
  const existingByCode = new Map(existing.map((row) => [row.code, row]));
  const writable = revision.status !== 'published' || options.force;
  const writeRows = preview.skills
    .filter((skill) => writable && (options.force || !existingByCode.has(skill.code)))
    .map((skill) => ({
      ...skill,
      taxonomy_revision_id: revision.id,
    }));

  for (const batch of chunks(writeRows)) {
    const query = options.force
      ? content.from('analysis_skills').upsert(batch, { onConflict: 'taxonomy_revision_id,code' })
      : content.from('analysis_skills').insert(batch);
    const { error } = await query;
    if (error) throw new Error(`Could not write analysis skills: ${error.message}`);
  }

  const rows = await loadAll(
    () => content.from('analysis_skills').select('id,code').eq('taxonomy_revision_id', revision.id).order('id'),
    'Could not reload analysis skills',
  );
  return {
    rows,
    insertedOrUpdated: writeRows.length,
    skipped: preview.skills.length - writeRows.length,
  };
}

async function stageTags(content, source, revision, preview, skillRows, options) {
  const skillByCode = new Map(skillRows.map((row) => [row.code, row.id]));
  const existingRows = [];
  for (const ids of chunks(preview.typed.map((problem) => problem.id), 300)) {
    const { data, error } = await content
      .from('problem_analysis_tags')
      .select('problem_id')
      .eq('taxonomy_revision_id', revision.id)
      .in('problem_id', ids);
    if (error) throw new Error(`Could not load existing problem tags: ${error.message}`);
    existingRows.push(...(data || []));
  }
  const existingIds = new Set(existingRows.map((row) => row.problem_id));
  const now = new Date().toISOString();
  const writable = revision.status !== 'published' || options.force;
  const rows = preview.typed
    .filter((problem) => writable && (options.force || !existingIds.has(problem.id)))
    .map((problem) => {
      const skillId = skillByCode.get(`legacy-type:${problem.type_id}`);
      if (!skillId) throw new Error(`No generated skill for legacy type ${problem.type_id}`);
      return {
        problem_id: problem.id,
        analysis_skill_id: skillId,
        taxonomy_revision_id: revision.id,
        challenge_band: problem.challengeBand,
        equivalence_key: `legacy-problem:${problem.id}`,
        source_kind: 'legacy',
        source_ref: source.book.id,
        confidence: problem.challengeBand === null ? null : 0.7,
        review_status: 'pending',
        reviewed_at: null,
        metadata: {
          bootstrap_kind: 'legacy_book_pilot',
          source_book_id: source.book.id,
          equivalence_assumption: 'each_problem_id_is_distinct',
          challenge_band_source: options.challengeBand !== null
            ? 'operator_override'
            : problem.challengeBand !== null ? 'exact_difficulty_hint' : 'missing',
          staged_at: now,
          change_reason: 'pilot taxonomy bootstrap',
        },
      };
    });

  for (const batch of chunks(rows)) {
    const query = options.force
      ? content.from('problem_analysis_tags').upsert(batch, {
        onConflict: 'problem_id,taxonomy_revision_id',
      })
      : content.from('problem_analysis_tags').insert(batch);
    const { error } = await query;
    if (error) throw new Error(`Could not stage problem tags: ${error.message}`);
  }
  return { written: rows.length, skipped: preview.typed.length - rows.length };
}

async function publishAndApprove(content, revision, preview) {
  if (revision.status === 'draft') {
    const { error } = await content
      .from('analysis_taxonomy_revisions')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', revision.id)
      .eq('status', 'draft');
    if (error) throw new Error(`Could not publish taxonomy revision: ${error.message}`);
  } else if (revision.status !== 'published') {
    throw new Error(`Revision ${revision.revision_number} has status ${revision.status} and cannot be approved`);
  }

  const completeIds = preview.complete.map((problem) => problem.id);
  let approved = 0;
  const reviewedAt = new Date().toISOString();
  for (const ids of chunks(completeIds, 300)) {
    const { data, error } = await content
      .from('problem_analysis_tags')
      .update({ review_status: 'approved', reviewed_at: reviewedAt })
      .eq('taxonomy_revision_id', revision.id)
      .in('problem_id', ids)
      .not('challenge_band', 'is', null)
      .not('equivalence_key', 'is', null)
      .select('problem_id');
    if (error) throw new Error(`Could not approve complete problem tags: ${error.message}`);
    approved += data?.length || 0;
  }
  return approved;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    printHelp();
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  loadEnvFiles();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    fail('Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const content = client.schema('content');
    const source = await loadSource(content, options.bookId);
    const preview = buildPreview(source, options);
    printPreview(source, preview, options);
    if (!options.apply) return;
    if (preview.skills.length === 0 || preview.typed.length === 0) {
      throw new Error('No typed problems are available to bootstrap');
    }

    const revision = await findOrCreateRevision(content, source, options);
    if (revision.status === 'published' && options.force && !options.approve) {
      throw new Error('--force on a published bootstrap revision requires --approve');
    }
    if (revision.status === 'published' && !options.force) {
      console.log(`  revision ${revision.revision_number} is already published; existing rows will only be skipped`);
    }
    const skillResult = await upsertSkills(content, revision, preview, options);
    const tagResult = await stageTags(content, source, revision, preview, skillResult.rows, options);
    let approved = 0;
    if (options.approve) approved = await publishAndApprove(content, revision, preview);

    console.log(`  revision: ${revision.revision_number} (${options.approve ? 'published' : revision.status})`);
    console.log(`  skills written / skipped: ${skillResult.insertedOrUpdated} / ${skillResult.skipped}`);
    console.log(`  tags written / skipped: ${tagResult.written} / ${tagResult.skipped}`);
    console.log(`  tags approved / pending because band is missing: ${approved} / ${preview.unbanded.length}`);
    console.log('Bootstrap finished. Review pending rows and equivalence assumptions before expanding the pilot.');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

await main();
