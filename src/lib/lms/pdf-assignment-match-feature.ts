import 'server-only';

import { isFeatureEnabledUnlessExplicitlyDisabled } from '@/lib/feature-flags';

export function isPdfAssignmentMatchEnabled(): boolean {
    return isFeatureEnabledUnlessExplicitlyDisabled(process.env.PDF_ASSIGNMENT_MATCH_ENABLED);
}
