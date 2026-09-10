import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  listActive() {
    return this.alerts.listActive();
  }
}
