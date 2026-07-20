import { brotliCompressSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const nextDir = join(process.cwd(), '.next');
const appDir = join(nextDir, 'server', 'app');
const budgetsByBundler = {
  turbopack: {
    login: 100 * 1024,
    feature: 150 * 1024,
    pdfAssignmentMatch: 155 * 1024,
  },
  webpack: {
    // Login's own page chunk is ~3 KiB; the rest of its measured total is
    // app-wide shared client chunks (incl. ~54 KiB supabase-js) that shift
    // ±0.5 KiB whenever any route is added. 144 keeps the same guard with
    // headroom for that shared-chunk noise (2026-07-20 measurement).
    login: 144 * 1024,
    feature: 180 * 1024,
    pdfAssignmentMatch: 187 * 1024,
  },
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
  const source = readFileSync(path, 'utf8').trim();
  const manifestMarker = '__RSC_MANIFEST["';
  const markerStart = source.indexOf(manifestMarker);
  if (markerStart < 0 || !source.endsWith(';')) return null;
  const keyEnd = source.indexOf('"]', markerStart + manifestMarker.length);
  const assignmentStart = source.indexOf('=', keyEnd + 2);
  if (keyEnd < 0 || assignmentStart < 0) return null;
  return JSON.parse(source.slice(assignmentStart + 1, -1).trim());
}

function manifestJavaScriptAssets(manifest) {
  const entryAssets = Object.values(manifest.entryJSFiles ?? {}).flat();
  if (entryAssets.length > 0) return entryAssets;
  return Object.values(manifest.clientModules ?? {})
    .flatMap((clientModule) => clientModule.chunks ?? [])
    .filter((asset) => asset.startsWith('static/') && asset.endsWith('.js'));
}

function manifestBundler(manifest) {
  return Object.keys(manifest.entryJSFiles ?? {}).length > 0 ? 'turbopack' : 'webpack';
}

function routeBudget(route, bundler) {
  const budgets = budgetsByBundler[bundler];
  if (route === '/login') return budgets.login;
  if (route === '/assignments/pdf-match') return budgets.pdfAssignmentMatch;
  return budgets.feature;
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

  const assets = [...new Set(manifestJavaScriptAssets(manifest))];
  const bytes = assets.reduce((total, asset) => total + compressedSize(join(nextDir, decodeURIComponent(asset))), 0);
  const route = relative(appDir, path)
    .replaceAll(sep, '/')
    .replace('/page_client-reference-manifest.js', '')
    .replace(/^\(app\)\/?/, '/')
    .replace(/^login$/, '/login') || '/';
  const bundler = manifestBundler(manifest);
  const limit = routeBudget(route, bundler);

  if (bytes > limit) failures.push({ route, bytes, limit });
  return { route, bytes, limit, bundler };
}).sort((left, right) => left.route.localeCompare(right.route));

for (const { route, bytes, limit, bundler } of results) {
  console.log(`${route.padEnd(32)} ${(bytes / 1024).toFixed(1)} KiB / ${(limit / 1024).toFixed(0)} KiB (${bundler})`);
}

if (failures.length > 0) {
  const details = failures
    .map(({ route, bytes, limit }) => `${route}: ${(bytes / 1024).toFixed(1)} KiB > ${(limit / 1024).toFixed(0)} KiB`)
    .join('\n');
  throw new Error(`Client bundle budget exceeded:\n${details}`);
}
