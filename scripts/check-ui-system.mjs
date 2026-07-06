import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const governedFiles = [
  'src/App.tsx',
  'src/components/layout/Sidebar.tsx',
  'src/components/security/AccessDeniedScreen.tsx',
  'src/components/security/NoAcademyScreen.tsx',
  'src/components/security/PasswordConfirmDialog.tsx',
  'src/components/security/PinLockScreen.tsx',
  'src/components/security/PinSetupDialog.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/features/lms/pages.tsx',
  'src/features/lms/assignments-operations-page.tsx',
  'src/features/lms/students-operations-page.tsx',
  'src/screens/LoginPage.tsx',
];

const governedDirs = [
  'src/components/ui',
];

const legacyPaths = [
  'src/styles',
  'src/components/accounting',
  'src/components/home',
  'src/components/lessons',
  'src/components/people',
  'src/components/settings',
  'src/screens/ClassroomsPage.tsx',
  'src/core/theme.ts',
  'src/core/lessonColors.ts',
];

const rawButtonAllowed = new Set([
  'src/components/ui/button.tsx',
  'src/components/ui/selectable-card.tsx',
]);

const rawTableAllowed = new Set([
  'src/components/ui/data-table.tsx',
]);

const duplicateHelperAllowed = new Set([
  'src/components/ui/page-shell.tsx',
  'src/components/ui/status-badge.tsx',
]);

const hexColorAllowed = new Set([
  'src/features/lms/pages.tsx',
]);

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function collectFiles(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(next);
    if (/\.(tsx?|jsx?)$/.test(entry.name)) return [normalize(next)];
    return [];
  });
}

const files = new Set([
  ...governedFiles.filter(exists),
  ...governedDirs.flatMap(collectFiles),
]);

const failures = [];

for (const legacyPath of legacyPaths) {
  if (exists(legacyPath)) {
    failures.push(`${legacyPath}: legacy UI path should not exist in the current routed LMS UI`);
  }
}

const colorFamilyPattern = /(?:bg|text|border|divide|from|via|to|ring|shadow|focus:ring|hover:bg|hover:text|hover:border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?/g;
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
const arbitraryColorPattern = /(?:bg|text|border|from|via|to|ring|shadow|focus:ring|hover:bg|hover:text|hover:border)-\[([^\]]+)\]/g;

for (const file of [...files].sort()) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const checks = [
    [colorFamilyPattern, 'Use HSL design tokens instead of Tailwind color-family classes'],
    [hexPattern, 'Use HSL design tokens instead of hex colors'],
  ];

  for (const [pattern, message] of checks) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (pattern === hexPattern && hexColorAllowed.has(file)) continue;
      failures.push(`${file}: ${message}: ${match[0]}`);
    }
  }

  arbitraryColorPattern.lastIndex = 0;
  let arbitraryMatch;
  while ((arbitraryMatch = arbitraryColorPattern.exec(text))) {
    const value = arbitraryMatch[1];
    if (/^(#|rgb|rgba|hsl|hsla|oklch|color:)/i.test(value)) {
      failures.push(`${file}: Use tokens instead of arbitrary color class: ${arbitraryMatch[0]}`);
    }
  }

  if (!rawButtonAllowed.has(file) && /<button\b/.test(text)) {
    failures.push(`${file}: raw <button> is not allowed; use src/components/ui/button or a documented primitive`);
  }
  if (!rawTableAllowed.has(file) && /<table\b/.test(text)) {
    failures.push(`${file}: raw <table> is not allowed; use DataTable/Table primitives`);
  }
  if (/<select\b/.test(text)) {
    failures.push(`${file}: raw <select> is not allowed; use Select primitives`);
  }
  if (/<input\b[^>]*type=["']checkbox["']/.test(text)) {
    failures.push(`${file}: raw checkbox input is not allowed; use Checkbox primitive`);
  }
  if (!duplicateHelperAllowed.has(file) && /function\s+(PageShell|StatusBadge|SelectBox)\b/.test(text)) {
    failures.push(`${file}: duplicate PageShell/StatusBadge/SelectBox helper is not allowed`);
  }
  if (/fixed\s+inset-0/.test(text) && /Dialog|Modal|Overlay/.test(text) && !file.includes('/ui/dialog.tsx')) {
    failures.push(`${file}: manual modal overlay detected; use Dialog primitives`);
  }
}

if (failures.length > 0) {
  console.error('UI system check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`UI system check passed (${files.size} governed files).`);
