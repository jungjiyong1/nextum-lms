const PROTECTED_APP_PATH_PREFIXES = [
    '/accounting',
    '/assignments',
    '/classrooms',
    '/instructors',
    '/settings',
    '/students',
];

function normalizePathname(pathname: string) {
    if (pathname.length > 1 && pathname.endsWith('/')) {
        return pathname.slice(0, -1);
    }
    return pathname;
}

export function isProtectedAppPath(pathname: string): boolean {
    const normalized = normalizePathname(pathname);
    if (normalized === '/') return true;

    return PROTECTED_APP_PATH_PREFIXES.some((prefix) => (
        normalized === prefix || normalized.startsWith(`${prefix}/`)
    ));
}

export function isPublicAuthPath(pathname: string): boolean {
    const normalized = normalizePathname(pathname);
    return normalized === '/login'
        || normalized.startsWith('/login/');
}

export function isApiPath(pathname: string): boolean {
    const normalized = normalizePathname(pathname);
    return normalized === '/api' || normalized.startsWith('/api/');
}
