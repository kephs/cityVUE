import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class CatalogRepository {
  constructor(private readonly database: DatabaseService) {}

  async listActiveCategories(organizationId: string, search?: string) {
    let query = this.database.client
      .selectFrom('category')
      .innerJoin('department', (join) =>
        join
          .onRef('department.id', '=', 'category.department_id')
          .onRef('department.organization_id', '=', 'category.organization_id'),
      )
      .leftJoin('division', (join) =>
        join
          .onRef('division.id', '=', 'category.division_id')
          .onRef('division.organization_id', '=', 'category.organization_id'),
      )
      .select([
        'category.id',
        'category.name',
        'category.description',
        'category.icon_key',
        'department.id as department_id',
        'department.name as department_name',
        'division.id as division_id',
        'division.name as division_name',
      ])
      .where('category.organization_id', '=', organizationId)
      .where('category.status', '=', 'active');
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      query = query.where((eb) =>
        eb.or([
          eb('category.name', 'ilike', pattern),
          eb('category.description', 'ilike', pattern),
          sql<boolean>`exists (select 1 from unnest(category.aliases || category.keywords) term where term ilike ${pattern})`,
        ]),
      );
    }
    return query
      .orderBy('category.display_order')
      .orderBy('category.name')
      .execute();
  }

  async listPublishedIssues(
    organizationId: string,
    categoryId: string,
    search?: string,
  ) {
    let query = this.database.client
      .selectFrom('service_definition as service')
      .innerJoin('category as category', (join) =>
        join
          .onRef('category.id', '=', 'service.category_id')
          .onRef('category.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.id', '=', 'service.current_published_version_id')
          .onRef('version.organization_id', '=', 'service.organization_id'),
      )
      .select([
        'service.id',
        'version.name',
        'version.resident_description',
        'version.icon_key',
      ])
      .where('service.organization_id', '=', organizationId)
      .where('service.category_id', '=', categoryId)
      .where('service.status', '=', 'active')
      .where('category.status', '=', 'active')
      .where('version.status', '=', 'published');
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      query = query.where((eb) =>
        eb.or([
          eb('version.name', 'ilike', pattern),
          eb('version.resident_description', 'ilike', pattern),
          sql<boolean>`exists (select 1 from unnest(version.aliases || version.keywords) term where term ilike ${pattern})`,
        ]),
      );
    }
    return query.orderBy('version.name').execute();
  }

  async getPublishedIssue(organizationId: string, serviceDefinitionId: string) {
    const issue = await this.database.client
      .selectFrom('service_definition as service')
      .innerJoin('category as category', (join) =>
        join
          .onRef('category.id', '=', 'service.category_id')
          .onRef('category.organization_id', '=', 'service.organization_id'),
      )
      .innerJoin('service_definition_version as version', (join) =>
        join
          .onRef('version.id', '=', 'service.current_published_version_id')
          .onRef('version.organization_id', '=', 'service.organization_id'),
      )
      .select([
        'service.id',
        'version.id as version_id',
        'version.version_number',
        'version.name',
        'version.resident_description',
        'version.icon_key',
        'version.default_priority',
        'version.location_policy',
        'version.geographic_eligibility_mode',
        'version.anonymous_reporting_policy',
      ])
      .where('service.organization_id', '=', organizationId)
      .where('service.id', '=', serviceDefinitionId)
      .where('service.status', '=', 'active')
      .where('category.status', '=', 'active')
      .where('version.status', '=', 'published')
      .executeTakeFirst();
    if (!issue) return undefined;
    const questions = await this.database.client
      .selectFrom('question')
      .select([
        'id',
        'question_key',
        'label',
        'help_text',
        'question_type',
        'is_required',
        'visibility_condition',
      ])
      .where('organization_id', '=', organizationId)
      .where('service_definition_version_id', '=', issue.version_id)
      .where('status', '=', 'active')
      .orderBy('display_order')
      .execute();
    const questionIds = questions.map(({ id }) => id);
    const options =
      questionIds.length === 0
        ? []
        : await this.database.client
            .selectFrom('question_option')
            .select(['id', 'question_id', 'option_key', 'label'])
            .where('organization_id', '=', organizationId)
            .where('question_id', 'in', questionIds)
            .where('status', '=', 'active')
            .orderBy('display_order')
            .execute();
    return { issue, questions, options };
  }
}
