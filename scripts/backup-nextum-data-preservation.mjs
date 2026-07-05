import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnvFiles } from './_load-env.mjs';

loadEnvFiles();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const includeStorageFiles = args.has('--include-storage-files');
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const storageDirArg = process.argv.find((arg) => arg.startsWith('--storage-dir='));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = resolve(outArg ? outArg.slice('--out='.length) : `backups/nextum-data-preservation-${timestamp}.json`);
const storageRoot = resolve(storageDirArg ? storageDirArg.slice('--storage-dir='.length) : `${outputPath.replace(/\.json$/i, '')}-storage`);

const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const pageSize = 1000;

const tablePlan = [
  ['core', 'academies', true],
  ['core', 'people', true],
  ['core', 'user_accounts', true],
  ['core', 'students', true],
  ['core', 'staff_members', true],
  ['core', 'academy_members', true],
  ['core', 'classes', true],
  ['core', 'class_students', true],
  ['core', 'class_books', true],
  ['core', 'account_invitations', true],
  ['core', 'user_security_settings', true],
  ['core', 'profiles', false],

  ['content', 'books', true],
  ['content', 'units', true],
  ['content', 'concepts', true],
  ['content', 'problem_types', true],
  ['content', 'problems', true],
  ['content', 'assets', false],
  ['content', 'problem_reports', false],
  ['content', 'import_batches', false],

  ['learning', 'sessions', true],
  ['learning', 'attempts', true],
  ['learning', 'wrong_notes', false],
  ['learning', 'reports', false],
  ['learning', 'assignments', false],
  ['learning', 'assignment_targets', false],
  ['learning', 'book_assignments', false],
  ['learning', 'books', false],
  ['learning', 'units', false],
  ['learning', 'concepts', false],
  ['learning', 'types', false],
  ['learning', 'problems', false],

  ['ai', 'conversations', false],
  ['ai', 'messages', false],
  ['ai', 'attachments', false],

  ['data', 'events', false],

  ['lms', 'academies', false],
  ['lms', 'academy_members', false],
  ['lms', 'account_types', false],
  ['lms', 'classrooms', false],
  ['lms', 'courses', false],
  ['lms', 'enrollments', false],
  ['lms', 'expenses', false],
  ['lms', 'instructor_payments', false],
  ['lms', 'instructors', false],
  ['lms', 'lesson_rules', false],
  ['lms', 'lesson_schedules', false],
  ['lms', 'lessons', false],
  ['lms', 'meta', false],
  ['lms', 'other_income', false],
  ['lms', 'profiles', false],
  ['lms', 'settings', false],
  ['lms', 'student_payments', false],
  ['lms', 'students', false],
  ['lms', 'transaction_lines', false],
  ['lms', 'transactions', false],
].map(([schema, tableName, required]) => ({ schema, tableName, required }));

function formatError(error) {
  const parts = [];
  if (error?.code) parts.push(error.code);
  if (error?.message) parts.push(error.message);
  if (error?.hint) parts.push(`hint: ${error.hint}`);
  return parts.join(' | ') || 'Unknown error';
}

function tableKey({ schema, tableName }) {
  return `${schema}.${tableName}`;
}

async function exportTable(table) {
  const rows = [];
  let from = 0;
  let total = null;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error, count } = await supabase
      .schema(table.schema)
      .from(table.tableName)
      .select('*', { count: from === 0 ? 'exact' : undefined })
      .range(from, to);

    if (error) {
      return {
        ...table,
        ok: false,
        count: 0,
        rows: [],
        error: formatError(error),
      };
    }

    if (from === 0 && typeof count === 'number') {
      total = count;
    }

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return {
    ...table,
    ok: true,
    count: total ?? rows.length,
    rows,
    error: null,
  };
}

function storageEntryPath(prefix, name) {
  return prefix ? `${prefix}/${name}` : name;
}

async function listBucketObjects(bucketName, prefix = '') {
  const objects = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (error) {
      throw new Error(formatError(error));
    }

    const entries = data || [];
    for (const entry of entries) {
      const path = storageEntryPath(prefix, entry.name);
      if (!entry.id && !entry.metadata) {
        objects.push(...await listBucketObjects(bucketName, path));
        continue;
      }

      objects.push({
        ...entry,
        bucket_id: bucketName,
        path,
      });
    }

    if (entries.length < pageSize) break;
    offset += pageSize;
  }

  return objects;
}

