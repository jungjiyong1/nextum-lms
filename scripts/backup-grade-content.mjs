import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
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
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = resolve(outArg ? outArg.slice('--out='.length) : `backups/nextum-data-content-${timestamp}.json`);

const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const requiredTables = [
  'books',
  'units',
  'concepts',
  'problem_types',
  'problems',
];

const optionalTables = [
  'assets',
  'problem_reports',
  'import_batches',
];

const pageSize = 1000;

function formatError(error) {
  const parts = [];
  if (error.code) parts.push(error.code);
  if (error.message) parts.push(error.message);
  if (error.hint) parts.push(`hint: ${error.hint}`);
  return parts.join(' | ') || 'Unknown error';
}

async function exportTable(tableName, required) {
  const rows = [];
  let from = 0;
  let total = null;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error, count } = await supabase
      .schema('content')
      .from(tableName)
      .select('*', { count: from === 0 ? 'exact' : undefined })
      .range(from, to);

    if (error) {
      return {
        tableName,
        required,
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
    tableName,
    required,
    ok: true,
    count: total ?? rows.length,
    rows,
    error: null,
  };
}

const tableNames = [
  ...requiredTables.map((tableName) => ({ tableName, required: true })),
  ...optionalTables.map((tableName) => ({ tableName, required: false })),
];

const exported = [];
for (const table of tableNames) {
  const result = await exportTable(table.tableName, table.required);
  exported.push(result);
  const prefix = result.ok ? 'OK  ' : result.required ? 'FAIL' : 'WARN';
  const suffix = result.ok ? `${result.count} row(s)` : result.error;
  console.log(`${prefix} content.${result.tableName} :: ${suffix}`);
}

const failures = exported.filter((table) => table.required && !table.ok);
if (failures.length > 0) {
  console.error(`${failures.length} required content table(s) failed. Backup was not written.`);
  process.exit(1);
}

const payload = {
  kind: 'nextum-grade-content-backup',
  generatedAt: new Date().toISOString(),
  source: {
    supabaseUrl: url,
    schema: 'content',
  },
  tables: Object.fromEntries(exported.map((table) => [
    table.tableName,
    {
      required: table.required,
      ok: table.ok,
      count: table.count,
      error: table.error,
      rows: table.rows,
    },
  ])),
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
const sha256 = createHash('sha256').update(json).digest('hex');

if (dryRun) {
  console.log(`Dry run complete. Backup would be written to ${outputPath}`);
  console.log(`Payload SHA-256 would be ${sha256}`);
  process.exit(0);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, json, 'utf8');
writeFileSync(`${outputPath}.sha256`, `${sha256}  ${outputPath}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${outputPath}.sha256`);
