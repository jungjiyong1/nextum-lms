import { describe, expect, it } from 'vitest';
import {
  canCreateSchedule,
  canOperateClass,
  canUpdateOccurrenceStatus,
  NO_CLASS_OPERATIONS_PERMISSIONS,
} from './class-operation-permissions';

describe('class operation UI permissions', () => {
  it('lets managers operate every class and create schedules', () => {
    const permissions = {
      ...NO_CLASS_OPERATIONS_PERMISSIONS,
      canCreateClass: true,
      canManageGlobalResources: true,
    };
    expect(canOperateClass(permissions, 'class-any')).toBe(true);
    expect(canCreateSchedule(permissions)).toBe(true);
    expect(canUpdateOccurrenceStatus(permissions, 'class-any', null)).toBe(true);
  });

  it('lets a durable instructor operate assigned classes only', () => {
    const permissions = {
      ...NO_CLASS_OPERATIONS_PERMISSIONS,
      operatorClassIds: ['class-assigned'],
    };
    expect(canOperateClass(permissions, 'class-assigned')).toBe(true);
    expect(canOperateClass(permissions, 'class-other')).toBe(false);
    expect(canCreateSchedule(permissions, 'class-assigned')).toBe(true);
    expect(canCreateSchedule(permissions, 'class-other')).toBe(false);
  });

  it('limits a one-off participant to the exact occurrence status and attendance surface', () => {
    const permissions = {
      ...NO_CLASS_OPERATIONS_PERMISSIONS,
      occurrenceStatusIds: ['occurrence-one-off'],
    };
    expect(canOperateClass(permissions, 'class-one-off')).toBe(false);
    expect(canCreateSchedule(permissions)).toBe(false);
    expect(canUpdateOccurrenceStatus(permissions, 'class-one-off', 'occurrence-one-off')).toBe(true);
    expect(canUpdateOccurrenceStatus(permissions, 'class-one-off', 'occurrence-other')).toBe(false);
  });
});
