import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import { parseResidentPublicationInput } from './resident-experience.publication.input.js';
import { ResidentPublicationService } from './resident-experience.publication.service.js';

function noSelectors(query: Record<string, unknown>) {
  if (Object.keys(query).length)
    throw new BadRequestException(
      'Resident publication does not accept selectors',
    );
}

class ResidentPublicationNoStoreGuard implements CanActivate {
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
@UseGuards(ResidentPublicationNoStoreGuard, StaffAccessGuard)
@Controller('admin/resident-experience')
export class AdminResidentPublicationController {
  constructor(private readonly publication: ResidentPublicationService) {}

  @Post('publications')
  @Header('Cache-Control', 'no-store')
  publish(
    @CurrentStaff() access: StaffAccess,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
  ) {
    noSelectors(query);
    const input = parseResidentPublicationInput(body);
    return this.publication.publish({
      publisher: access,
      reviewRequestId: input.reviewRequestId,
      expectedResourceRevision: input.expectedResourceRevision,
      correlationId: typeof request.id === 'string' ? request.id : randomUUID(),
    });
  }
}
