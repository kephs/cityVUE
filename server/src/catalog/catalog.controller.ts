import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import { CategoryDto, IssueDetailDto, IssueSummaryDto } from './catalog.dto.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('categories')
  @ApiOperation({ summary: 'List active resident catalog categories' })
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({ type: [CategoryDto] })
  listCategories(@Query('search') search?: string) {
    return this.catalog.listCategories(search);
  }

  @Get('categories/:categoryId/issues')
  @ApiOperation({ summary: 'List published issues in an active category' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({ type: [IssueSummaryDto] })
  listIssues(
    @Param('categoryId', new ParseUUIDPipe({ version: '4' }))
    categoryId: string,
    @Query('search') search?: string,
  ) {
    return this.catalog.listIssues(categoryId, search);
  }

  @Get('issues/:serviceDefinitionId')
  @ApiOperation({ summary: 'Load a published issue and its resident form' })
  @ApiParam({ name: 'serviceDefinitionId', format: 'uuid' })
  @ApiOkResponse({ type: IssueDetailDto })
  getIssue(
    @Param('serviceDefinitionId', new ParseUUIDPipe({ version: '4' }))
    id: string,
  ) {
    return this.catalog.getIssue(id);
  }
}
