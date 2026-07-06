import 'server-only';

import { LmsAuthError } from './auth';
import { isValidCsrfPair, LMS_CSRF_HEADER } from './csrf';

export function assertCsrfToken(request: Request) {
    if (!isValidCsrfPair(request.headers.get(LMS_CSRF_HEADER), request.headers.get('cookie'))) {
        throw new LmsAuthError('Invalid admin request token.', 403);
    }
}
