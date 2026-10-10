import type { RequestActivityType } from '../service-request/request-activity.domain.js';
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { AlertType, AlertSeverity } from '../alerts/alert.dto.js';
import type { ResidentExperienceTables } from '../resident-experience/resident-experience.database.js';
import type {
  TenantDomainRole,
  TenantDomainVerificationMethod,
  TenantDomainVerificationState,
} from '../tenancy/tenant-domain.js';
import type {
  ConnectorOperation,
  OrderingGuarantee,
  SideEffectRisk,
} from '../integration/connector-capabilities.js';
import type { ConnectorLifecycleState } from '../integration/delivery-contract.js';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type JsonValue = ColumnType<unknown, unknown, unknown>;

interface OrganizationTable {
  participation_collection_revision: Generated<number>;
  service_participation_collection_enabled: Generated<boolean>;
  id: string;
  name: string;
  short_name: string;
  slug: string;
  status: string;
  default_business_timezone: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface DepartmentTable {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: string;
  display_order: number;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface DivisionTable extends DepartmentTable {
  department_id: string;
}
interface CategoryTable extends DepartmentTable {
  department_id: string;
  division_id: string | null;
  description: string;
  icon_key: string;
  aliases: string[];
  keywords: string[];
}
export interface ServiceDefinitionTable {
  availability: Generated<string>;
  display_order: Generated<number>;
  core_revision: Generated<number>;
  current_display_name: Generated<string | null>;
  id: string;
  organization_id: string;
  category_id: string;
  service_key: string;
  status: string;
  current_published_version_id: string | null;
  action_type: Generated<string>;
  redirect_url: Generated<string | null>;
  redirect_message: Generated<string | null>;
  redirect_label: Generated<string | null>;
  action_revision: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface ServiceDefinitionVersionTable {
  id: string;
  organization_id: string;
  service_definition_id: string;
  version_number: number;
  name: string;
  resident_description: string;
  icon_key: string;
  aliases: string[];
  keywords: string[];
  default_priority: string;
  location_policy: string;
  geographic_eligibility_mode: string;
  geographic_eligibility_policy_reference: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  unable_to_determine_behavior: Generated<string>;
  anonymous_reporting_policy: string;
  status: string;
  published_at: Date | null;
  routing_metadata: JsonValue | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface QuestionTable {
  id: string;
  organization_id: string;
  service_definition_version_id: string;
  question_key: string;
  label: string;
  help_text: string | null;
  question_type: string;
  is_required: boolean;
  display_order: number;
  validation_metadata: JsonValue | null;
  visibility_condition: JsonValue | null;
  status: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface QuestionOptionTable {
  id: string;
  organization_id: string;
  question_id: string;
  option_key: string;
  label: string;
  display_order: number;
  status: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface ReferenceConfigTable {
  organization_id: string;
  prefix: Generated<string>;
  date_component: Generated<string>;
  sequence_width: Generated<number>;
  reset_policy: Generated<string>;
  separator: Generated<string>;
  revision: Generated<number>;
  updated_at: Generated<Timestamp>;
}
interface ReferenceSequenceTable {
  organization_id: string;
  period_key: string;
  last_value: string;
  updated_at: Generated<Timestamp>;
}
export interface ServiceRequestTable {
  requester_geography_state: Generated<
    'PROVIDED' | 'DECLINED' | 'NOT_COLLECTED'
  >;
  participation_area_id: Generated<string | null>;
  requester_id: Generated<string | null>;
  id: string;
  organization_id: string;
  reference_number: string;
  service_definition_id: string;
  service_definition_version_id: string;
  category_id: string;
  status: string;
  priority: string;
  description: string;
  reporting_identity: string;
  audience: Generated<string>;
  intake_channel: Generated<string>;
  submitted_by_staff_identity_id: Generated<string | null>;
  requester_staff_identity_id: Generated<string | null>;
  routed_department_id: Generated<string | null>;
  routed_division_id: Generated<string | null>;
  revision: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface RequesterContactTable {
  id: string;
  organization_id: string;
  service_request_id: string;
  name: string;
  email: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface LocationTable {
  id: string;
  organization_id: string;
  service_request_id: string;
  entered_address: string;
  normalized_address: string | null;
  latitude: ColumnType<number | string | null, number | null, number | null>;
  longitude: ColumnType<number | string | null, number | null, number | null>;
  location_type: string;
  facility_reference: string | null;
  park_reference: string | null;
  parcel_reference: string | null;
  gis_asset_reference: string | null;
  eligibility_result: string | null;
  eligibility_policy_type: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  eligibility_policy_reference: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  eligibility_provider_key: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  eligibility_provider_reference: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  eligibility_reason_code: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  validated_at: Date | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface AnswerTable {
  id: string;
  organization_id: string;
  service_request_id: string;
  question_id: string;
  question_key: string;
  question_label: string;
  question_type: string;
  display_order: number;
  text_value: string | null;
  number_value: string | null;
  boolean_value: boolean | null;
  option_key: string | null;
  display_value: string | null;
  date_value: Generated<string | null>;
  selected_option_count: Generated<number | null>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface AnswerSelectedOptionTable {
  organization_id: string;
  answer_id: string;
  question_id: string;
  option_key: string;
  option_label: Generated<string>;
  display_order: Generated<number>;
}
interface RequestOperationalActivityTable {
  from_target_type: Generated<string | null>;
  from_target_name: Generated<string | null>;
  to_target_type: Generated<string | null>;
  to_target_name: Generated<string | null>;
  event_index: Generated<number>;
  id: Generated<string>;
  organization_id: string;
  service_request_id: string;
  activity_type: RequestActivityType;
  actor_type: 'staff' | 'resident' | 'anonymous_resident' | 'system';
  staff_identity_id: Generated<string | null>;
  occurred_at: Timestamp;
  request_revision: Generated<number | null>;
  is_baseline: Generated<boolean>;
  from_status: Generated<string | null>;
  to_status: Generated<string | null>;
  from_department_id: Generated<string | null>;
  from_division_id: Generated<string | null>;
  to_department_id: Generated<string | null>;
  to_division_id: Generated<string | null>;
  from_department_name: Generated<string | null>;
  from_division_name: Generated<string | null>;
  to_department_name: Generated<string | null>;
  to_division_name: Generated<string | null>;
  narrative: Generated<string | null>;
  intake_channel: Generated<string | null>;
}
interface ActivityTable {
  id: string;
  organization_id: string;
  service_request_id: string;
  activity_type: string;
  actor_type: string;
  actor_reference: string | null;
  staff_identity_id: Generated<string | null>;
  metadata: JsonValue;
  occurred_at: Generated<Timestamp>;
}
interface StaffIdentityTable {
  id: string;
  organization_id: string;
  entra_object_id: string | null;
  entra_tenant_id: Generated<string | null>;
  display_name: string;
  email: string | null;
  active: boolean;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface StaffDepartmentMembershipTable {
  organization_id: string;
  staff_identity_id: string;
  department_id: string;
  active: boolean;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface StaffDivisionMembershipTable extends StaffDepartmentMembershipTable {
  division_id: string;
}
interface WorkGroupTable {
  id: string;
  organization_id: string;
  department_id: string;
  division_id: string | null;
  name: string;
  description: string | null;
  active: boolean;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface WorkGroupMembershipTable {
  organization_id: string;
  work_group_id: string;
  staff_identity_id: string;
  active: boolean;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface ServiceRequestAssignmentTable {
  operational_role_id: Generated<string | null>;
  id: string;
  organization_id: string;
  service_request_id: string;
  assignment_type: string;
  staff_identity_id: string | null;
  work_group_id: string | null;
  department_id: string | null;
  assigned_at: Generated<Timestamp>;
  ended_at: Timestamp | null;
  assigned_by_actor_type: string;
  assigned_by_staff_identity_id: string | null;
  reason: string | null;
  created_at: Generated<Timestamp>;
}
interface PermissionTable {
  permission_key: string;
}
interface RoleTable {
  access_creation_txid: Generated<string | null>;
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface RolePermissionTable {
  organization_id: string;
  role_id: string;
  permission_key: string;
}
export interface StaffRoleAssignmentTable {
  organization_id: string;
  staff_identity_id: string;
  role_id: string;
  active: boolean;
  created_at: Generated<Timestamp>;
}

interface ResidentAlertTable {
  id: Generated<string>;
  organization_id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  starts_at: Date;
  expires_at: Date | null;
  is_active: Generated<boolean>;
  published_at: Date | null;
  deactivated_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string | null;
  updated_by: string | null;
  published_by: string | null;
  deactivated_by: string | null;
}

interface AiUsageTable {
  id: Generated<string>;
  request_id: string;
  organization_id: string;
  staff_identity_id: string;
  model_id: string | null;
  provider_id: string | null;
  quota_policy_id: string | null;
  created_at: Timestamp;
  completed_at: Date | null;
  policy_decision: 'accepted' | 'denied';
  outcome:
    'pending' | 'completed' | 'limited' | 'blocked' | 'failed' | 'denied';
  failure_category: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
}
interface AiAuditEventTable {
  id: Generated<string>;
  organization_id: string;
  usage_id: string;
  event: 'accepted' | 'denied' | 'completed' | 'failed';
  created_at: Timestamp;
}

type OperationalRoleTable = Omit<WorkGroupTable, 'description' | 'updated_at'>;
interface OperationalRoleMembershipTable extends Omit<
  WorkGroupMembershipTable,
  'work_group_id' | 'updated_at'
> {
  operational_role_id: string;
}
interface ServiceRequestWatcherTable {
  id: Generated<string>;
  organization_id: string;
  service_request_id: string;
  target_type: string;
  staff_identity_id: string | null;
  operational_role_id: string | null;
  work_group_id: string | null;
  created_by_staff_identity_id: string;
  created_at: Generated<Timestamp>;
}
export interface RequestInternalNoteTable {
  id: Generated<string>;
  organization_id: string;
  service_request_id: string;
  author_staff_identity_id: string;
  author_display_name: string;
  submission_key: string;
  body: string;
  created_at: Timestamp;
}

export interface RequestCommunicationTable {
  id: Generated<string>;
  organization_id: string;
  service_request_id: string;
  author_staff_identity_id: string;
  author_display_name: string;
  submission_key: string;
  body: string;
  created_at: Timestamp;
  direction: Generated<'outbound'>;
  channel: Generated<'portal'>;
  delivery_state: Generated<'recorded'>;
}

/** ADR-025 tenant-domain registry. Every state transition is database
 * guarded and must carry matching operator audit evidence, so these shapes
 * describe what can be read rather than what a caller may freely write. */
interface TenantDomainTable {
  id: Generated<string>;
  organization_id: string;
  hostname: string;
  role: TenantDomainRole;
  verification_state: Generated<TenantDomainVerificationState>;
  active: Generated<boolean>;
  verification_method: TenantDomainVerificationMethod | null;
  verification_challenge: string | null;
  verification_requested_at: Timestamp | null;
  /** Challenge window end. The database re-anchors the request instant to its
   * own clock and bounds this against it, so it cannot be widened. */
  verification_expires_at: ColumnType<Date | null, Date | null, Date | null>;
  verification_token_id: string | null;
  verified_at: Timestamp | null;
  verification_evidence: JsonValue | null;
  revision: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
/** ADR-025 append-only evidence for every verification attempt, including
 * failures that change no registry state. These cannot live in
 * `tenant_domain_audit`, which is keyed by binding revision and must mirror
 * committed state. */
interface TenantDomainVerificationAttemptTable {
  id: Generated<string>;
  organization_id: string;
  tenant_domain_id: string;
  hostname: string;
  record_name: string;
  token_id: string;
  binding_revision: number;
  expected_challenge_hash: string;
  observed_value_hash: string | null;
  observed_value_count: number;
  result:
    | 'verified'
    | 'no_record'
    | 'value_mismatch'
    | 'challenge_expired'
    | 'disagreement'
    | 'insufficient_quorum'
    | 'unreachable'
    | 'timeout'
    | 'nxdomain'
    | 'servfail'
    | 'zone_undetermined';
  resolver_mode: 'authoritative';
  name_servers: string[];
  agreement_count: number;
  degraded_single_ns: Generated<boolean>;
  ttl_seconds: number | null;
  dnssec: JsonValue;
  actor: string;
  correlation_id: string;
  policy_version: number;
  observed_at: Generated<Timestamp>;
  mutation_txid: Generated<string>;
}
interface TenantDomainAuditTable {
  id: Generated<string>;
  organization_id: string;
  tenant_domain_id: string;
  hostname: string;
  action:
    | 'registered'
    | 'verification_requested'
    | 'verified'
    | 'verification_revoked'
    | 'activated'
    | 'deactivated'
    | 'role_changed';
  actor: string;
  prior_revision: number | null;
  revision: number;
  prior_role: TenantDomainRole | null;
  role: TenantDomainRole;
  prior_verification_state: TenantDomainVerificationState | null;
  verification_state: TenantDomainVerificationState;
  prior_active: boolean | null;
  active: boolean;
  evidence: JsonValue | null;
  /** ADR-027 F060.3C-2a. Version 1 is the retained legacy shape: a free-text
   * `actor` and nothing more. Version 2 is the only version a new row may
   * use, and it requires every structured field below. */
  attribution_version: Generated<number>;
  /** Infrastructure-issued human operator reference, `iam:`/`oidc:`/`dev:`
   * prefixed. Attribution, never platform authentication, and never a
   * `staff_identity`. */
  operator_identity: string | null;
  reason: string | null;
  correlation_id: string | null;
  outcome: 'applied' | null;
  /** Required for `activated` and `verification_revoked`, refused otherwise. */
  approval_id: string | null;
  occurred_at: Generated<Timestamp>;
  mutation_txid: Generated<string>;
}
/** ADR-027 F060.3C-2a immutable independent approval for the two operations
 * that change what the public can reach. Bound to the exact reviewed
 * pre-state, single use, and spent by the audit row that references it. */
interface TenantDomainOperatorApprovalTable {
  id: Generated<string>;
  organization_id: string;
  tenant_domain_id: string;
  operation: 'activated' | 'verification_revoked';
  expected_revision: number;
  expected_hostname: string;
  expected_role: TenantDomainRole;
  expected_verification_state: TenantDomainVerificationState;
  expected_active: boolean;
  requested_by: string;
  approved_by: string;
  reason: string;
  correlation_id: string;
  policy_version: number;
  /** Database assigned, with `expires_at` fixed at insert, so an approval
   * window cannot be backdated or widened by a caller. */
  approved_at: ColumnType<Date, Date | undefined, Date>;
  expires_at: ColumnType<Date, Date | undefined, Date>;
  creation_txid: Generated<string>;
}

/** F062.2B integration connector metadata. Every vocabulary column is typed
 * by the F062.1 union that defines it, so the check constraint and the
 * TypeScript type cannot drift apart: renaming a lifecycle state or a
 * side-effect risk in `src/integration/` is a compile error here. The
 * capability columns mirror F062.1 `ConnectorCapabilities` field for field.
 *
 * No credential is stored. `credential_reference` is a non-secret locator
 * constrained by the schema, and no column holds vendor payload or error
 * text. Nothing in this shape enables integration traffic. */
interface IntegrationConnectorTable {
  id: Generated<string>;
  organization_id: string;
  connector_key: string;
  connector_kind: IntegrationConnectorKind;
  lifecycle_state: Generated<ConnectorLifecycleState>;
  /** The semantic pin future outbox intents record. Advances only on a
   * behaviour-relevant change. */
  configuration_revision: Generated<number>;
  /** The optimistic-concurrency token. Advances on every accepted mutation,
   * including a semantically inert credential rotation. */
  record_revision: Generated<number>;
  operations: Generated<ConnectorOperation[]>;
  supports_idempotency_key: Generated<boolean>;
  supports_read_after_write: Generated<boolean>;
  supports_reconciliation: Generated<boolean>;
  supports_webhook_callback: Generated<boolean>;
  supports_ordering: Generated<OrderingGuarantee>;
  supports_update: Generated<boolean>;
  supports_cancel: Generated<boolean>;
  supports_delete: Generated<boolean>;
  supports_current_state_sync: Generated<boolean>;
  reports_terminal_state: Generated<boolean>;
  side_effect_risk: Generated<SideEffectRisk>;
  credential_reference: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  disabled_at: Timestamp | null;
  retired_at: Timestamp | null;
}

/** Provider-neutral capability profile, never a vendor product name. */
export type IntegrationConnectorKind =
  | 'loopback'
  | 'work_management'
  | 'asset_management'
  | 'service_request_exchange';

export type IntegrationConnectorChangeCategory =
  | 'registered'
  | 'lifecycle_changed'
  | 'capabilities_changed'
  | 'credential_reference_rotated';

/** F062.2B per-revision connector history. Answers what configuration and
 * capabilities were authoritative at revision N, which F062.2A requires so a
 * past ambiguous delivery is resolved against the semantics that governed it.
 *
 * `audit_sequence`, `changed_at` and `mutation_txid` are assigned by the
 * database guard, and the snapshot is verified against committed connector
 * state, so these shapes describe what can be read rather than what a caller
 * may freely write. `credential_reference_present` records presence only; the
 * locator's value is never copied into history.
 *
 * This table is NOT Reqro's authoritative authorization record for who
 * approved an administrative change; `actor` is traceability only. */
interface IntegrationConnectorAuditTable {
  id: Generated<string>;
  organization_id: string;
  integration_connector_id: string;
  record_revision: number;
  configuration_revision: number;
  prior_record_revision: number | null;
  revision_advanced: boolean;
  change_category: IntegrationConnectorChangeCategory;
  connector_key: string;
  connector_kind: IntegrationConnectorKind;
  lifecycle_state: ConnectorLifecycleState;
  operations: ConnectorOperation[];
  supports_idempotency_key: boolean;
  supports_read_after_write: boolean;
  supports_reconciliation: boolean;
  supports_webhook_callback: boolean;
  supports_ordering: OrderingGuarantee;
  supports_update: boolean;
  supports_cancel: boolean;
  supports_delete: boolean;
  supports_current_state_sync: boolean;
  reports_terminal_state: boolean;
  side_effect_risk: SideEffectRisk;
  credential_reference_present: boolean;
  prior_configuration_revision: number | null;
  prior_lifecycle_state: ConnectorLifecycleState | null;
  actor: string;
  correlation_id: string;
  changed_at: Generated<Timestamp>;
  mutation_txid: Generated<string>;
}

export interface DatabaseSchema extends ResidentExperienceTables {
  integration_connector: IntegrationConnectorTable;
  integration_connector_audit: IntegrationConnectorAuditTable;
  tenant_domain: TenantDomainTable;
  tenant_domain_audit: TenantDomainAuditTable;
  tenant_domain_operator_approval: TenantDomainOperatorApprovalTable;
  tenant_domain_verification_attempt: TenantDomainVerificationAttemptTable;
  organization_access_state: {
    organization_id: string;
    authorization_revision: Generated<string>;
    bootstrap_established: Generated<boolean>;
    mutation_txid: Generated<string | null>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
  };
  access_role_ownership: {
    organization_id: string;
    staff_identity_id: string;
    role_id: string;
    kind: 'operational' | 'administrator' | 'reader';
    creation_txid: Generated<string>;
    created_at: Generated<Timestamp>;
  };
  access_change_set: {
    id: string;
    organization_id: string;
    target_staff_id: string;
    role_id: string;
    actor_staff_id: string | null;
    source: 'runtime' | 'controlled_provisioning';
    operation:
      | 'bootstrap_access_administration'
      | 'provision_access_administrator'
      | 'provision_access_reader'
      | 'revoke_access_reader'
      | 'revoke_access_administrator'
      | 'update_managed_access';
    correlation_id: string;
    before_revision: string;
    after_revision: string;
    mutation_txid: Generated<string>;
    created_at: Generated<Timestamp>;
  };
  access_permission_delta: {
    change_set_id: string;
    permission_key: string;
    direction: 'added' | 'removed';
  };
  participation_area_audit: {
    id: Generated<string>;
    organization_id: string;
    staff_identity_id: string;
    area_id: string;
    action: 'created' | 'renamed' | 'activated' | 'deactivated' | 'reordered';
    prior_name: string | null;
    name: string;
    prior_active: boolean | null;
    active: boolean;
    prior_display_order: number | null;
    display_order: number;
    prior_revision: number | null;
    revision: number;
    correlation_id: string;
    occurred_at: Generated<Timestamp>;
  };
  organization_branding: {
    organization_id: string;
    display_name: string | null;
    tagline: string | null;
    logo_key: string | null;
    revision: Generated<number>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
  };
  participation_collection_audit: {
    id: Generated<string>;
    organization_id: string;
    staff_identity_id: string;
    action: 'service_participation_collection_changed';
    prior_enabled: boolean;
    enabled: boolean;
    prior_revision: number;
    revision: number;
    correlation_id: string;
    occurred_at: Generated<Timestamp>;
  };
  participation_area: {
    revision: Generated<number>;
    id: Generated<string>;
    organization_id: string;
    display_name: string;
    active: Generated<boolean>;
    display_order: Generated<number>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
  };
  service_participation_audit: {
    id: Generated<string>;
    organization_id: string;
    staff_identity_id: string;
    action: 'participation_read';
    start_date: string;
    end_date: string;
    threshold: number;
    correlation_id: string;
    created_at: Generated<Timestamp>;
  };
  requester: {
    id: Generated<string>;
    organization_id: string;
    identity_source: string;
    identity_subject: string;
    created_at: Generated<Timestamp>;
  };
  requester_history_audit: {
    id: Generated<string>;
    organization_id: string;
    service_request_id: string;
    staff_identity_id: string;
    action: 'history_viewed';
    correlation_id: string;
    created_at: Generated<Timestamp>;
  };
  issue_requester_identity_policy: {
    organization_id: string;
    service_definition_id: string;
    policy: 'IDENTIFIED_REQUIRED' | 'ANONYMOUS_ALLOWED';
    revision: number;
    updated_at: Timestamp;
  };
  issue_requester_identity_audit: {
    id: Generated<string>;
    organization_id: string;
    service_definition_id: string;
    staff_identity_id: string;
    revision: number;
    prior_policy: 'IDENTIFIED_REQUIRED' | 'ANONYMOUS_ALLOWED';
    policy: 'IDENTIFIED_REQUIRED' | 'ANONYMOUS_ALLOWED';
    occurred_at: Generated<Timestamp>;
  };
  issue_default_assignment: {
    organization_id: string;
    service_definition_id: string;
    target_type: 'staff' | 'role' | 'group' | null;
    staff_identity_id: string | null;
    operational_role_id: string | null;
    work_group_id: string | null;
    revision: number;
    updated_at: Timestamp;
  };
  issue_default_assignment_audit: {
    id: Generated<string>;
    organization_id: string;
    service_definition_id: string;
    staff_identity_id: string;
    revision: number;
    action: 'set' | 'clear';
    target_type: 'staff' | 'role' | 'group' | null;
    target_id: string | null;
    occurred_at: Generated<Timestamp>;
  };
  attachment_batch: {
    id: Generated<string>;
    organization_id: string;
    context: string;
    token_digest: string;
    staff_identity_id: string | null;
    service_definition_id: string | null;
    service_definition_version_id: string | null;
    service_request_id: string | null;
    note_id: string | null;
    communication_id: string | null;
    state: Generated<string>;
    submission_digest: string | null;
    created_at: Generated<Date>;
    expires_at: Timestamp;
    finalized_at: Timestamp | null;
  };
  attachment: {
    id: string;
    organization_id: string;
    batch_id: string;
    context: string;
    storage_key: string;
    filename: string;
    media_type: string;
    byte_size: number;
    source_byte_size: number;
    content_checksum: string;
    scan_state: string;
    created_at: Generated<Date>;
  };
  attachment_audit: {
    id: Generated<string>;
    organization_id: string;
    context: string;
    action: string;
    batch_id: string;
    attachment_id: string | null;
    service_request_id: string | null;
    staff_identity_id: string | null;
    created_at: Generated<Date>;
  };
  request_tracking_credential: {
    id: Generated<string>;
    organization_id: string;
    service_request_id: string;
    credential_digest: string;
    status: 'active' | 'revoked';
    created_by_staff_identity_id: string;
    created_at: Generated<Date>;
    revoked_at: Timestamp | null;
  };
  request_communication: RequestCommunicationTable;
  request_internal_note: RequestInternalNoteTable;
  operational_role: OperationalRoleTable;
  operational_role_membership: OperationalRoleMembershipTable;
  service_request_watcher: ServiceRequestWatcherTable;
  ai_usage: AiUsageTable;
  ai_audit_event: AiAuditEventTable;
  resident_alert: ResidentAlertTable;
  organization: OrganizationTable;
  department: DepartmentTable;
  division: DivisionTable;
  category: CategoryTable;
  service_definition: ServiceDefinitionTable;
  service_definition_version: ServiceDefinitionVersionTable;
  question: QuestionTable;
  question_option: QuestionOptionTable;
  service_request_reference_sequence: ReferenceSequenceTable;
  service_request_reference_config: ReferenceConfigTable;
  service_request: ServiceRequestTable;
  requester_contact: RequesterContactTable;
  location: LocationTable;
  answer: AnswerTable;
  answer_selected_option: AnswerSelectedOptionTable;
  activity: ActivityTable;
  request_operational_activity: RequestOperationalActivityTable;
  staff_identity: StaffIdentityTable;
  staff_department_membership: StaffDepartmentMembershipTable;
  staff_division_membership: StaffDivisionMembershipTable;
  work_group: WorkGroupTable;
  work_group_membership: WorkGroupMembershipTable;
  service_request_assignment: ServiceRequestAssignmentTable;
  permission: PermissionTable;
  role: RoleTable;
  role_permission: RolePermissionTable;
  staff_role_assignment: StaffRoleAssignmentTable;
}

export type Organization = Selectable<OrganizationTable>;
export type NewOrganization = Insertable<OrganizationTable>;

export type DatabaseStatus = 'up' | 'down';
