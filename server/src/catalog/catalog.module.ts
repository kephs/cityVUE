import { StaffCatalogController } from './staff-catalog.controller.js';
import { IssueActionController } from './issue-action.controller.js';
import { IssueActionService } from './issue-action.service.js';
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [
    CatalogController,
    IssueActionController,
    StaffCatalogController,
  ],
  providers: [CatalogRepository, CatalogService, IssueActionService],
  exports: [CatalogService],
})
export class CatalogModule {}
