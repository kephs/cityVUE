import { BadRequestException } from '@nestjs/common';
import type { WorkflowAction } from './service-request.domain.js';

export const workflowActivityTypes = {
  start_work: 'work_started',
  hold: 'placed_on_hold',
  resume: 'work_resumed',
  close: 'request_closed',
  reopen: 'request_reopened',
} as const satisfies Record<WorkflowAction, string>;

export type RequestActivityType =
  | 'request_created'
  | 'request_routed'
  | (typeof workflowActivityTypes)[WorkflowAction];

/** Operational text never belongs in security audit, URLs, or error messages. */
export function normalizeOperationalNarrative(
  action: WorkflowAction,
  reason?: string,
  resolution?: string,
): string | null {
  const normalize = (value: string | undefined, maximum: number) => {
    if (value === undefined) return null;
    if (
      typeof value !== 'string' ||
      value.length > maximum ||
      Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return (
          (code < 32 && code !== 10 && code !== 13) ||
          (code >= 127 && code <= 159) ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
        );
      })
    )
      throw new BadRequestException('Invalid operational narrative');
    return value.replace(/\r\n?/g, '\n').trim();
  };
  const cleanReason = normalize(reason, 500);
  const cleanResolution = normalize(resolution, 2000);
  const narrative =
    action === 'close'
      ? cleanResolution
      : action === 'hold' || action === 'reopen'
        ? cleanReason
        : null;
  if (['hold', 'close', 'reopen'].includes(action) && !narrative)
    throw new BadRequestException('Operational narrative is required');
  return narrative;
}
