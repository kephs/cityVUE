import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  CreateServiceRequestDto,
  CreateServiceRequestResponseDto,
} from './service-request.dto.js';
import {
  conditionMatches,
  formatReferenceNumber,
  normalizeAnswer,
  periodKeyFor,
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
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
    private readonly repository: ServiceRequestRepository,
    private readonly eligibility: EvaluateLocationEligibilityService,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
  }

  async execute(
    input: CreateServiceRequestDto,
    now = new Date(),
  ): Promise<CreateServiceRequestResponseDto> {
    const definition = await this.repository.loadSubmissionDefinition(
      this.database.client,
      this.organizationId,
      input.serviceDefinitionId,
      input.serviceDefinitionVersionId,
    );
    if (!definition)
      throw new NotFoundException(
        'Published service definition version not found',
      );
    if (input.description.trim() === '')
      throw new BadRequestException('Description is required');
    validateRequesterPolicy(
      input.reportingIdentity,
      definition.anonymousPolicy,
      Boolean(input.contact?.name.trim()),
    );
    validateLocationPolicy(
      definition.locationPolicy,
      Boolean(input.location?.enteredAddress.trim()),
    );
    if (input.location?.enteredAddress.trim() === '')
      throw new BadRequestException('Location address must not be blank');

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
          organizationId: this.organizationId,
          policyType: definition.geographicEligibilityMode,
          policyReference: definition.geographicEligibilityPolicyReference,
          unableToDetermineBehavior: definition.unableToDetermineBehavior,
          enteredAddress: input.location.enteredAddress.trim(),
          locationType: input.location.locationType ?? 'entered_address',
        })
      : null;
    return this.database.client.transaction().execute(async (trx) => {
      const period = periodKeyFor(now, definition.businessTimezone);
      const sequence = await this.repository.allocateReference(trx, period);
      const referenceNumber = formatReferenceNumber(period, sequence);
      const requestId = randomUUID();
      const created = await trx
        .insertInto('service_request')
        .values({
          id: requestId,
          organization_id: this.organizationId,
          reference_number: referenceNumber,
          service_definition_id: definition.serviceDefinitionId,
          service_definition_version_id: definition.versionId,
          category_id: definition.categoryId,
          status: 'open',
          priority: definition.priority,
          description: input.description.trim(),
          reporting_identity: input.reportingIdentity,
        })
        .returning(['id', 'reference_number', 'status', 'created_at'])
        .executeTakeFirstOrThrow();
      if (input.reportingIdentity === 'identified' && input.contact) {
        const email = input.contact.email?.trim();
        await trx
          .insertInto('requester_contact')
          .values({
            id: randomUUID(),
            organization_id: this.organizationId,
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
            organization_id: this.organizationId,
            service_request_id: requestId,
            entered_address: input.location.enteredAddress.trim(),
            normalized_address: null,
            latitude: null,
            longitude: null,
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
              organization_id: this.organizationId,
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
          organization_id: this.organizationId,
          service_request_id: requestId,
          activity_type: 'service_request_created',
          actor_type:
            input.reportingIdentity === 'anonymous'
              ? 'anonymous_resident'
              : 'identified_resident',
          actor_reference: null,
          metadata: {
            referenceNumber,
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
      return {
        id: created.id,
        referenceNumber: created.reference_number,
        status: created.status,
        createdAt: new Date(created.created_at as unknown as string),
      };
    });
  }
}
