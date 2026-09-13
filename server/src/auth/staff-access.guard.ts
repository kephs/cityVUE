import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import { ENTRA_ONLY_KEY, PERMISSION_KEY } from './auth.decorators.js';
import { EntraTokenService } from './entra-token.service.js';
import { StaffAuthorizationService } from './staff-authorization.service.js';
import type { Permission, StaffAccess } from './auth.types.js';

@Injectable()
export class StaffAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: EntraTokenService,
    private readonly authorization: StaffAuthorizationService,
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      staffAccess?: StaffAccess;
    }>();
    const permission = this.reflector.getAllAndOverride<Permission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const principal = await this.tokens.validate(authorization.slice(7));
      if (!this.tokens.hasRequiredScope(principal))
        throw new ForbiddenException('Required API scope is missing');
      const access = await this.authorization.resolve(principal);
      this.authorization.assertPermission(access, permission);
      request.staffAccess = access;
      return true;
    }
    if (
      this.tokens.enabled ||
      this.reflector.getAllAndOverride<boolean>(ENTRA_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new UnauthorizedException();
    }
    const read = permission === 'service_request.view';
    const enabled = this.config.get(
      read
        ? 'serviceRequestReads.developmentEnabled'
        : 'staffActions.developmentEnabled',
      { infer: true },
    );
    if (!enabled) throw new NotFoundException();
    const organizationId = this.config.get(
      'catalog.developmentOrganizationId',
      { infer: true },
    );
    const staffIdentityId = this.config.get('staffActions.developmentActorId', {
      infer: true,
    });
    const staff = await this.database.client
      .selectFrom('staff_identity')
      .select('display_name')
      .where('organization_id', '=', organizationId)
      .where('id', '=', staffIdentityId)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!staff) throw new NotFoundException();
    request.staffAccess = {
      tenantId: null,
      objectId: null,
      staffIdentityId,
      organizationId,
      displayName: staff.display_name,
      scopes: [],
      permissions: [permission],
      departmentIds: [],
      divisionIds: [],
      development: true,
    };
    return true;
  }
}
