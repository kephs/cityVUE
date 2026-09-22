import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import { IsDefined, IsUUID, ValidateIf } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import {
  CurrentStaff,
  RequireAnyPermission,
  RequireEntra,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { RequestTrackingService } from './request-tracking.service.js';

export class TrackingChangeDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsUUID()
  expectedVersion!: string | null;
}
export class TrackingQueryDto {}

@RequireEntra()
@RequireAnyPermission('service_request.view')
@UseGuards(StaffAccessGuard)
@Controller('staff/service-requests/:serviceRequestId/requester-tracking')
export class StaffRequestTrackingController {
  constructor(private readonly tracking: RequestTrackingService) {}
  @Get()
  state(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
    @Query() _query: TrackingQueryDto,
  ) {
    void _query;
    return this.tracking.state(id, access);
  }
  @Post('issue')
  issue(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
    @Body() body: TrackingChangeDto,
    @Query() _query: TrackingQueryDto,
    @Req() req: { id?: string },
  ) {
    return this.tracking.change(
      id,
      access,
      'issue',
      body.expectedVersion,
      req.id,
    );
  }
  @Post('rotate')
  rotate(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
    @Body() body: TrackingChangeDto,
    @Query() _query: TrackingQueryDto,
    @Req() req: { id?: string },
  ) {
    return this.tracking.change(
      id,
      access,
      'rotate',
      body.expectedVersion,
      req.id,
    );
  }
  @Post('revoke')
  revoke(
    @Param('serviceRequestId') id: string,
    @CurrentStaff() access: StaffAccess,
    @Body() body: TrackingChangeDto,
    @Query() _query: TrackingQueryDto,
    @Req() req: { id?: string },
  ) {
    return this.tracking.change(
      id,
      access,
      'revoke',
      body.expectedVersion,
      req.id,
    );
  }
}

@Controller('requester-tracking')
export class RequesterTrackingController {
  constructor(private readonly tracking: RequestTrackingService) {}
  @Get()
  track(@Headers('x-requester-tracking') credential: unknown) {
    return this.tracking.track(credential);
  }
}

/** Before guards/validation: protect successful, denied and rate-limited responses. */
@Injectable()
export class RequestTrackingPrivacyMiddleware implements NestMiddleware {
  use(_request: Request, response: Response, next: NextFunction) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  }
}
