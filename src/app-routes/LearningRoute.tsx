'use client';

import { LearningAnalysisClient } from '@/features/lms/learning-analysis-client';
import type { LearningAnalysisTab } from '@/features/lms/learning-analysis-types';
import { RouteScroll } from './RouteScroll';

export function LearningRoute({
  initialTab = 'class-learning',
  initialPlanId = null,
}: {
  initialTab?: LearningAnalysisTab;
  initialPlanId?: string | null;
}) {
  return (
    <RouteScroll>
      <LearningAnalysisClient initialTab={initialTab} initialPlanId={initialPlanId} />
    </RouteScroll>
  );
}
