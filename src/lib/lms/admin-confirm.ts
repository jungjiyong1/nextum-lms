import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const DEFAULT_MAX_AGE_SECONDS = 60;
const CLOCK_SKEW_SECONDS = 30;

export interface AdminConfirmScope {
    userId: string;
    academyId: string;
    action: string;
    target: string;
}

interface AdminConfirmPayload extends AdminConfirmScope {
    nonce: string;
    issuedAt: number;
    expiresAt: number;
}

function signingSecret() {
    const secret = process.env.LMS_ADMIN_CONFIRM_SECRET
        || process.env.LMS_REAUTH_SECRET
        || process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Missing LMS admin confirmation signing secret.');
    return secret;
}

function encodeJson(value: AdminConfirmPayload) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value: string): AdminConfirmPayload {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as AdminConfirmPayload;
}

function sign(payload: string) {
    return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function signaturesMatch(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createAdminConfirmToken(
    scope: AdminConfirmScope,
    options: { nowSeconds?: number; maxAgeSeconds?: number } = {},
): { token: string; expiresAt: string } {
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    const payload = encodeJson({
        ...scope,
        nonce: randomBytes(16).toString('base64url'),
        issuedAt: nowSeconds,
        expiresAt: nowSeconds + maxAgeSeconds,
    });

    return {
        token: `${payload}.${sign(payload)}`,
        expiresAt: new Date((nowSeconds + maxAgeSeconds) * 1000).toISOString(),
    };
}

function parseAdminConfirmToken(token: string): AdminConfirmPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
        throw new Error('Invalid admin confirmation token.');
    }

    const [payload, signature] = parts;
    if (!payload || !signature || !signaturesMatch(sign(payload), signature)) {
        throw new Error('Invalid admin confirmation token.');
    }

    const parsed = decodeJson(payload);
    if (
        typeof parsed.userId !== 'string'
        || typeof parsed.academyId !== 'string'
        || typeof parsed.action !== 'string'
        || typeof parsed.target !== 'string'
        || typeof parsed.nonce !== 'string'
        || typeof parsed.issuedAt !== 'number'
        || typeof parsed.expiresAt !== 'number'
    ) {
        throw new Error('Invalid admin confirmation token.');
    }

    return parsed;
}

export function assertAdminConfirmToken(
    token: string,
    expected: AdminConfirmScope,
    nowSeconds = Math.floor(Date.now() / 1000),
) {
    const payload = parseAdminConfirmToken(token);
    if (
        payload.userId !== expected.userId
        || payload.academyId !== expected.academyId
        || payload.action !== expected.action
        || payload.target !== expected.target
        || payload.issuedAt > nowSeconds + CLOCK_SKEW_SECONDS
        || payload.expiresAt < nowSeconds
    ) {
        throw new Error('Invalid admin confirmation token.');
    }
}
