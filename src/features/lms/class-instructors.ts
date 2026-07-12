export function normalizeClassInstructorIds(
  instructorIds: string[] | undefined,
  legacyDefaultInstructorId?: string | null,
): string[] {
  const source = instructorIds === undefined ? [legacyDefaultInstructorId] : instructorIds;
  return [...new Set(source.filter((id): id is string => Boolean(id?.trim())).map((id) => id.trim()))];
}

export function toggleClassInstructorId(current: string[], instructorId: string, selected: boolean): string[] {
  if (selected) return current.includes(instructorId) ? current : [...current, instructorId];
  return current.filter((id) => id !== instructorId);
}

export function removedClassInstructorIds(currentActiveIds: string[], desiredIds: string[]): string[] {
  const desired = new Set(desiredIds);
  return [...new Set(currentActiveIds)].filter((id) => !desired.has(id));
}
