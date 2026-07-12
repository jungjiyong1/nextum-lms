import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const typesSource = readFileSync('src/features/lms/types.ts', 'utf8');
const querySource = readFileSync('src/lib/lms/student-queries.ts', 'utf8');
const viewSource = readFileSync('src/features/lms/student-learning-view.tsx', 'utf8');

function interfaceBody(name: string): string {
  const start = typesSource.indexOf(`export interface ${name} `);
  const next = typesSource.indexOf('\nexport interface ', start + 1);
  return typesSource.slice(start, next < 0 ? undefined : next);
}

describe('student learning read-model contract', () => {
  it('keeps raw grading rows and AI transcripts out of the initial student detail payload', () => {
    const detail = interfaceBody('StudentDetail');
    const overview = interfaceBody('StudentLearningOverview');

    expect(detail).toContain('learningOverview: StudentLearningOverview | null');
    expect(detail).not.toMatch(/recentAttempts|aiConversations|reports:/);
    expect(overview).toContain('subjects: StudentLearningSubjectSummary[]');
    expect(overview).not.toMatch(/messages|evidence|attempts|units/);
  });

  it('uses approved canonical skills while retaining class, assignment, and book provenance', () => {
    expect(querySource).toContain(".from('problem_analysis_tags')");
    expect(querySource).toContain(".eq('review_status', 'approved')");
    expect(querySource).toContain(".select('id,name')");
    const evidence = interfaceBody('StudentLearningEvidenceRow');
    expect(evidence).toContain('className: string | null');
    expect(evidence).toContain('assignmentTitle: string | null');
    expect(evidence).toContain('bookTitle: string | null');
  });

  it('counts messages for summaries but loads transcript content only from the detail read', () => {
    expect(querySource).toContain(".select('id,conversation_id')");
    expect(querySource).toContain(".filter((row) => row.messageCount > 0)");
    expect(querySource).toContain(".select('id,conversation_id,role,content,created_at')");
    expect(querySource).toContain(".eq('source_app', 'grade_app')");
    expect(querySource).toContain('sessionAssignmentId === assignment.id');
    expect(querySource).toContain('attemptKeys.has');
    expect(viewSource).toContain('AI 연결 확인 필요');
    expect(viewSource).toContain('개인 과제');
    expect(querySource).toContain('if (assignment?.personal) continue');
  });
});
