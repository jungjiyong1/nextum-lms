import 'server-only';

import { shouldUseSecureCookies } from './secure-cookie';

export function academyCookieOptions(request: Request) {
    return {
        httpOnly: true,
        sameSite: 'strict' as const,
        secure: shouldUseSecureCookies(request),
        path: '/',
        maxAge: 60 * 60 * 12,
    };
}
