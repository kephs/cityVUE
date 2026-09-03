import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  ListServiceRequestsQueryDto,
  ServiceRequestListResponseDto,
} from './service-request.dto.js';
import { ServiceRequestRepository } from './service-request.repository.js';

@Injectable()
export class ListServiceRequestsService {
  private readonly organizationId: string;
  private readonly enabled: boolean;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
    private readonly repository: ServiceRequestRepository,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
    this.enabled = config.get('serviceRequestReads.developmentEnabled', {
      infer: true,
    });
  }
  async execute(
    query: ListServiceRequestsQueryDto,
  ): Promise<ServiceRequestListResponseDto> {
    if (!this.enabled) throw new NotFoundException();
    const normalizedSearch = query.search?.trim();
    const options = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.division ? { division: query.division } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(normalizedSearch ? { search: normalizedSearch } : {}),
      sort: query.sort ?? 'newest',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
    };
    const result = await this.repository.listForOrganization(
      this.database.client,
      this.organizationId,
      options,
    );
    return {
      items: result.rows.map((row) => ({
        serviceRequestId: row.id,
        referenceNumber: row.reference_number,
        issueName: row.issue_name,
        categoryId: row.category_id,
        categoryName: row.category_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        divisionId: row.division_id,
        divisionName: row.division_name,
        status: row.status,
        priority: row.priority,
        createdAt: row.created_at as unknown as Date | string,
        updatedAt: row.updated_at as unknown as Date | string,
        revision: row.revision,
      })),
      total: result.total,
      page: options.page,
      pageSize: options.pageSize,
      hasPreviousPage: options.page > 1,
      hasNextPage: options.page * options.pageSize < result.total,
    };
  }
}
