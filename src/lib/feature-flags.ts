export function isFeatureEnabledUnlessExplicitlyDisabled(value: string | null | undefined): boolean {
    return value?.trim().toLowerCase() !== 'false';
}
