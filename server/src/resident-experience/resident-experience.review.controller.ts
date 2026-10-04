import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { AdminResidentReviewService } from './resident-experience.review.service.js';

function noSelectors(query: Record<string, unknown>, request?: Request) {
  if (
    Object.keys(query).length ||
    (request &&
      (request.body !== undefined ||
        Number(request.headers['content-length'] ?? 0) > 0 ||
        request.headers['transfer-encoding'] !== undefined))
  )
    throw new BadRequestException('Resident review does not accept selectors');
}

/** Run before authentication so denials and stale/malformed responses are also private. */
class ResidentReviewNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return true;
  }
}

@RequireEntra()
@RequirePermission('admin.configuration.read')
@UseGuards(ResidentReviewNoStoreGuard, StaffAccessGuard)
@Controller('admin/resident-experience')
export class AdminResidentReviewController {
  constructor(private readonly reviews: AdminResidentReviewService) {}

  @Get('review-context')
  @Header('Cache-Control', 'no-store')
  context(
    @CurrentStaff() access: StaffAccess,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query, request);
    return this.reviews.context(access);
  }
  @Get('revisions/:revisionId')
  @Header('Cache-Control', 'no-store')
  revision(
    @CurrentStaff() access: StaffAccess,
    @Param('revisionId') id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query, request);
    return this.reviews.revision(access, id);
  }
  @Get('review-requests/:requestId')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentStaff() access: StaffAccess,
    @Param('requestId') id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query, request);
    return this.reviews.get(access, id);
  }
  @Post('review-requests')
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentStaff() access: StaffAccess,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
  ) {
    noSelectors(query);
    return this.reviews.create(access, body);
  }
  @Post('review-requests/:requestId/decision')
  @Header('Cache-Control', 'no-store')
  decide(
    @CurrentStaff() access: StaffAccess,
    @Param('requestId') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
  ) {
    noSelectors(query);
    return this.reviews.decide(access, id, body);
  }
}
