import { describe, expect, it } from 'vitest';
import { summarizeRecentFirstAttempts, type StudentLearningAttemptFact } from './student-learning-metrics';

describe('summarizeRecentFirstAttempts', () => {
  it('uses only the latest twenty problems and keeps later correction separate from first-attempt accuracy', () => {
    const attempts: StudentLearningAttemptFact[] = Array.from({ length: 25 }, (_, index) => ({
      problemId: `problem-${index}`,
      correct: index % 2 === 0,
      attemptNo: 1,
      createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    attempts.push({ problemId: 'problem-23', correct: true, attemptNo: 2, createdAt: '2026-07-26T00:00:00Z' });

    const result = summarizeRecentFirstAttempts(attempts);

    expect(result.sampleCount).toBe(20);
    expect(result.correctCount).toBe(10);
    expect(result.correctRate).toBe(50);
    expect(result.correctedProblemCount).toBe(1);
    expect(result.lastLearningAt).toBe('2026-07-25T00:00:00Z');
  });

  it('returns an empty, non-invented score without evidence', () => {
    expect(summarizeRecentFirstAttempts([])).toEqual({
      sampleCount: 0,
      correctCount: 0,
      correctRate: null,
      correctedProblemCount: 0,
      lastLearningAt: null,
    });
  });
});
