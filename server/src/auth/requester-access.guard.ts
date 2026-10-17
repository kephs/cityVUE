import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUESTER_IDENTITY_KEY } from './auth.decorators.js';
import { EntraTokenService } from './entra-token.service.js';
import { StaffAuthorizationService } from './staff-authorization.service.js';
import type { RequesterAccess } from './auth.types.js';

/**
 * F064.1: admission for an authenticated requester asking about their own
 * requests.
 *
 * Separate from StaffAccessGuard on purpose. That guard has no permissionless
 * mode -- every one of its admission paths requires a staff permission, and
 * the only permission that would admit an internal request
 * (`service_request.internal.read`) grants every internal request in the
 * caller's departments. A requester must get neither.
 *
 * This guard therefore establishes identity only. It never decides that the
 * caller may see a particular request: the service layer must still prove
 * ownership in SQL. Being authenticated is not authorization.
 *
 * It also deliberately has no development fallback. StaffAccessGuard keeps one
 * for local staff work; reproducing it here would make an unauthenticated local
 * request indistinguishable from a signed-in employee on a requester route.
 */
@Injectable()
export class RequesterAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: EntraTokenService,
    private readonly authorization: StaffAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      requesterAccess?: RequesterAccess | undefined;
      staffAccess?: unknown;
    }>();
    // Refuse a route that did not explicitly opt in, so this guard cannot be
    // attached to a staff route and quietly admit a caller without its
    // permission check.
    if (
      !this.reflector.getAllAndOverride<boolean>(REQUESTER_IDENTITY_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      throw new ForbiddenException('Access denied');
    // Anything a caller supplied under these names is discarded before the
    // trusted context is written, so a forged field cannot survive into the
    // handler even if some upstream layer were to populate one.
    request.requesterAccess = undefined;
    request.staffAccess = undefined;
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException();
    const principal = await this.tokens.validate(authorization.slice(7));
    if (!this.tokens.hasRequiredScope(principal))
      throw new ForbiddenException('Required API scope is missing');
    request.requesterAccess =
      await this.authorization.resolveRequesterIdentity(principal);
    return true;
  }
}
