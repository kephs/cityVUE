import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertStaffRequestIdentity } from '../service-request/staff-request-scope.js';

export function assertConfigurationRead(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  assertStaffRequestIdentity(access);
  if (!access.permissions.includes('admin.configuration.read'))
    throw new ForbiddenException('Access denied');
}

export function configurationPage(value: string | undefined): number {
  if (value === undefined) return 1;
  if (!/^[1-9][0-9]{0,5}$/.test(value))
    throw new BadRequestException('Invalid configuration page');
  return Number(value);
}

export interface ConfigurationHealth {
  severity: 'OK' | 'WARNING';
  resource: string;
  message: string;
}
export function participationHealth(
  enabled: boolean,
  activeAreas: number,
): ConfigurationHealth {
  return {
    severity: enabled && activeAreas === 0 ? 'WARNING' : 'OK',
    resource: 'Service Participation',
    message: !enabled
      ? 'Collection is disabled.'
      : activeAreas === 0
        ? 'Collection is enabled but no active Participation Areas are configured. Intake will not collect participation geography until an area is available.'
        : `Collection is enabled with ${String(activeAreas)} active Participation Areas.`,
  };
}

/** Future writes must persist this allowlisted metadata atomically with the resource change.
 * This is a contract, not a writer or a read-audit event. No arbitrary before/after payloads. */
export interface ConfigurationMutationAudit {
  organizationId: string;
  actorStaffId: string;
  correlationId: string;
  occurredAt: Date;
  action: 'configuration_changed';
  resourceType:
    | 'issue_action'
    | 'identity_policy'
    | 'default_assignment'
    | 'participation_collection'
    | 'participation_area';
  resourceId: string;
  priorRevision: number;
  revision: number;
  changedFields: readonly (
    | 'action'
    | 'policy'
    | 'assignment'
    | 'collectionEnabled'
    | 'displayName'
    | 'active'
    | 'displayOrder'
  )[];
}
