import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ResidentTenant } from '../tenancy/resident-tenant.decorator.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import { CatalogService } from './catalog.service.js';
import { CategoryDto, IssueDetailDto, IssueSummaryDto } from './catalog.dto.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('categories')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List active resident catalog categories' })
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({ type: [CategoryDto] })
  listCategories(
    @ResidentTenant() tenant: TenantContext,
    @Query('search') search?: string,
  ) {
    return this.catalog.listCategories(tenant.organizationId, search);
  }

  @Get('categories/:categoryId/issues')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List published issues in an active category' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({ type: [IssueSummaryDto] })
  listIssues(
    @ResidentTenant() tenant: TenantContext,
    @Param('categoryId', new ParseUUIDPipe({ version: '4' }))
    categoryId: string,
    @Query('search') search?: string,
  ) {
    return this.catalog.listIssues(tenant.organizationId, categoryId, search);
  }

  @Get('issues/:serviceDefinitionId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Load a published issue and its resident form' })
  @ApiParam({ name: 'serviceDefinitionId', format: 'uuid' })
  @ApiOkResponse({ type: IssueDetailDto })
  getIssue(
    @ResidentTenant() tenant: TenantContext,
    @Param('serviceDefinitionId', new ParseUUIDPipe({ version: '4' }))
    id: string,
  ) {
    return this.catalog.getIssueForOrganization(tenant.organizationId, id);
  }
}
