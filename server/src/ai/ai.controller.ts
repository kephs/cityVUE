import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { AiPolicyService } from './ai-policy.service.js';
import { AiModelDto, AiStatusDto } from './ai.dto.js';

@ApiTags('Staff AI')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'City Entra authentication required' })
@ApiForbiddenResponse({ description: 'AI workspace permission required' })
@RequireEntra()
@RequirePermission('ai.workspace.access')
@UseGuards(StaffAccessGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly policy: AiPolicyService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AiStatusDto })
  status(@CurrentStaff() staff: StaffAccess): AiStatusDto {
    return this.policy.status(staff);
  }

  @Get('models')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AiModelDto, isArray: true })
  @ApiServiceUnavailableResponse({ description: 'AI workspace disabled' })
  models(@CurrentStaff() staff: StaffAccess): AiModelDto[] {
    return this.policy.models(staff);
  }
}
