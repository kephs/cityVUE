import type { RequestActivityType } from '../service-request/request-activity.domain.js';
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { AlertType, AlertSeverity } from '../alerts/alert.dto.js';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type JsonValue = ColumnType<unknown, unknown, unknown>;

interface OrganizationTable {
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
interface ServiceDefinitionTable {
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
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
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
interface StaffRoleAssignmentTable {
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

export interface DatabaseSchema {
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
