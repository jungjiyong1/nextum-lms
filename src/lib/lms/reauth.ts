import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { LmsAuthError } from './auth';

const COOKIE_NAME = 'nextum_lms_reauth';
const MAX_AGE_SECONDS = 5 * 60;
const CLOCK_SKEW_SECONDS = 30;

interface ReauthPayload {
    userId: string;
    academyId: string;
    issuedAt: number;
    expiresAt: number;
}

function signingSecret() {
    const secret = process.env.LMS_REAUTH_SECRET
        || process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Missing LMS reauth signing secret.');
    return secret;
}

function encodeJson(value: ReauthPayload) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value: string): ReauthPayload {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ReauthPayload;
}

function sign(payload: string) {
    return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function signaturesMatch(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function createReauthToken(userId: string, academyId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const payload = encodeJson({
        userId,
        academyId,
        issuedAt: nowSeconds,
        expiresAt: nowSeconds + MAX_AGE_SECONDS,
    });

    return `${payload}.${sign(payload)}`;
}

function parseReauthToken(token: string): ReauthPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
        throw new LmsAuthError('Recent password confirmation is required.', 403);
    }

    const [payload, signature] = parts;
    if (!payload || !signature || !signaturesMatch(sign(payload), signature)) {
        throw new LmsAuthError('Recent password confirmation is required.', 403);
    }

    let parsed: ReauthPayload;
    try {
        parsed = decodeJson(payload);
    } catch {
        throw new LmsAuthError('Recent password confirmation is required.', 403);
    }

    if (
        typeof parsed.userId !== 'string'
        || typeof parsed.academyId !== 'string'
        || typeof parsed.issuedAt !== 'number'
        || typeof parsed.expiresAt !== 'number'
    ) {
        throw new LmsAuthError('Recent password confirmation is required.', 403);
    }

    return parsed;
}

export async function setReauthCookie(userId: string, academyId: string, options: { secure?: boolean } = {}) {
    const cookieStore = await cookies();
    cookieStore.set({
        name: COOKIE_NAME,
        value: createReauthToken(userId, academyId),
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secure ?? process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: MAX_AGE_SECONDS,
    });
}

export async function assertReauthCookie(input: { userId: string; academyId: string }) {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) throw new LmsAuthError('Recent password confirmation is required.', 403);

    const payload = parseReauthToken(token);
    const now = Math.floor(Date.now() / 1000);
    if (
        payload.userId !== input.userId
        || payload.academyId !== input.academyId
        || payload.issuedAt > now + CLOCK_SKEW_SECONDS
        || payload.expiresAt < now
    ) {
        throw new LmsAuthError('Recent password confirmation is required.', 403);
    }
}
