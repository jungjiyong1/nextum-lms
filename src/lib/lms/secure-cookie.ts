export function shouldUseSecureCookies(request: Request): boolean {
    if (process.env.NODE_ENV !== 'production') return false;

    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (forwardedProto === 'https') return true;

    return new URL(request.url).protocol === 'https:';
}
