import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthService, type LivenessResponse } from './health.service.js';

@ApiTags('Platform health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Confirm that the API process is running' })
  @ApiOkResponse({ description: 'The API process is running.' })
  live(): LivenessResponse {
    return this.health.live();
  }

  @Get(['', 'ready'])
  @ApiOperation({ summary: 'Confirm that the API and PostgreSQL are ready' })
  @ApiOkResponse({ description: 'The API and PostgreSQL are ready.' })
  @ApiServiceUnavailableResponse({ description: 'PostgreSQL is unavailable.' })
  async ready(): Promise<
    NonNullable<Awaited<ReturnType<HealthService['ready']>>>
  > {
    const readiness = await this.health.ready();
    if (!readiness) {
      throw new ServiceUnavailableException('Required dependency unavailable');
    }
    return readiness;
  }
}
