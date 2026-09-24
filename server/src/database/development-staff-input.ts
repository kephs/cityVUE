import type { Permission } from '../auth/auth.types.js';
import { validateEnvironment } from '../config/environment.js';

/** Local tooling manifest only. Never imported by runtime authorization. */
const fullUatOperatorPermissions = [
  'service_request.tracking.manage',
  'service_request.create',
  'service_request.create_internal',
  'service_request.internal.read',
  'service_request.contact.read',
  'service_request.note.read',
  'service_request.note.create',
  'service_request.communication.read',
  'service_request.communication.create',
  'service_request.internal.update',
  'catalog.issue_action.manage',
  'service_request.reference.manage',
  'service_request.view',
  'service_request.start_work',
  'service_request.hold',
  'service_request.resume',
  'service_request.close',
  'service_request.reopen',
  'service_request.assign',
  'service_request.route',
  'service_request.watchers.manage',
] as const satisfies readonly Permission[];

export const developmentStaffPermissions = [
  'admin.intake_settings.write',
  'admin.configuration.read',
  'analytics.service_participation.read',
  ...fullUatOperatorPermissions,
  'geospatial.read',
] as const satisfies readonly Permission[];

export const developmentStaffBundles = {
  INTERNAL_REQUEST_READER: ['service_request.internal.read'],
  INTERNAL_REQUEST_OPERATOR: [
    'service_request.internal.read',
    'service_request.internal.update',
  ],
  CATALOG_ADMIN_TESTER: ['catalog.issue_action.manage'],
  REFERENCE_ADMIN_TESTER: ['service_request.reference.manage'],
  INTAKE_TESTER: ['service_request.create', 'service_request.create_internal'],
  FULL_UAT_OPERATOR: fullUatOperatorPermissions,
} as const satisfies Record<string, readonly Permission[]>;

export const developmentOrganization = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'CityVUE Development Municipality',
  slug: 'cityvue-development',
} as const;

export interface DevelopmentStaffScope {
  departmentId: string;
  divisionId: string | null;
}

export const developmentUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertDevelopmentDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid development database target');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== 'localhost' ||
    url.port !== '5432' ||
    url.pathname !== '/reqro_dev' ||
    url.username !== 'reqro_dev_user' ||
    url.search !== '' ||
    url.hash !== ''
  )
    throw new Error('Expected localhost:5432 / reqro_dev / reqro_dev_user');
  return url;
}

/** Check raw values before Joi defaults: absence must never imply opt-in. */
export function developmentStaffEnvironment(
  input: Record<string, string | undefined>,
) {
  if (
    input.NODE_ENV !== 'development' ||
    input.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    input.CITYVUE_ENABLE_EXTERNAL_IDENTITY !== 'true' ||
    !input.ENTRA_TENANT_ID ||
    !developmentUuid.test(input.ENTRA_TENANT_ID) ||
    input.F036_PERSONAL_ENTRA_TENANT_ID !== input.ENTRA_TENANT_ID ||
    !input.ENTRA_API_CLIENT_ID ||
    !input.ENTRA_EXPECTED_AUDIENCE
  )
    throw new Error(
      'Explicit personal development identity configuration required',
    );
  assertDevelopmentDatabaseUrl(input.DATABASE_URL ?? '');
  return validateEnvironment(input);
}

export function selectedDevelopmentPermissions(
  permissionList: string | undefined,
  bundle: string | undefined,
): Permission[] {
  if (Boolean(permissionList) === Boolean(bundle))
    throw new Error('Select explicit permissions OR one development bundle');
  let selected: readonly string[];
  if (bundle) {
    if (!Object.hasOwn(developmentStaffBundles, bundle))
      throw new Error('Unknown development permission bundle');
    selected =
      developmentStaffBundles[bundle as keyof typeof developmentStaffBundles];
  } else selected = (permissionList ?? '').split(',');
  if (
    selected.length === 0 ||
    selected.some(
      (key) => !developmentStaffPermissions.some((known) => known === key),
    )
  )
    throw new Error('Unknown or unsupported development permission');
  return [...new Set(selected)] as Permission[];
}

export function selectedDevelopmentScopes(
  value: string | undefined,
): DevelopmentStaffScope[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? '');
  } catch {
    throw new Error('Explicit development scopes JSON required');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 10)
    throw new Error('Select between one and ten explicit development scopes');
  const scopes: DevelopmentStaffScope[] = [];
  for (const entry of parsed as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Invalid development scope');
    const record = entry as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !['departmentId', 'divisionId'].includes(key),
      ) ||
      typeof record.departmentId !== 'string' ||
      !developmentUuid.test(record.departmentId) ||
      !(
        record.divisionId === null ||
        (typeof record.divisionId === 'string' &&
          developmentUuid.test(record.divisionId))
      )
    )
      throw new Error('Invalid development scope');
    const scope = {
      departmentId: record.departmentId,
      divisionId: record.divisionId,
    };
    if (
      scopes.some(
        (item) =>
          item.departmentId === scope.departmentId &&
          item.divisionId === scope.divisionId,
      )
    )
      throw new Error('Duplicate development scope');
    scopes.push(scope);
  }
  return scopes;
}
