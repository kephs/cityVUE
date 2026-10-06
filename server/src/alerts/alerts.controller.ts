import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResidentTenant } from '../tenancy/resident-tenant.decorator.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import { AlertsService } from './alerts.service.js';
import { PublicAlertDto } from './alert.dto.js';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}
  @Get('active')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List currently published resident alerts' })
  @ApiOkResponse({ type: [PublicAlertDto] })
  listActive(@ResidentTenant() tenant: TenantContext) {
    return this.alerts.listActive(tenant.organizationId);
  }
}
