import { getCookieValue, LMS_CSRF_COOKIE, LMS_CSRF_HEADER } from './csrf';

export function csrfHeaders(): Record<string, string> {
    if (typeof document === 'undefined') return {};
    const token = getCookieValue(document.cookie, LMS_CSRF_COOKIE);
    return token ? { [LMS_CSRF_HEADER]: token } : {};
}

export function jsonCsrfHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        ...csrfHeaders(),
    };
}
