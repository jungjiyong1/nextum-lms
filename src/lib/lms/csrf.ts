export const LMS_CSRF_COOKIE = 'nextum_lms_csrf';
export const LMS_CSRF_HEADER = 'x-nextum-lms-csrf';

export function csrfCookieOptions() {
    return {
        sameSite: 'strict' as const,
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 8,
    };
}

export function getCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
    if (!cookieHeader) return null;

    for (const part of cookieHeader.split(';')) {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (rawName === name) {
            return decodeURIComponent(rawValue.join('='));
        }
    }

    return null;
}

export function isValidCsrfPair(headerValue: string | null, cookieHeader: string | null): boolean {
    const cookieValue = getCookieValue(cookieHeader, LMS_CSRF_COOKIE);
    return Boolean(headerValue && cookieValue && headerValue === cookieValue);
}
