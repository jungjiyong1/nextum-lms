import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260711104501_normalize_lesson_occurrence_status.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

describe('lesson occurrence status normalization migration', () => {
  it('backfills both temporal states into one canonical normal state', () => {
    expect(migration).toContain("set status = 'normal'");
    expect(migration).toContain("where status in ('scheduled', 'completed')");
    expect(migration).toContain("alter column status set default 'normal'");
  });

  it('allows only normal and operational exceptions in persisted rows', () => {
    expect(migration).toContain("check (status in ('normal', 'cancelled', 'makeup', 'substitute'))");
    expect(migration).not.toMatch(/check \(status in \([^)]*'scheduled'/);
    expect(migration).not.toMatch(/check \(status in \([^)]*'completed'/);
  });

  it('canonicalizes legacy writes before the table constraint runs', () => {
    expect(migration).toContain('before insert or update of status on lms.lesson_occurrences');
    expect(migration).toContain("if new.status in ('scheduled', 'completed') then");
    expect(migration).toContain("new.status := 'normal'");
  });
});