async function downloadStorageObject(bucketName, objectPath) {
  const { data, error } = await supabase.storage.from(bucketName).download(objectPath);
  if (error) {
    throw new Error(formatError(error));
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filePath = join(storageRoot, bucketName, objectPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buffer);

  return {
    filePath,
    bytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

async function exportStorage() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    return {
      ok: false,
      error: formatError(error),
      buckets: [],
      objectCount: 0,
      downloadedCount: 0,
      downloadErrorCount: 0,
    };
  }

  const bucketExports = [];
  let objectCount = 0;
  let downloadedCount = 0;
  let downloadErrorCount = 0;

  for (const bucket of buckets || []) {
    try {
      const objects = await listBucketObjects(bucket.name);
      objectCount += objects.length;

      const exportedObjects = [];
      for (const object of objects) {
        const record = { ...object };

        if (includeStorageFiles && !dryRun) {
          try {
            record.download = await downloadStorageObject(bucket.name, object.path);
            downloadedCount += 1;
          } catch (downloadError) {
            record.downloadError = downloadError.message;
            downloadErrorCount += 1;
          }
        }

        exportedObjects.push(record);
      }

      bucketExports.push({
        bucket,
        ok: true,
        count: objects.length,
        objects: exportedObjects,
        error: null,
      });
    } catch (bucketError) {
      bucketExports.push({
        bucket,
        ok: false,
        count: 0,
        objects: [],
        error: bucketError.message,
      });
    }
  }

  return {
    ok: bucketExports.every((bucket) => bucket.ok),
    error: null,
    buckets: bucketExports,
    objectCount,
    downloadedCount,
    downloadErrorCount,
  };
}

const exportedTables = [];
for (const table of tablePlan) {
  const result = await exportTable(table);
  exportedTables.push(result);

  const prefix = result.ok ? 'OK  ' : result.required ? 'FAIL' : 'WARN';
  const suffix = result.ok ? `${result.count} row(s)` : result.error;
  console.log(`${prefix} ${tableKey(result)} :: ${suffix}`);
}

const requiredFailures = exportedTables.filter((table) => table.required && !table.ok);
if (requiredFailures.length > 0) {
  console.error(`${requiredFailures.length} required table(s) failed. Preservation backup was not written.`);
  process.exit(1);
}

const storage = await exportStorage();
if (storage.ok) {
  console.log(`OK   storage manifest :: ${storage.objectCount} object(s) across ${storage.buckets.length} bucket(s)`);
  if (includeStorageFiles) {
    console.log(`${dryRun ? 'SKIP' : 'OK  '} storage files :: ${dryRun ? 'dry-run, files not downloaded' : `${storage.downloadedCount} downloaded object(s)`}`);
    if (!dryRun && storage.downloadErrorCount > 0) {
      console.log(`WARN storage files :: ${storage.downloadErrorCount} download error(s) recorded in backup payload`);
    }
  }
} else {
  console.log(`WARN storage manifest :: ${storage.error}`);
}

const payload = {
  kind: 'nextum-data-preservation-backup',
  generatedAt: new Date().toISOString(),
  source: {
    supabaseUrl: url,
  },
  options: {
    includeStorageFiles,
    storageFilesDownloaded: includeStorageFiles && !dryRun,
  },
  tables: Object.fromEntries(exportedTables.map((table) => [
    tableKey(table),
    {
      schema: table.schema,
      table: table.tableName,
      required: table.required,
      ok: table.ok,
      count: table.count,
      error: table.error,
      rows: table.rows,
    },
  ])),
  storage,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
const sha256 = createHash('sha256').update(json).digest('hex');

if (dryRun) {
  console.log(`Dry run complete. Backup would be written to ${outputPath}`);
  console.log(`Payload SHA-256 would be ${sha256}`);
  if (includeStorageFiles) {
    console.log(`Storage files would be written under ${storageRoot}`);
  }
  process.exit(0);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, json, 'utf8');
writeFileSync(`${outputPath}.sha256`, `${sha256}  ${outputPath}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${outputPath}.sha256`);
if (includeStorageFiles) {
  console.log(`Wrote storage files under ${storageRoot}`);
}
