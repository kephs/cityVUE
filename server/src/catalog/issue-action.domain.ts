import { BadRequestException } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';

// Node's parsed-address matcher also handles IPv4-mapped IPv6; no DNS or network I/O.
const localAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  localAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  localAddresses.addSubnet(address, prefix, 'ipv6');

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
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const family = isIP(host);
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      (family && localAddresses.check(host, family === 4 ? 'ipv4' : 'ipv6')) ||
      url.href.length > 2048
    )
      throw new Error('Invalid destination');
    return url.href;
  } catch {
    throw new BadRequestException(
      'A valid HTTPS destination without credentials is required',
    );
  }
}

export function handoffText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).length > maximum ||
    /[\p{Cs}\p{Cf}]/u.test(value) ||
    Array.from(value).some(
      (c) => /\p{Cc}/u.test(c) && !['\n', '\r', '\t'].includes(c),
    )
  )
    throw new BadRequestException(
      'Enter a valid handoff message and button label.',
    );
  return value.trim();
}
export function issueActionProjection(row: {
  action_type: string;
  redirect_url: string | null;
  redirect_message: string | null;
  redirect_label: string | null;
}) {
  if (
    row.action_type === 'internal_intake' &&
    row.redirect_url === null &&
    row.redirect_message === null &&
    row.redirect_label === null
  )
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
      message: handoffText(row.redirect_message, 500),
      label: handoffText(row.redirect_label, 80),
    },
  };
}
