import {
  authorizeRequestTransaction,
  lockRequestOrganization,
} from './request-authorization.js';
import {
  validateParticipation,
  validateParticipationArea,
} from './participation.domain.js';
import { allowsIntake } from '../catalog/issue-availability.js';
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
import {
  AttachmentService,
  residentAuthority,
} from '../attachments/attachment.service.js';
import { checksum } from '../attachments/attachment.domain.js';
import {
  replayTrackingState,
  submissionFingerprint,
  submissionKeyDigest,
  submissionScope,
  SUBMISSION_IN_PROGRESS,
  SUBMISSION_KEY_REUSED,
  SUBMISSION_RETRY_WINDOW_CLOSED,
} from './submission-idempotency.js';
import { reserveSubmission } from './submission-reservation.js';
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
  AnswerInputDto,
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
import { issueIntakeTrackingCredential } from './requester-intake-issuance.js';
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
  'multi_select',
  'date',
  'information',
]);

@Injectable()
export class CreateServiceRequestService {
  private readonly trustedDevelopment: boolean;
  /**
   * F065. OFF unless the environment says exactly 'true', so a missing or
   * unrecognized value never activates it. There is no client override and no
   * tenant bypass, and applying the migration does not switch it on. While
   * disabled, a PUBLIC submission returns exactly the receipt it returned
   * before this feature existed.
   */
  private readonly intakeTrackingEnabled: boolean;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
    private readonly repository: ServiceRequestRepository,
    private readonly eligibility: EvaluateLocationEligibilityService,
    @Optional() private readonly attachments?: AttachmentService,
  ) {
    this.trustedDevelopment =
      ['development', 'test'].includes(
        config.get('app.environment', { infer: true }),
      ) && config.get('deployment.profile', { infer: true }) === 'development';
    // Validated configuration supplies a real boolean: `configuration()`
    // derives it from an exact 'true', so a missing or malformed environment
    // value arrives here as false.
    this.intakeTrackingEnabled = config.get(
      'requesterTracking.intakeIssuanceEnabled',
      { infer: true },
    );
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

  /** ADR-025. The anonymous intake write path. Organization comes from the
   * resolved resident TenantContext and is never taken from the request body,
   * so a forged Organization field cannot redirect a created request. */
  async execute(
    organizationId: string,
    input: CreateServiceRequestDto,
    now = new Date(),
    submissionKey?: string,
  ): Promise<CreateServiceRequestResponseDto> {
    return this.create(
      input,
      {
        organizationId,
        audience: 'public',
        intakeChannel: 'web',
        staffId: null,
        // F065: the only path approved for automatic tracking issuance. Staff
        // intake and the trusted provider path deliberately do not set this.
        requesterIntake: true,
        // F066. The resident controller rejects a missing or malformed key
        // before this point, so every submission arriving over HTTP carries
        // one. The parameter is optional only so the staff and trusted paths,
        // whose published contracts are unchanged, can share this method's
        // sibling entry points.
        ...(submissionKey === undefined ? {} : { submissionKey }),
      },
      now,
    );
  }

  async executeStaff(
    input: CreateStaffServiceRequestDto,
    access: StaffAccess | undefined,
    now = new Date(),
    submissionKey?: string,
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
        actor: access,
        // F066. Opt-in for staff intake, so the existing staff contract keeps
        // working unchanged while a staff client that supplies a key gets the
        // same at-most-once guarantee. The key is scoped to the acting staff
        // identity, so one staff member's key can neither collide with nor
        // replay another's.
        ...(submissionKey === undefined ? {} : { submissionKey }),
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
      requesterIntake?: boolean;
      trusted?: TrustedRequesterContext;
      actor?: StaffAccess;
      submissionKey?: string;
    },
    now: Date,
  ): Promise<CreateServiceRequestResponseDto> {
    const attachments = this.attachments;
    validateParticipation(input.participation, context.audience);
    if (input.attachments && !attachments)
      throw new BadRequestException('Attachments unavailable');
    const prepared =
      input.attachments && attachments
        ? await attachments.prepareFiles(
            input.attachments,
            residentAuthority(context.organizationId),
          )
        : undefined;
    const preparedDefinition = prepared?.finalized
      ? undefined
      : await this.repository.loadSubmissionDefinition(
          this.database.client,
          context.organizationId,
          input.serviceDefinitionId,
          input.serviceDefinitionVersionId,
        );
    const initialAction = prepared?.finalized
      ? undefined
      : await this.database.client
          .selectFrom('service_definition')
          .select([
            'status',
            'availability',
            'action_type',
            'current_published_version_id',
          ])
          .where('organization_id', '=', context.organizationId)
          .where('id', '=', input.serviceDefinitionId)
          .executeTakeFirst();
    const preparedEligibility =
      input.location &&
      preparedDefinition &&
      initialAction?.status === 'active' &&
      initialAction.action_type === 'internal_intake' &&
      initialAction.current_published_version_id ===
        input.serviceDefinitionVersionId &&
      allowsIntake(
        initialAction.availability,
        context.audience === 'internal' ? 'internal' : 'external',
      )
        ? await this.eligibility.execute({
            organizationId: context.organizationId,
            policyType: preparedDefinition.geographicEligibilityMode,
            policyReference:
              preparedDefinition.geographicEligibilityPolicyReference,
            unableToDetermineBehavior:
              preparedDefinition.unableToDetermineBehavior,
            enteredAddress: input.location.enteredAddress.trim(),
            locationType: input.location.locationType ?? 'entered_address',
            latitude: input.location.latitude,
            longitude: input.location.longitude,
          })
        : null;

    return this.database.client.transaction().execute(async (trx) => {
      if (context.actor)
        await authorizeRequestTransaction(
          trx,
          context.actor,
          context.audience === 'internal'
            ? ['service_request.create', 'service_request.create_internal']
            : ['service_request.create'],
        );
      else await lockRequestOrganization(trx, context.organizationId);
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
      const prepareBatch = async () =>
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
              residentAuthority(context.organizationId),
              prepared,
            )
          : undefined;
      let batch = prepared?.finalized ? await prepareBatch() : undefined;
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
      // F066. The reservation is taken here: after the attachment-batch replay
      // check above, which can return an already-created request, and before
      // any expensive validation. For an attachment-free submission `prepared`
      // is undefined, so that check is skipped entirely and this becomes the
      // first thing the transaction does after authorization -- a concurrent
      // retry therefore blocks on the unique constraint before performing
      // work, rather than after.
      //
      // The request identity is generated now so the reservation can name the
      // request it is about to create. The foreign key is deferred, so that
      // reference is still verified before commit and a committed reservation
      // always resolves to a request that exists.
      const requestId = randomUUID();
      // Decided here rather than after issuance, because every input to the
      // decision is already fixed: the feature flag, the audience and the
      // intake path. If issuance later fails, the whole transaction rolls
      // back, so a committed row can never disagree with what was issued.
      const willIssueTracking =
        this.intakeTrackingEnabled &&
        context.audience === 'public' &&
        context.requesterIntake === true;
      const reservation =
        context.submissionKey === undefined
          ? undefined
          : await reserveSubmission(trx, {
              organizationId: context.organizationId,
              scope: submissionScope(context),
              keyDigest: submissionKeyDigest(context.submissionKey),
              fingerprint: submissionFingerprint(
                attachmentDigest,
                input.attachments,
              ),
              requestId,
              trackingIssued: willIssueTracking,
            });
      if (reservation !== undefined && reservation.kind !== 'first') {
        if (reservation.kind === 'mismatch')
          throw new ConflictException({
            code: SUBMISSION_KEY_REUSED,
            message:
              'This submission was already sent with different details. Start a new submission.',
          });
        if (reservation.kind === 'expired')
          throw new ConflictException({
            code: SUBMISSION_RETRY_WINDOW_CLOSED,
            message:
              'The retry window for this submission has closed. Start a new submission.',
          });
        if (reservation.kind === 'in_progress')
          throw new ConflictException({
            code: SUBMISSION_IN_PROGRESS,
            message:
              'An earlier copy of this submission is still being processed. Wait a moment and try again.',
          });
        // An exact replay. The original request is read back rather than
        // reconstructed, and the function returns before every creation side
        // effect: no second request, no second F065 credential, no second
        // tracking-issuance audit event, no second attachment association.
        const replayed = await trx
          .selectFrom('service_request')
          .select(['id', 'reference_number', 'created_at'])
          .where('organization_id', '=', context.organizationId)
          .where('id', '=', reservation.serviceRequestId)
          .executeTakeFirstOrThrow();
        return {
          id: replayed.id,
          referenceNumber: replayed.reference_number,
          // The original creation receipt, never current workflow state.
          status: 'open',
          createdAt: new Date(replayed.created_at as unknown as string),
          replay: {
            // The raw credential was returned exactly once and only its digest
            // was stored, so no replay can return it. Saying that plainly is
            // the honest answer; presenting replay as tracking-link recovery
            // would not be.
            tracking: replayTrackingState(reservation.trackingIssued),
          },
        };
      }
      // Serialize action changes against final submission, including stale published versions.
      const action = await trx
        .selectFrom('service_definition')
        .select([
          'category_id',
          'action_type',
          'availability',
          'status',
          'current_published_version_id',
        ])
        .where('organization_id', '=', context.organizationId)
        .where('id', '=', input.serviceDefinitionId)
        .forShare()
        .executeTakeFirst();
      if (!action) throw new NotFoundException();
      // F060.3C-2d: the existence-only Category lock that stood here was
      // removed. Its selected identifier was discarded, so it asserted only
      // that the Category still existed -- and referential integrity already
      // guarantees that, through a chain rather than a direct reference:
      // service_request's foreign key is
      // (organization_id, category_id, service_definition_id) ->
      // service_definition(organization_id, category_id, id), and
      // service_definition in turn references category(organization_id, id).
      // The insert therefore takes an implicit FOR KEY SHARE on the
      // service_definition row, and the Category behind it cannot be deleted
      // while any service_definition references it. The explicit lock added
      // no invariant while forcing the runtime to hold UPDATE privilege on a
      // reference table.
      if (action.status !== 'active')
        throw new ConflictException(
          'This Issue is no longer available for new requests',
        );
      if (
        action.action_type !== 'internal_intake' ||
        !allowsIntake(
          action.availability,
          context.audience === 'internal' ? 'internal' : 'external',
        )
      )
        throw new ConflictException(
          'This Issue is unavailable for this intake context',
        );
      if (
        action.current_published_version_id !== input.serviceDefinitionVersionId
      )
        throw new ConflictException(
          'The Issue form has changed. Review the current form.',
        );
      if (
        initialAction?.status !== action.status ||
        initialAction.availability !== action.availability ||
        initialAction.action_type !== action.action_type ||
        initialAction.current_published_version_id !==
          action.current_published_version_id
      )
        throw new ConflictException(
          'The Issue form has changed. Review the current form.',
        );
      if (Buffer.byteLength(JSON.stringify(input.answers), 'utf8') > 32768)
        throw new BadRequestException(
          'Answer payload exceeds the allowed size',
        );
      const definition = await this.repository.loadSubmissionDefinition(
        trx,
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

      const supplied = new Map<string, AnswerInputDto>();
      for (const answer of input.answers) {
        if (supplied.has(answer.questionId))
          throw new BadRequestException('A question may be answered only once');
        supplied.set(answer.questionId, answer);
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
        const entry = supplied.get(question.id);
        if (entry !== undefined) {
          if (question.type === 'information')
            throw new BadRequestException(
              'Information does not accept an answer',
            );
          if (
            question.type === 'multi_select'
              ? entry.value !== undefined || entry.optionKeys === undefined
              : entry.optionKeys !== undefined || entry.value === undefined
          )
            throw new BadRequestException(
              'Answer representation does not match the question',
            );
          const raw =
            question.type === 'multi_select' ? entry.optionKeys : entry.value;
          if (
            !question.required &&
            (question.type === 'short_text' ||
              question.type === 'long_text' ||
              (question.type === 'date' && raw === '')) &&
            typeof raw === 'string' &&
            !raw.trim()
          )
            continue;
          const value = normalizeAnswer(
            question.type as SupportedQuestionType,
            raw,
          );
          if (Array.isArray(value) && !value.length) continue;
          normalizedById.set(question.id, value);
          normalizedByKey.set(question.key, value);
        }
      }
      const persistedAnswers: {
        answerId: string;
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
          throw new BadRequestException(
            'Hidden questions must not be submitted',
          );
        if (
          visible &&
          question.type !== 'information' &&
          question.required &&
          value === undefined
        )
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
          throw new BadRequestException(
            'Text answer is outside allowed length',
          );
        const option =
          question.type === 'single_select'
            ? question.options.find((candidate) => candidate.key === value)
            : undefined;
        if (question.type === 'single_select' && !option)
          throw new BadRequestException('Selected option is invalid');
        const selected =
          question.type === 'multi_select' && Array.isArray(value)
            ? question.options
                .filter((candidate) => value.includes(candidate.key))
                .map((candidate) => candidate.key)
            : null;
        if (selected && selected.length !== (value as string[]).length)
          throw new BadRequestException('Selected option is invalid');
        persistedAnswers.push({
          answerId: randomUUID(),
          id: question.id,
          key: question.key,
          label: question.label,
          type: question.type as SupportedQuestionType,
          order: question.order,
          value: selected ?? value,
          optionLabel: option?.label ?? null,
        });
      }

      if (JSON.stringify(definition) !== JSON.stringify(preparedDefinition))
        throw new ConflictException(
          'The Issue form has changed. Review the current form.',
        );
      const eligibilityResult = preparedEligibility;
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
      batch = await prepareBatch();
      if (batch?.state === 'FINALIZED') {
        // F066. A concurrent submission finalized this batch after the check
        // above, under a different key -- the same key would have replayed.
        // This transaction holds a reservation naming a request it will now
        // never create, so returning the other submission's receipt here
        // would leave that reservation dangling. It fails closed instead; the
        // retry takes the early replay path and returns the original receipt.
        if (reservation !== undefined)
          throw new ConflictException({
            code: SUBMISSION_IN_PROGRESS,
            message:
              'An earlier copy of this submission is still being processed. Wait a moment and try again.',
          });
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
      const referenceNumber = await this.repository.allocateReference(
        trx,
        context.organizationId,
        now,
        definition.businessTimezone,
      );
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
              id: answer.answerId,
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
              ...(answer.type === 'date'
                ? { date_value: String(answer.value) }
                : {}),
              ...(answer.type === 'multi_select'
                ? { selected_option_count: (answer.value as string[]).length }
                : {}),
            })),
          )
          .execute();
      const selections = persistedAnswers.flatMap((answer) =>
        answer.type === 'multi_select'
          ? (answer.value as string[]).map((key) => ({
              organization_id: context.organizationId,
              answer_id: answer.answerId,
              question_id: answer.id,
              option_key: key,
            }))
          : [],
      );
      if (selections.length)
        await trx
          .insertInto('answer_selected_option')
          .values(selections)
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
      // F065: automatic tracking issuance, inside this same transaction, for a
      // resident PUBLIC submission only. It returns undefined whenever the
      // feature is disabled, so a disabled rollout returns exactly the receipt
      // it returned before. The two idempotent replay paths above return
      // earlier and never reach here, so a retry mints nothing: the raw
      // credential is unrecoverable from its digest and is not re-derived.
      const tracking =
        this.intakeTrackingEnabled &&
        context.audience === 'public' &&
        context.requesterIntake
          ? await issueIntakeTrackingCredential(
              trx,
              context.organizationId,
              requestId,
              input.reportingIdentity === 'anonymous'
                ? 'anonymous_resident'
                : 'identified_resident',
            )
          : undefined;
      return {
        id: created.id,
        referenceNumber: created.reference_number,
        status: created.status,
        createdAt: new Date(created.created_at as unknown as string),
        ...(tracking ? { tracking } : {}),
      };
    });
  }
}
