import { HttpException } from '@nestjs/common';

export const accessErrorMessages = {
  ACCESS_COMMAND_INVALID: 'Invalid access change.',
  ACCESS_SELF_EDIT_FORBIDDEN: 'You cannot configure your own access.',
  ACCESS_STATE_STALE: 'Access changed; refresh and review before saving.',
  ACCESS_TARGET_UNAVAILABLE: 'This staff member is unavailable.',
  ACCESS_TARGET_INACTIVE:
    'This staff member is no longer active. Changes were not saved.',
  ACCESS_PERMISSION_NOT_MANAGEABLE:
    'Select only currently manageable permissions.',
  ACCESS_DEPENDENCY_INVALID:
    'Required access is missing. Review the permission requirements.',
  ACCESS_REDUNDANT_ASSIGNMENT:
    'This access is already assigned outside Access & Permissions.',
  ACCESS_ADMINISTRATOR_CHANGE_REQUIRES_PROVISIONING:
    'Access Administrator authority must remain unchanged. Use controlled provisioning.',
  ACCESS_CONFIGURATION_INTEGRITY:
    'Access configuration needs administrative attention before changes can be saved.',
} as const;
export type AccessErrorCode = keyof typeof accessErrorMessages;
export function accessError(
  code: AccessErrorCode,
  status = 400,
  violations?: { key: string; required: string }[],
) {
  return new HttpException(
    {
      code,
      ...(violations ? { violations } : {}),
      error:
        status === 409
          ? 'Conflict'
          : status === 403
            ? 'Forbidden'
            : status === 404
              ? 'Not Found'
              : 'Bad Request',
    },
    status,
  );
}
