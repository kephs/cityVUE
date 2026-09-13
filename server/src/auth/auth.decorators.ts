import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission, StaffAccess } from './auth.types.js';

export const PERMISSION_KEY = 'cityvue.permission';
export const ENTRA_ONLY_KEY = 'cityvue.entraOnly';
export const RequireEntra = () => SetMetadata(ENTRA_ONLY_KEY, true);
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffAccess =>
    context.switchToHttp().getRequest<{ staffAccess: StaffAccess }>()
      .staffAccess,
);
