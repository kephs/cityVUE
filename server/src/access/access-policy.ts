import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  permissions,
  type Permission,
  type StaffAccess,
} from '../auth/auth.types.js';

export const accessPrerequisites = [
  'admin.configuration.read',
  'admin.access.read',
  'admin.access.manage',
] as const;
type Category =
  | 'Administrative Configuration'
  | 'Service Requests'
  | 'Sensitive Information'
  | 'Specialized Capabilities';
interface Definition {
  label: string;
  description: string;
  category: Category;
  classification: 'manageable' | 'provisioning-only';
  sensitive: boolean;
  requires: readonly Permission[];
  contextual: string;
}
const definition = (
  label: string,
  description: string,
  category: Category,
  requires: readonly Permission[] = [],
  sensitive = false,
  contextual = '',
  classification: Definition['classification'] = 'manageable',
): Definition => ({
  label,
  description,
  category,
  requires,
  sensitive,
  contextual,
  classification,
});
const parent =
  'Requires the applicable PUBLIC or INTERNAL parent read permission and current request scope.';
export const accessPermissionMetadata = {
  'admin.configuration.read': definition(
    'View configuration',
    'Read Organization administration configuration.',
    'Administrative Configuration',
  ),
  'admin.issues.write': definition(
    'Manage Issues',
    'Create and configure Issues.',
    'Administrative Configuration',
    ['admin.configuration.read'],
  ),
  'admin.intake_settings.write': definition(
    'Manage intake settings',
    'Configure Organization intake settings.',
    'Administrative Configuration',
    ['admin.configuration.read'],
  ),
  'admin.participation_areas.write': definition(
    'Manage participation areas',
    'Configure participation areas.',
    'Administrative Configuration',
    ['admin.configuration.read'],
  ),
  'admin.access.read': definition(
    'View staff access',
    'Inspect access configuration and history.',
    'Administrative Configuration',
    ['admin.configuration.read'],
    true,
    '',
    'provisioning-only',
  ),
  'admin.access.manage': definition(
    'Manage staff access',
    'Manage other staff operational access through governed commands.',
    'Administrative Configuration',
    ['admin.configuration.read', 'admin.access.read'],
    true,
    'Provisioning controlled; no runtime delegation.',
    'provisioning-only',
  ),
  'catalog.issue_action.manage': definition(
    'Manage Issue Handling',
    'Read scoped Handling; Admin writes require additional permissions.',
    'Administrative Configuration',
    ['admin.configuration.read', 'admin.issues.write'],
    true,
    'F057 authoring prerequisites; existing action-only scoped reads remain valid. Department and Division scope is separately enforced.',
  ),
  'service_request.reference.manage': definition(
    'Manage request references',
    'Configure Organization request reference numbering.',
    'Administrative Configuration',
  ),
  'analytics.service_participation.read': definition(
    'View participation analytics',
    'Read scoped, suppressed participation aggregates.',
    'Specialized Capabilities',
    ['service_request.view'],
    true,
  ),
  'geospatial.read': definition(
    'Read geospatial services',
    'Use protected Organization geospatial capabilities.',
    'Specialized Capabilities',
    [],
    false,
    '',
    'provisioning-only',
  ),
  'ai.workspace.access': definition(
    'Use AI workspace',
    'Access the policy-controlled AI workspace.',
    'Specialized Capabilities',
    [],
    true,
    'Deployment policy also applies.',
    'provisioning-only',
  ),
  'ai.administration.access': definition(
    'Administer AI',
    'Reserved AI administration authority.',
    'Specialized Capabilities',
    ['ai.workspace.access'],
    true,
    'No administration route is introduced.',
    'provisioning-only',
  ),
  'service_request.view': definition(
    'Read PUBLIC requests',
    'Read PUBLIC requests within operational scope.',
    'Service Requests',
  ),
  'service_request.internal.read': definition(
    'Read INTERNAL requests',
    'Read INTERNAL requests within operational scope.',
    'Service Requests',
  ),
  'service_request.create': definition(
    'Create requests',
    'Submit staff-assisted requests through eligible catalog entries.',
    'Service Requests',
  ),
  'service_request.create_internal': definition(
    'Create INTERNAL requests',
    'Submit INTERNAL requests.',
    'Service Requests',
    ['service_request.create'],
  ),
  'service_request.internal.update': definition(
    'Update INTERNAL requests',
    'Perform authorized INTERNAL operations.',
    'Service Requests',
    [],
    false,
    'Unified operations require INTERNAL read; legacy update-only admission is retained.',
  ),
  'service_request.contact.read': definition(
    'Read requester contact',
    'Disclose eligible requester contact with audit.',
    'Sensitive Information',
    [],
    true,
    parent + ' Anonymous contact remains prohibited.',
  ),
  'service_request.answers.read': definition(
    'Read submitted answers',
    'Disclose historical submitted answers with audit.',
    'Sensitive Information',
    [],
    true,
    parent,
  ),
  'service_request.note.read': definition(
    'Read Internal Notes',
    'Read staff-only request notes.',
    'Sensitive Information',
    [],
    true,
    parent,
  ),
  'service_request.note.create': definition(
    'Create Internal Notes',
    'Append staff-only request notes.',
    'Sensitive Information',
    ['service_request.note.read'],
    true,
    parent,
  ),
  'service_request.communication.read': definition(
    'Read requester communication',
    'Read PUBLIC requester correspondence.',
    'Sensitive Information',
    ['service_request.view'],
    true,
  ),
  'service_request.communication.create': definition(
    'Create requester communication',
    'Append eligible PUBLIC requester correspondence.',
    'Sensitive Information',
    ['service_request.view', 'service_request.communication.read'],
    true,
    'Anonymous requests are ineligible; no delivery authority is implied.',
  ),
  'service_request.tracking.manage': definition(
    'Manage requester tracking',
    'Issue, rotate and revoke PUBLIC tracking credentials.',
    'Sensitive Information',
    ['service_request.view'],
    true,
  ),
  'service_request.assign': definition(
    'Assign requests',
    'Change PUBLIC request ownership.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.route': definition(
    'Route requests',
    'Route PUBLIC requests within authorized scope.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.watchers.manage': definition(
    'Manage watchers',
    'Manage PUBLIC request watchers.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.start_work': definition(
    'Start work',
    'Start work on eligible PUBLIC requests.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.hold': definition(
    'Hold requests',
    'Place eligible PUBLIC requests on hold.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.resume': definition(
    'Resume requests',
    'Resume eligible PUBLIC requests.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.close': definition(
    'Close requests',
    'Close eligible PUBLIC requests.',
    'Service Requests',
    ['service_request.view'],
  ),
  'service_request.reopen': definition(
    'Reopen requests',
    'Reopen eligible PUBLIC requests.',
    'Service Requests',
    ['service_request.view'],
  ),
} satisfies Record<Permission, Definition>;
export const manageablePermissions = permissions
  .filter(
    (key) => accessPermissionMetadata[key].classification === 'manageable',
  )
  .sort();

export function assertAccessAuthority(
  access: StaffAccess,
  manage = false,
): void {
  const required = manage
    ? accessPrerequisites
    : accessPrerequisites.slice(0, 2);
  if (
    access.development ||
    !access.tenantId ||
    !access.objectId ||
    required.some((p) => !access.permissions.includes(p))
  )
    throw new ForbiddenException('Access denied');
}
export function validateManagedPermissions(value: unknown): Permission[] {
  if (
    !Array.isArray(value) ||
    value.length > 27 ||
    value.some(
      (key) =>
        typeof key !== 'string' ||
        !manageablePermissions.includes(key as Permission),
    )
  )
    throw new BadRequestException('Select only manageable permissions');
  return [...new Set(value as Permission[])].sort();
}
export function validateAccessDependencies(
  desired: readonly Permission[],
  locked: readonly Permission[],
): void {
  const final = new Set([...desired, ...locked]);
  // F057 final-state validation does not mutate legacy/provisioned contributions.
  const violations = [...final]
    .filter((p) => accessPermissionMetadata[p].classification === 'manageable')
    .flatMap((p) =>
      accessPermissionMetadata[p].requires
        .filter((required) => !final.has(required))
        .map((required) => `${p} requires ${required}`),
    );
  if (violations.length) throw new BadRequestException(violations.join('; '));
}
