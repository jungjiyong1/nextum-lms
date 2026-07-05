import { existsSync, readFileSync } from 'fs';

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex <= 0) return null;

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? [key, value] : null;
}

export function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const file of files) {
    if (!existsSync(file)) continue;

    const content = readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;

      const [key, value] = parsed;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
