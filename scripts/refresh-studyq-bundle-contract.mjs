import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { canonicalStringify, sha256 } from './import-studyq-bank.mjs';

const bundle = resolve(process.argv[2] || '');
if (!bundle) throw new Error('Usage: node scripts/refresh-studyq-bundle-contract.mjs <bundle-dir>');
const readJson = (name) => JSON.parse(readFileSync(join(bundle, name), 'utf8'));
const readJsonl = (name) => readFileSync(join(bundle, name), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const writeJson = (name, value) => writeFileSync(join(bundle, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const writeJsonl = (name, values) => writeFileSync(join(bundle, name), `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
const hashFile = (name) => sha256(readFileSync(join(bundle, name)));

const problems = readJsonl('problems.jsonl');
const refs = readJsonl('source_refs.jsonl');
const refsByCode = new Map(refs.map((ref) => [ref.external_id, ref]));
for (const row of problems) {
  const unitKey = row.unit.unit_key;
  const conceptName = row.concept.name;
  const rawTypeName = row.problem_type.name_raw || row.problem_type.name;
  row.problem_type.name = `${conceptName} · ${rawTypeName}`;
  row.problem_type.name_raw = rawTypeName;
  const typeName = row.problem_type.name;
  row.problem_type.type_key = `studyq_${sha256(`${unitKey}\u0000${conceptName}\u0000${typeName}`).slice(0, 20)}`;
  delete row.content_sha256;
  row.content_sha256 = sha256(canonicalStringify(row));
  const ref = refsByCode.get(row.external_id);
  if (!ref) throw new Error(`Missing source ref for ${row.external_id}`);
  ref.content_sha256 = row.content_sha256;
}
writeJsonl('problems.jsonl', problems);
writeJsonl('source_refs.jsonl', refs);

const manifest = readJson('manifest.json');
for (const name of ['problems.jsonl', 'source_refs.jsonl', 'taxonomy.json']) {
  const text = readFileSync(join(bundle, name), 'utf8').trim();
  manifest.files[name] = {
    sha256: hashFile(name),
    row_count: name.endsWith('.jsonl') ? (text ? text.split(/\r?\n/).length : 0) : readJson(name).problem_tags.length,
  };
}
delete manifest.bundle_sha256;
manifest.bundle_sha256 = sha256(canonicalStringify(manifest));
writeJson('manifest.json', manifest);
const approval = readJson('approval.json');
approval.bundle_sha256 = manifest.bundle_sha256;
writeJson('approval.json', approval);
console.log(`Refreshed ${problems.length} problem rows in ${bundle}`);
