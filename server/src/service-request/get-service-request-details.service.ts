import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import type { ServiceRequestDetailsResponseDto } from './service-request.dto.js';
import { ServiceRequestRepository } from './service-request.repository.js';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function answerValue(answer: {
  question_type: string;
  text_value: string | null;
  number_value: string | null;
  boolean_value: boolean | null;
  option_key: string | null;
  display_value: string | null;
}): string | number | boolean {
  if (answer.question_type === 'number') return Number(answer.number_value);
  if (answer.question_type === 'yes_no') return Boolean(answer.boolean_value);
  if (answer.question_type === 'single_select') return answer.option_key ?? '';
  return answer.text_value ?? '';
}

function answerDisplay(answer: Parameters<typeof answerValue>[0]): string {
  if (answer.display_value) return answer.display_value;
  const value = answerValue(answer);
  if (answer.question_type === 'yes_no') return value ? 'Yes' : 'No';
  return String(value);
}

function safeActivityMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const referenceNumber = (value as Record<string, unknown>).referenceNumber;
  return typeof referenceNumber === 'string' ? { referenceNumber } : {};
}

function timestamp(value: unknown): Date | string {
  return value instanceof Date || typeof value === 'string'
    ? value
    : String(value);
}

@Injectable()
export class GetServiceRequestDetailsService {
  private readonly organizationId: string;
  private readonly enabled: boolean;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
    private readonly repository: ServiceRequestRepository,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
    this.enabled = config.get('serviceRequestReads.developmentEnabled', {
      infer: true,
    });
  }

  async execute(id: string): Promise<ServiceRequestDetailsResponseDto> {
    if (!this.enabled || !uuidV4.test(id)) throw new NotFoundException();
    const details = await this.database.client
      .transaction()
      .execute((trx) =>
        this.repository.loadDetails(trx, this.organizationId, id),
      );
    if (!details) throw new NotFoundException();
    const { request, answers, contact, location, activity } = details;
    return {
      serviceRequest: {
        id: request.id,
        referenceNumber: request.reference_number,
        status: request.status,
        priority: request.priority,
        createdAt: timestamp(request.created_at),
        updatedAt: timestamp(request.updated_at),
        revision: request.revision,
      },
      classification: {
        serviceDefinitionId: request.service_definition_id,
        serviceDefinitionVersionId: request.service_definition_version_id,
        issueName: request.issue_name,
        category: { id: request.category_id, name: request.category_name },
        department: {
          id: request.department_id,
          name: request.department_name,
        },
        ...(request.division_id && request.division_name
          ? {
              division: {
                id: request.division_id,
                name: request.division_name,
              },
            }
          : {}),
      },
      request: { description: request.description },
      answers: answers.map((answer) => ({
        questionId: answer.question_id,
        questionKey: answer.question_key,
        label: answer.question_label,
        type: answer.question_type,
        order: answer.display_order,
        displayValue: answerDisplay(answer),
        value: answerValue(answer),
      })),
      ...(location
        ? {
            location: {
              enteredAddress: location.entered_address,
              locationType: location.location_type,
              ...(location.normalized_address
                ? { normalizedAddress: location.normalized_address }
                : {}),
              ...(location.latitude !== null
                ? { latitude: location.latitude }
                : {}),
              ...(location.longitude !== null
                ? { longitude: location.longitude }
                : {}),
              ...(location.eligibility_result
                ? { eligibilityResult: location.eligibility_result }
                : {}),
              ...(location.validated_at
                ? { validatedAt: location.validated_at }
                : {}),
            },
          }
        : {}),
      requester:
        request.reporting_identity === 'anonymous'
          ? { anonymous: true }
          : {
              anonymous: false,
              ...(contact?.name ? { name: contact.name } : {}),
              ...(contact?.email ? { email: contact.email } : {}),
            },
      activity: activity.map((entry) => ({
        type: entry.activity_type,
        actorType: entry.actor_type,
        occurredAt: timestamp(entry.occurred_at),
        metadata: safeActivityMetadata(entry.metadata),
      })),
    };
  }
}
