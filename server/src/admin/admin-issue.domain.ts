import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import {
  requesterPolicies,
  type RequesterIdentityPolicy,
} from '../service-request/requester-identity-policy.js';
import {
  validateTarget,
  type TargetType,
} from '../service-request/ownership-targets.js';

export interface IssueFields {
  name: string;
  description: string;
  displayOrder: number;
  requesterPolicy: RequesterIdentityPolicy;
  defaultAssignment: { type: TargetType; id: string } | null;
}
export interface IssueCreate extends IssueFields {
  templateId: string;
}
export interface IssueChange extends IssueFields {
  questions?: unknown;
  expectedCoreRevision: number;
  expectedActionRevision: number;
  expectedPolicyRevision: number;
  expectedAssignmentRevision: number;
  active: boolean;
}
export function assertIssueWrite(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  assertConfigurationRead(access);
  if (!access.permissions.includes('admin.issues.write'))
    throw new ForbiddenException('Access denied');
}
export function issueText(value: unknown, name: boolean): string {
  if (typeof value !== 'string')
    throw new BadRequestException('Invalid Issue text');
  const text = value.trim();
  if (
    (name && !text) ||
    Array.from(text).length > (name ? 200 : 1000) ||
    /[<>\p{Cs}\p{Cf}]/u.test(text) ||
    Array.from(text).some(
      (c) => /\p{Cc}/u.test(c) && !['\n', '\r', '\t'].includes(c),
    ) ||
    (name && /[\r\n\t]/u.test(text))
  )
    throw new BadRequestException(
      'Use a plain-text Issue name and short description',
    );
  return text;
}
export function validateIssue(
  input: unknown,
  create: boolean,
): asserts input is IssueCreate | IssueChange {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid Issue configuration');
  const row = input as Record<string, unknown>;
  const keys = [
    'name',
    'description',
    'displayOrder',
    'requesterPolicy',
    'defaultAssignment',
    ...(create
      ? ['templateId']
      : [
          'active',
          'expectedCoreRevision',
          'expectedActionRevision',
          'expectedPolicyRevision',
          'expectedAssignmentRevision',
        ]),
  ];
  if (
    Object.keys(row).some(
      (k) => !keys.includes(k) && !(k === 'questions' && !create),
    ) ||
    keys.some((k) => !(k in row))
  )
    throw new BadRequestException('Invalid Issue fields');
  issueText(row.name, true);
  issueText(row.description, false);
  if (
    !Number.isInteger(row.displayOrder) ||
    (row.displayOrder as number) < 0 ||
    (row.displayOrder as number) > 2147483647 ||
    !requesterPolicies.includes(row.requesterPolicy as RequesterIdentityPolicy)
  )
    throw new BadRequestException('Invalid Issue configuration');
  if (row.defaultAssignment !== null) {
    const target = row.defaultAssignment;
    if (
      !target ||
      typeof target !== 'object' ||
      Object.keys(target).length !== 2 ||
      !('type' in target) ||
      !('id' in target)
    )
      throw new BadRequestException('Invalid default assignment');
    validateTarget(target.type, target.id);
  }
  if (create) {
    if (typeof row.templateId !== 'string' || !requestUuid.test(row.templateId))
      throw new BadRequestException('Choose an available intake template');
  } else {
    if (typeof row.active !== 'boolean')
      throw new BadRequestException('Invalid Issue state');
    for (const key of keys.filter((k) => k.startsWith('expected')))
      if (
        !Number.isInteger(row[key]) ||
        (row[key] as number) <
          (key === 'expectedCoreRevision' || key === 'expectedActionRevision'
            ? 1
            : 0) ||
        (row[key] as number) >= 2147483647
      )
        throw new BadRequestException('Invalid expected revision');
  }
}
