import type { ClassOperationsPermissions } from '../types';

export const NO_CLASS_OPERATIONS_PERMISSIONS: ClassOperationsPermissions = {
  canCreateClass: false,
  canManageGlobalResources: false,
  operatorClassIds: [],
  occurrenceStatusIds: [],
};

export function canOperateClass(
  permissions: ClassOperationsPermissions,
  classId: string | null | undefined,
): boolean {
  if (!classId) return false;
  return permissions.canManageGlobalResources || permissions.operatorClassIds.includes(classId);
}

export function canUpdateOccurrenceStatus(
  permissions: ClassOperationsPermissions,
  classId: string | null | undefined,
  occurrenceId: string | null | undefined,
): boolean {
  if (canOperateClass(permissions, classId)) return true;
  return Boolean(occurrenceId && permissions.occurrenceStatusIds.includes(occurrenceId));
}

export function canCreateSchedule(
  permissions: ClassOperationsPermissions,
  classId?: string | null,
): boolean {
  if (classId) return canOperateClass(permissions, classId);
  return permissions.canManageGlobalResources || permissions.operatorClassIds.length > 0;
}
