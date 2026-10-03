import type { ColumnType, Generated } from 'kysely';
import type { ResidentPresentation } from './resident-experience.domain.js';
type Time = Generated<ColumnType<Date, Date | string | undefined, never>>;
interface Child {
  organization_id: string;
  revision_id: string;
  logical_id: string;
}
export interface ResidentExperienceTables {
  organization_resident_experience: {
    organization_id: string;
    revision: Generated<number>;
    draft_revision_id: string | null;
    published_revision_id: string | null;
    created_at: Time;
    updated_at: Time;
  };
  resident_experience_revision: {
    id: string;
    organization_id: string;
    resource_revision: number;
    schema_version: 1;
    presentation: ColumnType<ResidentPresentation, string, never>;
    state: Generated<'saved'>;
    created_by: string;
    created_at: Time;
    creation_txid: Generated<string>;
  };
  resident_experience_action: Child & {
    enabled: boolean;
    display_order: number;
    icon_key: string;
    title: string;
    description: string;
    cta_label: string;
    action_type: 'internal' | 'external' | 'phone';
    target: string | null;
    contact_id: string | null;
    tone: 'primary' | 'danger' | 'warning';
  };
  resident_experience_benefit: Child & {
    enabled: boolean;
    display_order: number;
    icon_key: string;
    title: string;
    description: string;
  };
  resident_experience_contact: Child & {
    kind: 'phone';
    classification: 'emergency' | 'non_emergency';
    display_value: string;
    phone_target: string;
    guidance: string;
  };
  resident_experience_event: {
    id: string;
    organization_id: string;
    actor_id: string;
    operation: 'draft_saved' | 'approved' | 'published';
    prior_revision_id: string | null;
    new_revision_id: string;
    prior_resource_revision: number;
    resource_revision: number;
    changed_fields: string[];
    consequential: boolean;
    reasons: string[];
    correlation_id: string;
    occurred_at: Time;
  };
}
