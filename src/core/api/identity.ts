import { coreDb, lmsDb } from '../supabaseClient';
import type { User } from '../supabaseClient';
import { normalizeAppRole, type AppRole } from '../auth/roles';
import { asSupabaseError, shouldFallbackToLegacy } from './shared/dbFallback';

export type AcademyId = number | string;
export type { AppRole };

export interface AuthProfile {
    id: string;
    email: string | null;
    full_name: string | null;
    role: AppRole;
    current_academy_id: AcademyId | null;
    created_at: string;
    updated_at: string;
    pin_hash?: string | null;
    idle_timeout?: number;
}

export interface SecuritySettings {
    pin_hash: string | null;
    idle_timeout: number;
    source: 'core' | 'legacy' | 'none';
}

type RawRecord = Record<string, unknown>;

const DEFAULT_IDLE_TIMEOUT = 10;

function nowIso() {
    return new Date().toISOString();
}

function asRecord(value: unknown): RawRecord | null {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) return asRecord(value[0]);
    return value as RawRecord;
}

function pickString(row: RawRecord | null, keys: string[]): string | null {
    if (!row) return null;
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
}

function pickDate(row: RawRecord | null, keys: string[]): string | null {
    return pickString(row, keys);
}

function normalizeAcademyId(value: unknown): AcademyId | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || value.length === 0) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && String(numeric) === value ? numeric : value;
}

function normalizeIdleTimeout(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return DEFAULT_IDLE_TIMEOUT;
}

function isMissingColumn(error: unknown): boolean {
    const supabaseError = asSupabaseError(error);
    const message = `${supabaseError.message ?? ''} ${supabaseError.details ?? ''}`;
    return supabaseError.code === '42703' || message.toLowerCase().includes('column');
}

async function readCoreRowByColumn(
    table: string,
    column: string,
    value: string,
): Promise<RawRecord | null> {
    const { data, error } = await coreDb
        .from(table)
        .select('*')
        .eq(column, value)
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return asRecord(data);
}

async function readCoreAccount(userId: string): Promise<RawRecord | null> {
    for (const column of ['auth_user_id', 'user_id', 'id']) {
        try {
            const row = await readCoreRowByColumn('user_accounts', column, userId);
            if (row) return row;
        } catch (error) {
            if (isMissingColumn(error)) continue;
            throw error;
        }
    }

    return null;
}

async function readCoreMembership(userId: string, account: RawRecord): Promise<RawRecord | null> {
    const personId = pickString(account, ['person_id', 'personId']);
    const accountId = pickString(account, ['id', 'account_id']);
    const candidates = [
        ['person_id', personId],
        ['account_id', accountId],
        ['user_id', userId],
        ['auth_user_id', userId],
    ] as const;

    for (const [column, value] of candidates) {
        if (!value) continue;
        try {
            const row = await readCoreRowByColumn('academy_members', column, value);
            if (row) return row;
        } catch (error) {
            if (isMissingColumn(error)) continue;
            throw error;
        }
    }

    return null;
}

async function readCoreSecuritySettings(userId: string, account?: RawRecord | null): Promise<SecuritySettings | null> {
    const accountId = pickString(account ?? null, ['id', 'account_id']);
    const candidates = [
        ['user_account_id', accountId],
        ['account_id', accountId],
        ['user_id', userId],
        ['auth_user_id', userId],
    ] as const;

    for (const [column, value] of candidates) {
        if (!value) continue;
        try {
            const row = await readCoreRowByColumn('user_security_settings', column, value);
            if (row) {
                return {
                    pin_hash: pickString(row, ['pin_hash']),
                    idle_timeout: normalizeIdleTimeout(row.idle_timeout),
                    source: 'core',
                };
            }
        } catch (error) {
            if (isMissingColumn(error)) continue;
            throw error;
        }
    }

    return null;
}

async function readLegacySecuritySettings(userId: string): Promise<SecuritySettings> {
    const { data, error } = await lmsDb
        .from('profiles')
        .select('pin_hash, idle_timeout')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        if (shouldFallbackToLegacy(error)) {
            return { pin_hash: null, idle_timeout: DEFAULT_IDLE_TIMEOUT, source: 'none' };
        }
        throw error;
    }

    const row = asRecord(data);
    if (!row) return { pin_hash: null, idle_timeout: DEFAULT_IDLE_TIMEOUT, source: 'none' };

    return {
        pin_hash: pickString(row, ['pin_hash']),
        idle_timeout: normalizeIdleTimeout(row.idle_timeout),
        source: 'legacy',
    };
}

