import { BadRequestException } from '@nestjs/common';

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function approvedDestination(value: string): string {
  if (
    value.length > 2048 ||
    /[\s\\]/u.test(value) ||
    hasControlCharacter(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) ||
    !value.startsWith('https://') ||
    value[8] === '/' ||
    value.slice(8).split(/[/?#]/)[0]?.includes('@')
  )
    throw new BadRequestException(
      'A valid HTTPS destination without credentials is required',
    );
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error('Invalid destination');
    return url.href;
  } catch {
    throw new BadRequestException(
      'A valid HTTPS destination without credentials is required',
    );
  }
}

export function issueActionProjection(row: {
  action_type: string;
  redirect_url: string | null;
  redirect_message: string | null;
  redirect_label: string | null;
}) {
  if (row.action_type === 'internal_intake')
    return { actionType: 'internal_intake' as const };
  if (
    row.action_type !== 'external_redirect' ||
    !row.redirect_url ||
    !row.redirect_message ||
    !row.redirect_label
  )
    throw new BadRequestException('Issue action is unavailable');
  return {
    actionType: 'external_redirect' as const,
    redirect: {
      destination: approvedDestination(row.redirect_url),
      message: row.redirect_message,
      label: row.redirect_label,
    },
  };
}
