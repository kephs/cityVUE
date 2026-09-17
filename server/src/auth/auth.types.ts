export const permissions = [
  'geospatial.read',
  'ai.workspace.access',
  'ai.administration.access',
  'service_request.view',
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
