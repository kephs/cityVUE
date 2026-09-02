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

export interface DatabaseSchema {
  organization: OrganizationTable;
  department: DepartmentTable;
  division: DivisionTable;
  category: CategoryTable;
  service_definition: ServiceDefinitionTable;
  service_definition_version: ServiceDefinitionVersionTable;
  question: QuestionTable;
  question_option: QuestionOptionTable;
}

export type Organization = Selectable<OrganizationTable>;
export type NewOrganization = Insertable<OrganizationTable>;

export type DatabaseStatus = 'up' | 'down';
