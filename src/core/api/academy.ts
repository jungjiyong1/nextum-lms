// Academy API module
import { coreDb, lmsDb } from '../supabaseClient';
import type { AcademyId } from './identity';
import type { Result } from './shared/types';
import { wrapAsync } from './shared/result';
import { shouldFallbackToLegacy } from './shared/dbFallback';

async function getCoreAcademyName(academyId: AcademyId): Promise<string | null> {
    const { data, error } = await coreDb
        .from('academies')
        .select('name')
        .eq('id', academyId)
        .maybeSingle();

    if (error) throw error;
    return data?.name ?? null;
}

async function getLegacyAcademyName(academyId: AcademyId): Promise<string | null> {
    const { data, error } = await lmsDb
        .from('academies')
        .select('name')
        .eq('id', academyId)
        .maybeSingle();

    if (error) throw error;
    return data?.name ?? null;
}

/**
 * Fetches the academy name by ID
 */
export async function getAcademyName(academyId: AcademyId): Promise<Result<string | null>> {
    return wrapAsync(async () => {
        try {
            const coreName = await getCoreAcademyName(academyId);
            if (coreName) return coreName;
        } catch (error) {
            if (!shouldFallbackToLegacy(error)) {
                console.warn('[Academy] Core academy lookup failed; falling back to lms.academies:', error);
            }
        }

        return getLegacyAcademyName(academyId);
    });
}
