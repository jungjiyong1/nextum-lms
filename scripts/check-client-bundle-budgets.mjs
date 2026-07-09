import { brotliCompressSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const nextDir = join(process.cwd(), '.next');
const appDir = join(nextDir, 'server', 'app');
const budgets = {
  login: 100 * 1024,
  feature: 150 * 1024,
};

if (!existsSync(appDir)) {
  throw new Error('Missing .next build output. Run `npm run build` before bundle:check.');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readManifest(path) {
  const assignment = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.includes('__RSC_MANIFEST["'));

  if (!assignment) return null;
  const marker = ' = ';
  const start = assignment.indexOf(marker);
  if (start < 0 || !assignment.endsWith(';')) return null;
  return JSON.parse(assignment.slice(start + marker.length, -1));
}

const compressedSizes = new Map();
function compressedSize(path) {
  if (!compressedSizes.has(path)) {
    compressedSizes.set(path, brotliCompressSync(readFileSync(path)).byteLength);
  }
  return compressedSizes.get(path);
}

const pageManifests = walk(appDir).filter((path) =>
  path.endsWith(`page_client-reference-manifest.js`)
  && !path.includes(`${sep}api${sep}`)
  && !path.includes(`${sep}_global-error${sep}`)
  && !path.includes(`${sep}_not-found${sep}`),
);

const failures = [];
const results = pageManifests.map((path) => {
  const manifest = readManifest(path);
  if (!manifest) throw new Error(`Unable to parse client reference manifest: ${path}`);

  const assets = [...new Set(Object.values(manifest.entryJSFiles ?? {}).flat())];
  const bytes = assets.reduce((total, asset) => total + compressedSize(join(nextDir, asset)), 0);
  const route = relative(appDir, path)
    .replaceAll(sep, '/')
    .replace('/page_client-reference-manifest.js', '')
    .replace(/^\(app\)\/?/, '/')
    .replace(/^login$/, '/login') || '/';
  const limit = route === '/login' ? budgets.login : budgets.feature;

  if (bytes > limit) failures.push({ route, bytes, limit });
  return { route, bytes, limit };
}).sort((left, right) => left.route.localeCompare(right.route));

for (const { route, bytes, limit } of results) {
  console.log(`${route.padEnd(32)} ${(bytes / 1024).toFixed(1)} KiB / ${(limit / 1024).toFixed(0)} KiB`);
}

if (failures.length > 0) {
  const details = failures
    .map(({ route, bytes, limit }) => `${route}: ${(bytes / 1024).toFixed(1)} KiB > ${(limit / 1024).toFixed(0)} KiB`)
    .join('\n');
  throw new Error(`Client bundle budget exceeded:\n${details}`);
}
