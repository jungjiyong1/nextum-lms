export function isExplicitFeatureEnabled(value: string | null | undefined): boolean {
    return value?.trim().toLowerCase() === 'true';
}
