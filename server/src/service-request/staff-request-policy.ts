import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
import type { WorkflowActionDto } from './service-request.dto.js';
import { resolveWorkflowTransition } from './service-request.domain.js';
import {
  assertStaffRequestRead,
  type StaffRequestAudience,
} from './staff-request-scope.js';

export const publicWorkflowPermissions = {
  start_work: 'service_request.start_work',
  hold: 'service_request.hold',
  resume: 'service_request.resume',
  close: 'service_request.close',
  reopen: 'service_request.reopen',
} as const satisfies Record<WorkflowActionDto['action'], Permission>;

export type StaffRequestOperation =
  WorkflowActionDto['action'] | 'route' | 'assign' | 'watchers' | 'self_watch';

export function persistedRequestAudience(value: string): StaffRequestAudience {
  if (value !== 'public' && value !== 'internal') throw new NotFoundException();
  return value;
}

export function requestOperationPermission(
  audience: StaffRequestAudience,
  operation: StaffRequestOperation,
): Permission | null {
  if (operation === 'self_watch') return null;
  if (audience === 'internal') return 'service_request.internal.update';
  if (operation === 'route') return 'service_request.route';
  if (operation === 'assign') return 'service_request.assign';
  if (operation === 'watchers') return 'service_request.watchers.manage';
  return publicWorkflowPermissions[operation];
}

/** Apply only to a parent admitted by the trusted Organization/scope query. */
export function assertRequestOperation(
  access: StaffAccess,
  audience: StaffRequestAudience,
  operation: StaffRequestOperation,
) {
  assertStaffRequestRead(access, audience);
  const permission = requestOperationPermission(audience, operation);
  if (permission !== null && !access.permissions.includes(permission)) {
    throw new ForbiddenException('Access denied');
  }
}

/** Shared by both workspace audiences; capabilities never replace endpoint authorization. */
export function requestCapabilities(
  access: StaffAccess,
  audience: StaffRequestAudience,
  status: string,
) {
  assertStaffRequestRead(access, audience);
  const permitted = (operation: StaffRequestOperation) => {
    const permission = requestOperationPermission(audience, operation);
    return permission === null || access.permissions.includes(permission);
  };
  const workflowActions = (
    Object.keys(publicWorkflowPermissions) as WorkflowActionDto['action'][]
  ).filter((action) => {
    if (!permitted(action)) return false;
    try {
      resolveWorkflowTransition(status, action);
      return true;
    } catch {
      return false;
    }
  });
  return {
    workflowActions,
    canRoute: permitted('route'),
    canAssign: permitted('assign'),
    canManageWatchers: permitted('watchers'),
    canWatchSelf: permitted('self_watch'),
    canReadContact: access.permissions.includes('service_request.contact.read'),
    canReadNotes: access.permissions.includes('service_request.note.read'),
    canCreateNotes:
      access.permissions.includes('service_request.note.read') &&
      access.permissions.includes('service_request.note.create'),
  };
}
