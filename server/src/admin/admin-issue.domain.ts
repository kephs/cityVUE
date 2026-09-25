import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import {
  issueAvailabilities,
  type IssueAvailability,
} from '../catalog/issue-availability.js';
import {
  normalizeAction,
  type ActionInput,
} from '../catalog/issue-action.command.js';
import { validateHandling } from '../catalog/issue-availability.js';
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
  availability: IssueAvailability;
  categoryId: string;
  templateId?: string;
  expectedSourceVersion?: string;
  defaultPriority: string;
  locationPolicy: string;
  geographicEligibilityMode: string;
  handling: Omit<ActionInput, 'expectedRevision'>;
  questions: unknown[];
}
export interface IssueChange extends IssueFields {
  handling?: Omit<ActionInput, 'expectedRevision'>;
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
      ? [
          'categoryId',
          'availability',
          'defaultPriority',
          'locationPolicy',
          'geographicEligibilityMode',
          'handling',
          'questions',
        ]
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
      (k) =>
        !keys.includes(k) &&
        !(
          create
            ? ['templateId', 'expectedSourceVersion']
            : ['questions', 'handling']
        ).includes(k),
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
    if (!(issueAvailabilities as readonly unknown[]).includes(row.availability))
      throw new BadRequestException('Choose where this Issue can be used.');
    if (typeof row.categoryId !== 'string' || !requestUuid.test(row.categoryId))
      throw new BadRequestException('Choose an available Category');
    if (row.templateId !== undefined) {
      if (
        typeof row.templateId !== 'string' ||
        !requestUuid.test(row.templateId) ||
        typeof row.expectedSourceVersion !== 'string' ||
        !requestUuid.test(row.expectedSourceVersion)
      )
        throw new BadRequestException('Review an available source Issue');
    } else if (row.expectedSourceVersion !== undefined) {
      throw new BadRequestException('Source version requires a source Issue');
    }
    if (
      !['low', 'medium', 'high', 'urgent'].includes(
        row.defaultPriority as string,
      ) ||
      !['required', 'optional', 'not_applicable'].includes(
        row.locationPolicy as string,
      )
    )
      throw new BadRequestException(
        'Choose Default Priority and Service Location',
      );
    // No authoritative restricted-policy registry exists in this environment.
    if (row.geographicEligibilityMode !== 'no_geographic_restriction')
      throw new BadRequestException(
        'Choose a supported Geographic Eligibility policy',
      );
    if (
      !row.handling ||
      typeof row.handling !== 'object' ||
      Array.isArray(row.handling) ||
      Object.keys(row.handling).some(
        (k) => !['actionType', 'destination', 'message', 'label'].includes(k),
      )
    )
      throw new BadRequestException('Invalid Issue handling fields');
    const handling = row.handling as Omit<ActionInput, 'expectedRevision'>;
    if (
      handling.actionType === 'external_redirect' &&
      (typeof handling.message !== 'string' ||
        typeof handling.label !== 'string')
    )
      throw new BadRequestException(
        'Complete the External Handoff configuration',
      );
    const action = normalizeAction({ ...handling, expectedRevision: 1 });
    validateHandling(row.availability as string, action.action_type);
    if (!Array.isArray(row.questions))
      throw new BadRequestException('Invalid Issue questions');
  } else {
    if (
      row.handling !== undefined &&
      (!row.handling ||
        typeof row.handling !== 'object' ||
        Array.isArray(row.handling) ||
        Object.keys(row.handling).some(
          (k) => !['actionType', 'destination', 'message', 'label'].includes(k),
        ))
    )
      throw new BadRequestException('Invalid Issue handling fields');
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
