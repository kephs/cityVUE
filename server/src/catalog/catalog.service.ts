import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { CatalogRepository } from './catalog.repository.js';
import type {
  CategoryDto,
  IssueDetailDto,
  IssueSummaryDto,
  VisibilityConditionDto,
} from './catalog.dto.js';

@Injectable()
export class CatalogService {
  private readonly organizationId: string;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly repository: CatalogRepository,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
  }
  async listCategories(search?: string): Promise<CategoryDto[]> {
    const normalizedSearch = search?.trim();
    return (
      await this.repository.listActiveCategories(
        this.organizationId,
        normalizedSearch === '' ? undefined : normalizedSearch,
      )
    ).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      iconKey: row.icon_key,
    }));
  }
  async listIssues(
    categoryId: string,
    search?: string,
  ): Promise<IssueSummaryDto[]> {
    const normalizedSearch = search?.trim();
    return (
      await this.repository.listPublishedIssues(
        this.organizationId,
        categoryId,
        normalizedSearch === '' ? undefined : normalizedSearch,
      )
    ).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.resident_description,
      iconKey: row.icon_key,
    }));
  }
  async getIssue(id: string): Promise<IssueDetailDto> {
    const record = await this.repository.getPublishedIssue(
      this.organizationId,
      id,
    );
    if (!record) throw new NotFoundException('Issue not found');
    const { issue, questions, options } = record;
    return {
      id: issue.id,
      name: issue.name,
      description: issue.resident_description,
      iconKey: issue.icon_key,
      serviceDefinitionVersionId: issue.version_id,
      version: issue.version_number,
      defaultPriority: issue.default_priority,
      locationPolicy: issue.location_policy,
      geographicEligibilityMode: issue.geographic_eligibility_mode,
      anonymousReportingPolicy: issue.anonymous_reporting_policy,
      questions: questions.map((question) => ({
        id: question.id,
        key: question.question_key,
        label: question.label,
        helpText: question.help_text,
        type: question.question_type,
        required: question.is_required,
        visibilityCondition:
          question.visibility_condition as VisibilityConditionDto | null,
        options: options
          .filter((option) => option.question_id === question.id)
          .map((option) => ({
            id: option.id,
            key: option.option_key,
            label: option.label,
          })),
      })),
    };
  }
}
