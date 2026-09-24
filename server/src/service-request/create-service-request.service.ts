import {
  validateParticipation,
  validateParticipationArea,
} from './participation.domain.js';
import {
  assertTrustedRequester,
  resolveTrustedRequester,
  type TrustedRequesterContext,
} from './trusted-requester.js';
import {
  resolveIssueDefault,
  applyInitialAssignment,
} from './issue-default-assignment.js';
import {
  inspectRequesterPolicy,
  validateIdentityContact,
} from './requester-identity-policy.js';
import { Optional } from '@nestjs/common';
import { AttachmentService } from '../attachments/attachment.service.js';
import { checksum } from '../attachments/attachment.domain.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { validServicePoint } from '../location-eligibility/service-location.domain.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  CreateServiceRequestDto,
  CreateStaffServiceRequestDto,
  CreateServiceRequestResponseDto,
} from './service-request.dto.js';
import {
  conditionMatches,
  normalizeAnswer,
  validateLocationPolicy,
  validateRequesterPolicy,
  type CanonicalAnswerValue,
  type SupportedQuestionType,
} from './service-request.domain.js';
import { ServiceRequestRepository } from './service-request.repository.js';
import { EvaluateLocationEligibilityService } from '../location-eligibility/evaluate-location-eligibility.service.js';

interface Condition {
  questionKey: string;
  operator: 'equals';
  value: unknown;
}
interface Validation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}
const supportedQuestionTypes = new Set<SupportedQuestionType>([
  'short_text',
  'long_text',
  'number',
  'yes_no',
  'single_select',
]);

