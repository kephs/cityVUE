import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Header,
  Headers,
  Injectable,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, IsUUID, Length } from 'class-validator';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import {
  CurrentStaff,
  RequireAnyPermission,
  RequireEntra,
} from '../auth/auth.decorators.js';
import { StaffAccessGuard } from '../auth/staff-access.guard.js';
import type { StaffAccess } from '../auth/auth.types.js';
import type { AppConfiguration } from '../config/configuration.js';
import { AttachmentService } from './attachment.service.js';
import {
  attachmentLimits,
  type AttachmentContext,
} from './attachment.domain.js';

export class AttachmentClaimDto {
  @IsUUID('4') batchId!: string;
  @IsString() @Length(43, 43) token!: string;
}
class IntakeAttachmentDto {
  @IsUUID('4') issueId!: string;
  @IsUUID('4') versionId!: string;
}
class StaffAttachmentDto {
  @IsIn(['INTERNAL_NOTE', 'REQUESTER_COMMUNICATION'])
  context!: AttachmentContext;
}
@Injectable()
export class AttachmentOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (
      origin &&
      !this.config
        .get('app.corsOrigins', { infer: true })
        .split(',')
        .map((x) => x.trim())
        .includes(origin)
    )
      throw new ForbiddenException();
    return true;
  }
}
@Injectable()
export class AttachmentUploadGuard implements CanActivate {
  constructor(private readonly attachments: AttachmentService) {}
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { staffAccess?: StaffAccess }>();
    const res = context.switchToHttp().getResponse<Response>();
    const release = this.attachments.acquire();
    res.once('finish', release);
    res.once('close', release);
    try {
      await this.attachments.admit(
        {
          batchId: String(req.params.batchId),
          token: String(req.headers['x-reqro-attachment'] ?? ''),
        },
        req.staffAccess,
      );
    } catch (error) {
      release();
      throw error;
    }
    return true;
  }
}
const upload = FileInterceptor('file', {
  limits: {
    fileSize: attachmentLimits.fileBytes,
    files: 1,
    fields: 0,
    parts: 2,
    fieldNameSize: 40,
    headerPairs: 20,
  },
});
interface Upload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Controller('intake/attachments')
@UseGuards(AttachmentOriginGuard)
export class IntakeAttachmentController {
  constructor(private readonly attachments: AttachmentService) {}
  @Get('policy') @Header('Cache-Control', 'no-store') policy() {
    return this.attachments.policy();
  }
  @Post('batches')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  start(@Body() body: IntakeAttachmentDto) {
    return this.attachments.startPublic(body.issueId, body.versionId);
  }
  @Post('batches/:batchId/files/:fileId')
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(upload)
  upload(
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
    @Headers('x-reqro-attachment') token: string,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.attachments.upload({ batchId, token }, fileId, file);
  }
  @Get('batches/:batchId/files/:fileId')
  async preview(
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
    @Headers('x-reqro-attachment') token: string,
  ) {
    const result = await this.attachments.preview({ batchId, token }, fileId);
    return new StreamableFile(result.bytes, {
      type: result.metadata.mediaType,
      length: result.metadata.byteSize,
      disposition: 'attachment',
    });
  }
  @Delete('batches/:batchId/files/:fileId')
  remove(
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
    @Headers('x-reqro-attachment') token: string,
  ) {
    return this.attachments.remove({ batchId, token }, fileId);
  }
  @Delete('batches/:batchId')
  abandon(
    @Param('batchId') batchId: string,
    @Headers('x-reqro-attachment') token: string,
  ) {
    return this.attachments.remove({ batchId, token }, undefined);
  }
}

@Controller('staff/attachments')
@RequireEntra()
@RequireAnyPermission('service_request.view', 'service_request.internal.read')
@UseGuards(StaffAccessGuard, AttachmentOriginGuard)
export class StaffAttachmentController {
  constructor(private readonly attachments: AttachmentService) {}
  @Post('requests/:requestId/batches')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  start(
    @Param('requestId') requestId: string,
    @Body() body: StaffAttachmentDto,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.attachments.startStaff(requestId, body.context, access);
  }
  @Post('batches/:batchId/files/:fileId')
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(upload)
  upload(
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
    @Headers('x-reqro-attachment') token: string,
    @UploadedFile() file: Upload | undefined,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.attachments.upload({ batchId, token }, fileId, file, access);
  }
  @Get('batches/:batchId/files/:fileId')
  async preview(
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
    @Headers('x-reqro-attachment') token: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    const result = await this.attachments.preview(
      { batchId, token },
      fileId,
      access,
    );
    return new StreamableFile(result.bytes, {
      type: result.metadata.mediaType,
      length: result.metadata.byteSize,
      disposition: 'attachment',
    });
  }
  @Delete('batches/:batchId/files/:fileId')
  remove(
    @Param('batchId') batchId: string,
    @Param('fileId') fileId: string,
    @Headers('x-reqro-attachment') token: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.attachments.remove({ batchId, token }, fileId, access);
  }
  @Delete('batches/:batchId')
  abandon(
    @Param('batchId') batchId: string,
    @Headers('x-reqro-attachment') token: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.attachments.remove({ batchId, token }, undefined, access);
  }
  @Get('requests/:requestId/evidence')
  evidence(
    @Param('requestId') requestId: string,
    @CurrentStaff() access: StaffAccess,
  ) {
    return this.attachments.evidence(requestId, access);
  }
  @Get('requests/:requestId/:context/:parentId/files/:fileId')
  async download(
    @Param('requestId') requestId: string,
    @Param('context') context: AttachmentContext,
    @Param('parentId') parentId: string,
    @Param('fileId') fileId: string,
    @CurrentStaff() access: StaffAccess,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.attachments.download(
      requestId,
      context,
      parentId,
      fileId,
      access,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox",
    );
    return new StreamableFile(result.bytes, {
      type: result.metadata.mediaType,
      length: result.metadata.byteSize,
      disposition: `attachment; filename="${result.metadata.filename}"`,
    });
  }
}

@Injectable()
export class AttachmentPrivacyMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  }
}
