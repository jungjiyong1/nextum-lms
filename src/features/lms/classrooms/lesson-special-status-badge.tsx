import { StatusBadge } from '@/components/ui/status-badge';
import type { LessonOccurrenceStatus } from '../types';
import { isSpecialLessonStatus, specialLessonStatusLabels } from './schedule-utils';

export function LessonSpecialStatusBadge({
  status,
  className,
}: {
  status: LessonOccurrenceStatus;
  className?: string;
}) {
  if (!isSpecialLessonStatus(status)) return null;

  return <StatusBadge status={status} label={specialLessonStatusLabels[status]} className={className} />;
}