@Injectable()
export class CreateServiceRequestService {
  private readonly organizationId: string;
  private readonly trustedDevelopment: boolean;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
    private readonly repository: ServiceRequestRepository,
    private readonly eligibility: EvaluateLocationEligibilityService,
    @Optional() private readonly attachments?: AttachmentService,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
    this.trustedDevelopment =
      ['development', 'test'].includes(
        config.get('app.environment', { infer: true }),
      ) && config.get('deployment.profile', { infer: true }) === 'development';
  }

  /** No HTTP route calls this. Only a verified provider context may select identity. */
  async executeTrusted(
    input: CreateServiceRequestDto,
    trusted: TrustedRequesterContext,
    now = new Date(),
  ): Promise<CreateServiceRequestResponseDto> {
    assertTrustedRequester(trusted);
    if (!this.trustedDevelopment || input.reportingIdentity !== 'identified')
      throw new ForbiddenException('Trusted requester creation unavailable');
    return this.create(
      input,
      {
        organizationId: trusted.organizationId,
        audience: 'public',
        intakeChannel: 'api',
        staffId: null,
        trusted,
      },
      now,
    );
  }

  async execute(
    input: CreateServiceRequestDto,
    now = new Date(),
  ): Promise<CreateServiceRequestResponseDto> {
    return this.create(
      input,
      {
        organizationId: this.organizationId,
        audience: 'public',
        intakeChannel: 'web',
        staffId: null,
      },
      now,
    );
  }

  async executeStaff(
    input: CreateStaffServiceRequestDto,
    access: StaffAccess | undefined,
    now = new Date(),
  ): Promise<CreateServiceRequestResponseDto> {
    if (input.attachments)
      throw new BadRequestException(
        'Evidence is available only during PUBLIC requester intake',
      );
    if (
      !access ||
      access.development ||
      !access.tenantId ||
      !access.objectId ||
      !access.permissions.includes('service_request.create') ||
      (input.audience === 'internal' &&
        !access.permissions.includes('service_request.create_internal'))
    )
      throw new ForbiddenException('Access denied');
    if (
      !['public', 'internal'].includes(input.audience) ||
      !['web', 'phone', 'walk_in', 'staff', 'api'].includes(input.intakeChannel)
    )
      throw new BadRequestException('Invalid intake classification');
    if (
      input.audience === 'internal' &&
      (input.reportingIdentity !== 'identified' || input.contact)
    )
      throw new BadRequestException(
        'Internal intake requires the authenticated staff requester without resident contact',
      );
    return this.create(
      input,
      {
        organizationId: access.organizationId,
        audience: input.audience,
        intakeChannel: input.intakeChannel,
        staffId: access.staffIdentityId,
      },
      now,
    );
  }

  private async create(
    input: CreateServiceRequestDto,
    context: {
      organizationId: string;
      audience: 'public' | 'internal';
      intakeChannel: string;
      staffId: string | null;
      trusted?: TrustedRequesterContext;
    },
    now: Date,
  ): Promise<CreateServiceRequestResponseDto> {
    const attachments = this.attachments;
    validateParticipation(input.participation, context.audience);
    if (input.attachments && !attachments)
      throw new BadRequestException('Attachments unavailable');
    const definition = await this.repository.loadSubmissionDefinition(
      this.database.client,
      context.organizationId,
      input.serviceDefinitionId,
      input.serviceDefinitionVersionId,
    );
    if (!definition)
      throw new NotFoundException(
        'Published service definition version not found',
      );
    if (input.description.trim() === '')
      throw new BadRequestException('Description is required');
    validateIdentityContact(
      input.reportingIdentity,
      input.contact,
      context.audience === 'internal',
    );
    validateRequesterPolicy(
      input.reportingIdentity,
      'allowed',
      context.audience === 'internal' || Boolean(input.contact?.name.trim()),
    );
    validateLocationPolicy(
      definition.locationPolicy,
      Boolean(input.location?.enteredAddress.trim()),
    );
    if (input.location?.enteredAddress.trim() === '')
      throw new BadRequestException('Location address must not be blank');
    if (
      input.location &&
      (input.location.latitude !== undefined ||
        input.location.longitude !== undefined) &&
      !validServicePoint(input.location.latitude, input.location.longitude)
    )
      throw new BadRequestException(
        'Provide valid latitude and longitude together',
      );

    const supplied = new Map<string, unknown>();
    for (const answer of input.answers) {
      if (supplied.has(answer.questionId))
        throw new BadRequestException('A question may be answered only once');
      supplied.set(answer.questionId, answer.value);
    }
    const knownIds = new Set(
      definition.questions.map((question) => question.id),
    );
    if ([...supplied.keys()].some((id) => !knownIds.has(id)))
      throw new BadRequestException(
        'Answer does not belong to the submitted service version',
      );
    const normalizedByKey = new Map<string, CanonicalAnswerValue>();
    const normalizedById = new Map<string, CanonicalAnswerValue>();
    for (const question of definition.questions) {
      if (!supportedQuestionTypes.has(question.type as SupportedQuestionType))
        throw new BadRequestException(
          'The published form contains an unsupported question type',
        );
      const raw = supplied.get(question.id);
      if (raw !== undefined) {
        const value = normalizeAnswer(
          question.type as SupportedQuestionType,
          raw,
        );
        normalizedById.set(question.id, value);
        normalizedByKey.set(question.key, value);
      }
    }
    const persistedAnswers: {
      id: string;
      key: string;
      label: string;
      type: SupportedQuestionType;
      order: number;
      value: CanonicalAnswerValue;
      optionLabel: string | null;
    }[] = [];
    for (const question of definition.questions) {
      const condition = question.visibility as Condition | null;
      const visible =
        !condition ||
        conditionMatches(
          normalizedByKey.get(condition.questionKey),
          condition.value,
        );
      const value = normalizedById.get(question.id);
      if (!visible && value !== undefined)
        throw new BadRequestException('Hidden questions must not be submitted');
      if (visible && question.required && value === undefined)
        throw new BadRequestException('A required question is missing');
      if (!visible || value === undefined) continue;
      const validation = question.validation as Validation | null;
      if (
        typeof value === 'number' &&
        ((validation?.min !== undefined && value < validation.min) ||
          (validation?.max !== undefined && value > validation.max))
      )
        throw new BadRequestException(
          'Numeric answer is outside allowed bounds',
        );
      if (
        typeof value === 'string' &&
        question.type !== 'single_select' &&
        ((validation?.minLength !== undefined &&
          value.length < validation.minLength) ||
          (validation?.maxLength !== undefined &&
            value.length > validation.maxLength))
      )
        throw new BadRequestException('Text answer is outside allowed length');
      const option =
        question.type === 'single_select'
          ? question.options.find((candidate) => candidate.key === value)
          : undefined;
      if (question.type === 'single_select' && !option)
        throw new BadRequestException('Selected option is invalid');
      persistedAnswers.push({
        id: question.id,
        key: question.key,
        label: question.label,
        type: question.type as SupportedQuestionType,
        order: question.order,
        value,
        optionLabel: option?.label ?? null,
      });
    }

    const eligibilityResult = input.location
      ? await this.eligibility.execute({
          organizationId: context.organizationId,
          policyType: definition.geographicEligibilityMode,
          policyReference: definition.geographicEligibilityPolicyReference,
          unableToDetermineBehavior: definition.unableToDetermineBehavior,
          enteredAddress: input.location.enteredAddress.trim(),
          locationType: input.location.locationType ?? 'entered_address',
          latitude: input.location.latitude,
          longitude: input.location.longitude,
        })
      : null;
    return this.database.client.transaction().execute(async (trx) => {
      const attachmentDigest = checksum(
        JSON.stringify({
          serviceDefinitionId: input.serviceDefinitionId,
          serviceDefinitionVersionId: input.serviceDefinitionVersionId,
          description: input.description,
          reportingIdentity: input.reportingIdentity,
          answers: input.answers,
          contact: input.contact,
          location: input.location,
          ...(input.participation
            ? { participation: input.participation }
            : {}),
          ...(context.trusted
            ? {
                trustedRequester: {
                  source: context.trusted.source,
                  subject: context.trusted.subject,
                },
              }
            : {}),
        }),
      );
      const batch =
        input.attachments && attachments
          ? await attachments.prepare(
              trx,
              input.attachments,
              {
                organizationId: context.organizationId,
                context: 'REQUEST_EVIDENCE',
                issueId: input.serviceDefinitionId,
                versionId: input.serviceDefinitionVersionId,
              },
              attachmentDigest,
            )
          : undefined;
      if (batch?.state === 'FINALIZED') {
        if (!batch.service_request_id) throw new NotFoundException();
        const prior = await trx
          .selectFrom('service_request')
          .select(['id', 'reference_number', 'created_at'])
          .where('organization_id', '=', context.organizationId)
          .where('id', '=', batch.service_request_id)
          .executeTakeFirstOrThrow();
        return {
          id: prior.id,
          referenceNumber: prior.reference_number,
          // A retry returns the original creation receipt, never current workflow state.
          status: 'open',
          createdAt: new Date(prior.created_at as unknown as string),
        };
      }
      // Serialize action changes against final submission, including stale published versions.
      const action = await trx
        .selectFrom('service_definition')
        .select(['action_type', 'status'])
        .where('organization_id', '=', context.organizationId)
        .where('id', '=', definition.serviceDefinitionId)
        .forShare()
        .executeTakeFirst();
      if (action?.status !== 'active')
        throw new ConflictException(
          'This Issue is no longer available for new requests',
        );
      if (action.action_type !== 'internal_intake')
        throw new ConflictException(
          'This Issue is handled by an external service',
        );
      const identityPolicy = await inspectRequesterPolicy(
        trx,
        context.organizationId,
        definition.serviceDefinitionId,
      );
      if (context.audience === 'public')
        validateRequesterPolicy(
          input.reportingIdentity,
          identityPolicy.policy === 'IDENTIFIED_REQUIRED'
            ? 'not_allowed'
            : 'allowed',
          Boolean(input.contact?.name.trim()),
        );
      await validateParticipationArea(
        trx,
        context.organizationId,
        input.participation,
      );
      const initialAssignment = await resolveIssueDefault(
        trx,
        context.organizationId,
        definition.serviceDefinitionId,
        definition.categoryId,
        context.audience,
      );
      const referenceNumber = await this.repository.allocateReference(
        trx,
        context.organizationId,
        now,
        definition.businessTimezone,
      );
      const requestId = randomUUID();
      const requesterId = context.trusted
        ? await resolveTrustedRequester(trx, context.trusted)
        : null;
      const created = await trx
        .insertInto('service_request')
        .values({
          id: requestId,
          ...(input.participation
            ? {
                requester_geography_state: input.participation.state,
                participation_area_id: input.participation.areaId ?? null,
              }
            : {}),
          ...(requesterId ? { requester_id: requesterId } : {}),
          organization_id: context.organizationId,
          reference_number: referenceNumber,
          service_definition_id: definition.serviceDefinitionId,
          service_definition_version_id: definition.versionId,
          category_id: definition.categoryId,
          status: 'open',
          priority: definition.priority,
          description: input.description.trim(),
          reporting_identity: input.reportingIdentity,
          audience: context.audience,
          intake_channel: context.intakeChannel,
          submitted_by_staff_identity_id: context.staffId,
          requester_staff_identity_id:
            context.audience === 'internal' ? context.staffId : null,
        })
        .returning(['id', 'reference_number', 'status', 'created_at'])
        .executeTakeFirstOrThrow();
      if (batch && attachments)
        await attachments.finalize(
          trx,
          batch,
          requestId,
          requestId,
          attachmentDigest,
        );
      if (input.reportingIdentity === 'identified' && input.contact) {
        const email = input.contact.email?.trim();
        await trx
          .insertInto('requester_contact')
          .values({
            id: randomUUID(),
            organization_id: context.organizationId,
            service_request_id: requestId,
            name: input.contact.name.trim(),
            email: email === '' ? null : (email ?? null),
          })
          .execute();
      }
      if (definition.locationPolicy !== 'not_applicable' && input.location)
        await trx
          .insertInto('location')
          .values({
            id: randomUUID(),
            organization_id: context.organizationId,
            service_request_id: requestId,
            entered_address: input.location.enteredAddress.trim(),
            normalized_address: null,
            latitude: input.location.latitude ?? null,
            longitude: input.location.longitude ?? null,
            location_type: input.location.locationType ?? 'entered_address',
            facility_reference: null,
            park_reference: null,
            parcel_reference: null,
            gis_asset_reference: null,
            eligibility_policy_type: eligibilityResult?.policyType ?? null,
            eligibility_policy_reference:
              definition.geographicEligibilityPolicyReference,
            eligibility_provider_key: eligibilityResult?.providerKey ?? null,
            eligibility_provider_reference:
              eligibilityResult?.providerReference ?? null,
            eligibility_reason_code: eligibilityResult?.reasonCode ?? null,
            eligibility_result: eligibilityResult?.result ?? null,
            validated_at: eligibilityResult?.validatedAt ?? null,
          })
          .execute();
      if (persistedAnswers.length)
        await trx
          .insertInto('answer')
          .values(
            persistedAnswers.map((answer) => ({
              id: randomUUID(),
              organization_id: context.organizationId,
              service_request_id: requestId,
              question_id: answer.id,
              question_key: answer.key,
              question_label: answer.label,
              question_type: answer.type,
              display_order: answer.order,
              text_value:
                answer.type === 'short_text' || answer.type === 'long_text'
                  ? String(answer.value)
                  : null,
              number_value:
                answer.type === 'number' ? String(answer.value) : null,
              boolean_value:
                answer.type === 'yes_no' ? Boolean(answer.value) : null,
              option_key:
                answer.type === 'single_select' ? String(answer.value) : null,
              display_value:
                answer.type === 'single_select' ? answer.optionLabel : null,
            })),
          )
          .execute();
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: context.organizationId,
          service_request_id: requestId,
          activity_type: 'service_request_created',
          staff_identity_id: context.staffId,
          actor_type: context.staffId
            ? 'staff'
            : input.reportingIdentity === 'anonymous'
              ? 'anonymous_resident'
              : 'identified_resident',
          actor_reference: null,
          metadata: {
            referenceNumber,
            audience: context.audience,
            intakeChannel: context.intakeChannel,
            ...(initialAssignment.outcome !== 'none'
              ? {
                  defaultAssignment: {
                    source: 'issue_default',
                    outcome: initialAssignment.outcome,
                  },
                }
              : {}),
            ...(eligibilityResult
              ? {
                  locationEligibility: {
                    result: eligibilityResult.result,
                    policyType: eligibilityResult.policyType,
                    reasonCode: eligibilityResult.reasonCode,
                  },
                }
              : {}),
          },
        })
        .execute();
      await trx
        .insertInto('request_operational_activity')
        .values({
          organization_id: context.organizationId,
          service_request_id: requestId,
          activity_type: 'request_created',
          actor_type: context.staffId
            ? 'staff'
            : input.reportingIdentity === 'anonymous'
              ? 'anonymous_resident'
              : 'resident',
          staff_identity_id: context.staffId,
          occurred_at: new Date(created.created_at as unknown as string),
          request_revision: 1,
          intake_channel: context.intakeChannel,
        })
        .execute();
      if (initialAssignment.target)
        await applyInitialAssignment(
          trx,
          context.organizationId,
          requestId,
          initialAssignment.target,
        );
      return {
        id: created.id,
        referenceNumber: created.reference_number,
        status: created.status,
        createdAt: new Date(created.created_at as unknown as string),
      };
    });
  }
}
