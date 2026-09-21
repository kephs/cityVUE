import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission, StaffAccess } from './auth.types.js';

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
