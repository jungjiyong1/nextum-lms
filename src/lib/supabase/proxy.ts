import { createServerClient } from '@supabase/ssr';
import { randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { isProtectedAppPath, isPublicAuthPath } from '@/lib/lms/routes';
import { csrfCookieOptions, LMS_CSRF_COOKIE } from '@/lib/lms/csrf';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function redirectWithSessionCookies(request: NextRequest, response: NextResponse, pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';

    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
        redirect.cookies.set(cookie);
    });

    ['Cache-Control', 'Expires', 'Pragma'].forEach((header) => {
        const value = response.headers.get(header);
        if (value) redirect.headers.set(header, value);
    });

    return redirect;
}

function withCsrfCookie(request: NextRequest, response: NextResponse) {
    if (!request.cookies.get(LMS_CSRF_COOKIE)?.value) {
        response.cookies.set({
            name: LMS_CSRF_COOKIE,
            value: randomBytes(32).toString('base64url'),
            ...csrfCookieOptions(),
        });
    }
    return response;
}

export async function updateSession(request: NextRequest) {
    let response = NextResponse.next({
        request,
    });

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        return withCsrfCookie(request, response);
    }

    const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet, headers) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                response = NextResponse.next({
                    request,
                });
                cookiesToSet.forEach(({ name, value, options }) => {
                    response.cookies.set(name, value, options);
                });
                Object.entries(headers).forEach(([key, value]) => {
                    response.headers.set(key, value);
                });
            },
        },
    });

    const { data } = await supabase.auth.getClaims();

    const pathname = request.nextUrl.pathname;
    if (!data?.claims && isProtectedAppPath(pathname)) {
        return withCsrfCookie(request, redirectWithSessionCookies(request, response, '/login'));
    }

    if (data?.claims && isPublicAuthPath(pathname)) {
        return withCsrfCookie(request, redirectWithSessionCookies(request, response, '/'));
    }

    return withCsrfCookie(request, response);
}
