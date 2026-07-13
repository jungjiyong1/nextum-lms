import 'server-only';

import { isExplicitFeatureEnabled } from '@/lib/feature-flags';

export function isPdfAssignmentMatchEnabled(): boolean {
    return isExplicitFeatureEnabled(process.env.PDF_ASSIGNMENT_MATCH_ENABLED);
}