export async function loadSecuritySettings(userId: string, account?: RawRecord | null): Promise<SecuritySettings> {
    let coreAccount = account;

    if (coreAccount === undefined) {
        try {
            coreAccount = await readCoreAccount(userId);
        } catch (error) {
            if (!shouldFallbackToLegacy(error)) {
                console.warn('[Identity] Core account lookup failed; falling back to lms.profiles:', error);
            }
            coreAccount = null;
        }
    }

    if (coreAccount) {
        try {
            const coreSettings = await readCoreSecuritySettings(userId, coreAccount);
            if (coreSettings) return coreSettings;
        } catch (error) {
            if (!shouldFallbackToLegacy(error)) {
                console.warn('[Identity] Core security lookup failed; falling back to lms.profiles:', error);
            }
        }
    }

    return readLegacySecuritySettings(userId);
}

async function writeCoreSecuritySettings(
    userId: string,
    updates: Partial<Pick<SecuritySettings, 'pin_hash' | 'idle_timeout'>>,
): Promise<boolean> {
    const account = await readCoreAccount(userId);
    const accountId = pickString(account, ['id', 'account_id']);
    if (!accountId) return false;

    const { error } = await coreDb
        .from('user_security_settings')
        .upsert({ user_account_id: accountId, ...updates }, { onConflict: 'user_account_id' });

    if (!error) return true;
    if (shouldFallbackToLegacy(error)) return false;
    throw error;
}

async function writeLegacySecuritySettings(
    userId: string,
    updates: Partial<Pick<SecuritySettings, 'pin_hash' | 'idle_timeout'>>,
): Promise<void> {
    const { error } = await lmsDb
        .from('profiles')
        .update(updates)
        .eq('id', userId);

    if (error) throw error;
}

export async function updateSecuritySettings(
    userId: string,
    updates: Partial<Pick<SecuritySettings, 'pin_hash' | 'idle_timeout'>>,
): Promise<void> {
    const wroteCore = await writeCoreSecuritySettings(userId, updates);
    if (wroteCore) return;
    await writeLegacySecuritySettings(userId, updates);
}

async function loadCoreProfile(user: Pick<User, 'id' | 'email'>): Promise<AuthProfile | null> {
    const account = await readCoreAccount(user.id);
    if (!account) return null;

    const personId = pickString(account, ['person_id', 'personId']);
    let person: RawRecord | null = null;
    if (personId) {
        person = await readCoreRowByColumn('people', 'id', personId);
    }

    const membership = await readCoreMembership(user.id, account);
    const security = await loadSecuritySettings(user.id, account);
    const createdAt = pickDate(account, ['created_at']) ?? pickDate(person, ['created_at']) ?? nowIso();
    const updatedAt = pickDate(account, ['updated_at']) ?? pickDate(person, ['updated_at']) ?? createdAt;

    return {
        id: user.id,
        email: pickString(account, ['email', 'auth_email', 'login_email'])
            ?? pickString(person, ['email'])
            ?? user.email
            ?? null,
        full_name: pickString(person, ['full_name', 'name'])
            ?? pickString(account, ['full_name', 'name'])
            ?? null,
        role: normalizeAppRole(membership?.role),
        current_academy_id: normalizeAcademyId(
            membership?.academy_id ?? account.current_academy_id ?? account.academy_id,
        ),
        created_at: createdAt,
        updated_at: updatedAt,
        pin_hash: security.pin_hash,
        idle_timeout: security.idle_timeout,
    };
}

async function loadLegacyProfile(user: Pick<User, 'id' | 'email'>): Promise<AuthProfile | null> {
    const { data, error } = await lmsDb
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (error) throw error;
    const row = asRecord(data);
    if (!row) return null;

    return {
        id: user.id,
        email: pickString(row, ['email']) ?? user.email ?? null,
        full_name: pickString(row, ['full_name', 'name']),
        role: normalizeAppRole(row.role),
        current_academy_id: normalizeAcademyId(row.current_academy_id),
        created_at: pickDate(row, ['created_at']) ?? nowIso(),
        updated_at: pickDate(row, ['updated_at']) ?? pickDate(row, ['created_at']) ?? nowIso(),
        pin_hash: pickString(row, ['pin_hash']),
        idle_timeout: normalizeIdleTimeout(row.idle_timeout),
    };
}

export async function loadAuthProfile(user: Pick<User, 'id' | 'email'>): Promise<AuthProfile | null> {
    let coreProfile: AuthProfile | null = null;

    try {
        coreProfile = await loadCoreProfile(user);
        if (coreProfile?.current_academy_id) return coreProfile;
    } catch (error) {
        if (!shouldFallbackToLegacy(error)) {
            console.warn('[Identity] Core profile lookup failed; falling back to lms.profiles:', error);
        }
    }

    try {
        return await loadLegacyProfile(user);
    } catch (error) {
        if (coreProfile) return coreProfile;
        throw error;
    }
}
