export const GEOSPATIAL_READ_PERMISSION = 'geospatial.read' as const;

export const permissions = [
  'catalog.issue_action.manage',
  'service_request.reference.manage',
  GEOSPATIAL_READ_PERMISSION,
  'ai.workspace.access',
  'ai.administration.access',
  'service_request.view',
  'service_request.create',
  'service_request.create_internal',
  'service_request.internal.read',
  'service_request.contact.read',
  'service_request.internal.update',
  'service_request.assign',
  'service_request.start_work',
  'service_request.hold',
  'service_request.resume',
  'service_request.close',
  'service_request.reopen',
] as const;
export type Permission = (typeof permissions)[number];
export interface StaffAccess {
  tenantId: string | null;
  objectId: string | null;
  staffIdentityId: string;
  organizationId: string;
  displayName: string;
  preferredUsername?: string;
  scopes: string[];
  permissions: Permission[];
  departmentIds: string[];
  divisionIds: string[];
  development: boolean;
}
