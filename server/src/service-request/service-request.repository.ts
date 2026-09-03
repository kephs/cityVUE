import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';

export interface CatalogSubmissionDefinition {
  organizationId: string;
  businessTimezone: string;
  categoryId: string;
  serviceDefinitionId: string;
  versionId: string;
  priority: string;
  locationPolicy: string;
  anonymousPolicy: string;
  questions: {
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    order: number;
    validation: unknown;
    visibility: unknown;
    options: { key: string; label: string }[];
  }[];
}

@Injectable()
export class ServiceRequestRepository {
  async loadDetails(
    trx: Transaction<DatabaseSchema>,
    organizationId: string,
    serviceRequestId: string,
  ) {
    const request = await trx
      .selectFrom('service_request as request')
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.id', '=', 'request.service_definition_version_id')
          .onRef('version.organization_id', '=', 'request.organization_id'),
      )
      .innerJoin('category as category', (join) =>
        join
          .onRef('category.id', '=', 'request.category_id')
          .onRef('category.organization_id', '=', 'request.organization_id'),
      )
      .innerJoin('department as department', (join) =>
        join
          .onRef('department.id', '=', 'category.department_id')
          .onRef('department.organization_id', '=', 'request.organization_id'),
      )
      .leftJoin('division as division', (join) =>
        join
          .onRef('division.id', '=', 'category.division_id')
          .onRef('division.organization_id', '=', 'request.organization_id'),
      )
      .select([
        'request.id',
        'request.reference_number',
        'request.status',
        'request.priority',
        'request.description',
        'request.reporting_identity',
        'request.revision',
        'request.created_at',
        'request.updated_at',
        'request.service_definition_id',
        'request.service_definition_version_id',
        'version.name as issue_name',
        'category.id as category_id',
        'category.name as category_name',
        'department.id as department_id',
        'department.name as department_name',
        'division.id as division_id',
        'division.name as division_name',
      ])
      .where('request.organization_id', '=', organizationId)
      .where('request.id', '=', serviceRequestId)
      .executeTakeFirst();
    if (!request) return undefined;
    const [answers, contact, location, activity] = await Promise.all([
      trx
        .selectFrom('answer')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .where('service_request_id', '=', serviceRequestId)
        .orderBy('display_order')
        .orderBy('id')
        .execute(),
      trx
        .selectFrom('requester_contact')
        .select(['name', 'email'])
        .where('organization_id', '=', organizationId)
        .where('service_request_id', '=', serviceRequestId)
        .executeTakeFirst(),
      trx
        .selectFrom('location')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .where('service_request_id', '=', serviceRequestId)
        .executeTakeFirst(),
      trx
        .selectFrom('activity')
        .select([
          'activity_type',
          'actor_type',
          'metadata',
          'occurred_at',
          'id',
        ])
        .where('organization_id', '=', organizationId)
        .where('service_request_id', '=', serviceRequestId)
        .orderBy('occurred_at')
        .orderBy('id')
        .execute(),
    ]);
    return { request, answers, contact, location, activity };
  }

  async loadSubmissionDefinition(
    trx: Transaction<DatabaseSchema>,
    organizationId: string,
    serviceId: string,
    versionId: string,
  ): Promise<CatalogSubmissionDefinition | undefined> {
    const definition = await trx
      .selectFrom('organization as org')
      .innerJoin(
        'service_definition as service',
        'service.organization_id',
        'org.id',
      )
      .innerJoin('category as category', (join) =>
        join
          .onRef('category.id', '=', 'service.category_id')
          .onRef('category.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.service_definition_id', '=', 'service.id')
          .onRef('version.organization_id', '=', 'service.organization_id'),
      )
      .select([
        'org.id as organization_id',
        'org.default_business_timezone',
        'service.id as service_id',
        'service.category_id',
        'version.id as version_id',
        'version.default_priority',
        'version.location_policy',
        'version.anonymous_reporting_policy',
      ])
      .where('org.id', '=', organizationId)
      .where('org.status', '=', 'active')
      .where('service.id', '=', serviceId)
      .where('service.status', '=', 'active')
      .where('category.status', '=', 'active')
      .where('version.id', '=', versionId)
      .where('version.status', '=', 'published')
      .executeTakeFirst();
    if (!definition) return undefined;
    const questions = await trx
      .selectFrom('question')
      .select([
        'id',
        'question_key',
        'label',
        'question_type',
        'is_required',
        'display_order',
        'validation_metadata',
        'visibility_condition',
      ])
      .where('organization_id', '=', organizationId)
      .where('service_definition_version_id', '=', versionId)
      .where('status', '=', 'active')
      .orderBy('display_order')
      .execute();
    const ids = questions.map((question) => question.id);
    const options =
      ids.length === 0
        ? []
        : await trx
            .selectFrom('question_option')
            .select(['question_id', 'option_key', 'label'])
            .where('organization_id', '=', organizationId)
            .where('question_id', 'in', ids)
            .where('status', '=', 'active')
            .orderBy('display_order')
            .execute();
    return {
      organizationId: definition.organization_id,
      businessTimezone: definition.default_business_timezone,
      categoryId: definition.category_id,
      serviceDefinitionId: definition.service_id,
      versionId: definition.version_id,
      priority: definition.default_priority,
      locationPolicy: definition.location_policy,
      anonymousPolicy: definition.anonymous_reporting_policy,
      questions: questions.map((q) => ({
        id: q.id,
        key: q.question_key,
        label: q.label,
        type: q.question_type,
        required: q.is_required,
        order: q.display_order,
        validation: q.validation_metadata,
        visibility: q.visibility_condition,
        options: options
          .filter((o) => o.question_id === q.id)
          .map((o) => ({ key: o.option_key, label: o.label })),
      })),
    };
  }

  async allocateReference(
    trx: Transaction<DatabaseSchema>,
    periodKey: string,
  ): Promise<number> {
    const result = await sql<{
      last_value: number;
    }>`insert into service_request_reference_sequence(period_key,last_value) values (${periodKey},1)
      on conflict(period_key) do update set last_value=service_request_reference_sequence.last_value+1, updated_at=now()
      returning last_value`.execute(trx);
    const value = result.rows[0]?.last_value;
    if (!value || value > 999999)
      throw new Error('Monthly service request reference capacity exhausted');
    return value;
  }

  async findByReference(
    organizationId: string,
    referenceNumber: string,
    db: Transaction<DatabaseSchema>,
  ) {
    return db
      .selectFrom('service_request')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('reference_number', '=', referenceNumber)
      .executeTakeFirst();
  }
}
