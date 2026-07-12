export interface StudentLearningAttemptFact {
  problemId: string;
  correct: boolean;
  attemptNo: number;
  createdAt: string;
}

export interface RecentFirstAttemptSummary {
  sampleCount: number;
  correctCount: number;
  correctRate: number | null;
  correctedProblemCount: number;
  lastLearningAt: string | null;
}

export function summarizeRecentFirstAttempts(
  attempts: StudentLearningAttemptFact[],
  limit = 20,
): RecentFirstAttemptSummary {
  const grouped = new Map<string, StudentLearningAttemptFact[]>();
  for (const attempt of attempts) grouped.set(attempt.problemId, [...(grouped.get(attempt.problemId) || []), attempt]);
  const recent = [...grouped.values()]
    .map((rows) => rows.sort((a, b) => a.attemptNo - b.attemptNo || a.createdAt.localeCompare(b.createdAt)))
    .sort((a, b) => String(b[0]?.createdAt || '').localeCompare(String(a[0]?.createdAt || '')))
    .slice(0, Math.max(0, limit));
  const correctCount = recent.filter((rows) => rows[0]?.correct === true).length;
  return {
    sampleCount: recent.length,
    correctCount,
    correctRate: recent.length > 0 ? Math.round((correctCount / recent.length) * 1000) / 10 : null,
    correctedProblemCount: recent.filter((rows) => rows[0]?.correct === false && rows.slice(1).some((row) => row.correct)).length,
    lastLearningAt: recent[0]?.[0]?.createdAt || null,
  };
}
