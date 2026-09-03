import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

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
interface ReferenceSequenceTable {
  period_key: string;
  last_value: number;
  updated_at: Generated<Timestamp>;
}
interface ServiceRequestTable {
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
  latitude: number | null;
  longitude: number | null;
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
  assigned_by_staff_identity_id: string;
  reason: string | null;
  created_at: Generated<Timestamp>;
}

export interface DatabaseSchema {
  organization: OrganizationTable;
  department: DepartmentTable;
  division: DivisionTable;
  category: CategoryTable;
  service_definition: ServiceDefinitionTable;
  service_definition_version: ServiceDefinitionVersionTable;
  question: QuestionTable;
  question_option: QuestionOptionTable;
  service_request_reference_sequence: ReferenceSequenceTable;
  service_request: ServiceRequestTable;
  requester_contact: RequesterContactTable;
  location: LocationTable;
  answer: AnswerTable;
  activity: ActivityTable;
  staff_identity: StaffIdentityTable;
  staff_department_membership: StaffDepartmentMembershipTable;
  staff_division_membership: StaffDivisionMembershipTable;
  work_group: WorkGroupTable;
  work_group_membership: WorkGroupMembershipTable;
  service_request_assignment: ServiceRequestAssignmentTable;
}

export type Organization = Selectable<OrganizationTable>;
export type NewOrganization = Insertable<OrganizationTable>;

export type DatabaseStatus = 'up' | 'down';
