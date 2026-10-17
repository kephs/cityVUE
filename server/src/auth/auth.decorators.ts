import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission, RequesterAccess, StaffAccess } from './auth.types.js';

export const PERMISSION_KEY = 'cityvue.permission';
export const ANY_PERMISSION_KEY = 'cityvue.anyPermission';
export const ENTRA_ONLY_KEY = 'cityvue.entraOnly';
export const RequireEntra = () => SetMetadata(ENTRA_ONLY_KEY, true);
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
/** Entra-only admission; resource services must still authorize each returned audience. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffAccess =>
    context.switchToHttp().getRequest<{ staffAccess: StaffAccess }>()
      .staffAccess,
);

export const REQUESTER_IDENTITY_KEY = 'cityvue.requesterIdentity';
/**
 * F064.1: opt a route into requester admission. RequesterAccessGuard refuses
 * any route that has not set this, so the guard can never be attached to a
 * staff route by accident and silently admit a requester to it.
 */
export const RequireRequesterIdentity = () =>
  SetMetadata(REQUESTER_IDENTITY_KEY, true);
export const CurrentRequester = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequesterAccess =>
    context.switchToHttp().getRequest<{ requesterAccess: RequesterAccess }>()
      .requesterAccess,
);
