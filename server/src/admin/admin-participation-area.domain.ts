import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';

export function assertAreaWrite(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  assertConfigurationRead(access);
  if (!access.permissions.includes('admin.participation_areas.write'))
    throw new ForbiddenException('Access denied');
}

export function areaName(value: unknown): string {
  if (typeof value !== 'string')
    throw new BadRequestException('Enter a Participation Area name.');
  const name = value.trim();
  if (
    !name ||
    Array.from(name).length > 120 ||
    /[\p{Cc}\p{Cs}\p{Cf}]/u.test(name)
  )
    throw new BadRequestException(
      'Enter a plain-text Participation Area name of 1 to 120 characters.',
    );
  return name;
}

export interface AreaChange {
  expectedRevision: number;
  displayName?: string;
  active?: boolean;
  displayOrder?: number;
}
export function validateAreaChange(
  input: AreaChange | undefined,
): asserts input is AreaChange {
  const fields = ['displayName', 'active', 'displayOrder'];
  if (
    !input ||
    Object.keys(input).some(
      (k) => !['expectedRevision', ...fields].includes(k),
    ) ||
    fields.filter((k) => input[k as keyof AreaChange] !== undefined).length !==
      1 ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    input.expectedRevision > 2147483647 ||
    (input.active !== undefined && typeof input.active !== 'boolean') ||
    (input.displayOrder !== undefined &&
      (!Number.isInteger(input.displayOrder) ||
        input.displayOrder < -2147483648 ||
        input.displayOrder > 2147483647))
  )
    throw new BadRequestException('Invalid Participation Area change.');
  if (input.displayName !== undefined) areaName(input.displayName);
}
