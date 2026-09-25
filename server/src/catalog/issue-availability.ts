import { BadRequestException } from '@nestjs/common';

export const issueAvailabilities = [
  'INTERNAL_ONLY',
  'EXTERNAL_ONLY',
  'INTERNAL_AND_EXTERNAL',
] as const;
export type IssueAvailability = (typeof issueAvailabilities)[number];
export type IntakeContext = 'internal' | 'external';
export function allowsIntake(
  availability: string,
  context: IntakeContext,
): boolean {
  return (
    availability === 'INTERNAL_AND_EXTERNAL' ||
    availability ===
      (context === 'internal' ? 'INTERNAL_ONLY' : 'EXTERNAL_ONLY')
  );
}
export function validateHandling(availability: string, action: string): void {
  if (
    !(issueAvailabilities as readonly string[]).includes(availability) ||
    !['internal_intake', 'external_redirect'].includes(action) ||
    (action === 'external_redirect' && availability !== 'EXTERNAL_ONLY')
  )
    throw new BadRequestException(
      'This handling is not available for this Issue.',
    );
}
