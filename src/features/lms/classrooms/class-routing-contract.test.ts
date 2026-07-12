import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('class detail route contract', () => {
  it('redirects the class root to its schedule and exposes every detail section', () => {
    const rootPage = source('src/app/(app)/classrooms/[classId]/page.tsx');
    expect(rootPage).toContain('/schedule${suffix}`');
    for (const section of ['schedule', 'students', 'learning', 'materials', 'settings']) {
      expect(() => source(`src/app/(app)/classrooms/[classId]/${section}/page.tsx`)).not.toThrow();
    }
  });

  it('removes the standalone learning navigation and redirects legacy learning URLs', () => {
    const sidebar = source('src/components/layout/Sidebar.tsx');
    const learningPage = source('src/app/(app)/learning/page.tsx');
    const examsPage = source('src/app/(app)/learning/exams/page.tsx');
    expect(sidebar).not.toContain("id: 'learning'");
    expect(sidebar).not.toContain("label: '학습 분석'");
    expect(learningPage).toContain("'/classrooms'");
    expect(learningPage).toContain('/learning`');
    expect(examsPage).toContain('/learning${suffix}`');
  });
});
