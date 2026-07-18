import type { AppRole } from '@/core/auth/roles';

export const LMS_ACADEMY_COOKIE = 'nextum_lms_academy';

export interface AccessibleAcademy {
    id: string;
    name: string;
    role: AppRole;
}

export function findSelectedAcademy(
    academies: readonly AccessibleAcademy[],
    selectedAcademyId: string | null | undefined,
): AccessibleAcademy | null {
    if (!selectedAcademyId) return null;
    return academies.find((academy) => academy.id === selectedAcademyId) ?? null;
}

export function academySelectionRequired(
    academies: readonly AccessibleAcademy[],
    selectedAcademyId: string | null | undefined,
): boolean {
    return academies.length > 1 && !findSelectedAcademy(academies, selectedAcademyId);
}
