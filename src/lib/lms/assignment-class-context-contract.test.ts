import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/lib/lms/mutations.ts'), 'utf8');

describe('assignment class context preservation contract', () => {
  it('captures normalized class context in immutable assignment metadata', () => {
    expect(source).toContain('async function loadAssignmentClassContextSnapshots');
    expect(source).toContain(".from('class_target_grades')");
    expect(source).toContain(".from('subjects')");
    expect(source).toContain(".from('courses')");
    expect(source).toContain('classContexts: classContextSnapshots');
    expect(source).toContain('capturedAt');
  });
});
