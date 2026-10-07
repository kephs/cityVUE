import {
  communicationEligibility,
  assertCommunicationEligibility,
} from './request-communication-policy.js';
import { requestTransaction, lockRequestRow } from './request-authorization.js';
import { Optional } from '@nestjs/common';
import {
  AttachmentService,
  staffAuthority,
  type AttachmentClaim,
} from '../attachments/attachment.service.js';
import { checksum } from '../attachments/attachment.domain.js';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { DatabaseService } from '../database/database.service.js';
import { safeStaffName } from './ownership-targets.js';
import { normalizeCommunicationBody } from './request-communication.domain.js';
import { RequestCommunicationRepository } from './request-communication.repository.js';
import {
  assertStaffRequestPermission,
  assertStaffRequestRead,
  requestUuid,
  staffRequestReadScope,
} from './staff-request-scope.js';

@Injectable()
export class RequestCommunicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly communications: RequestCommunicationRepository,
    @Optional() private readonly attachments?: AttachmentService,
  ) {}

  private async parent(
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess,
    id: string,
    create = false,
  ) {
    if (!requestUuid.test(id)) throw new NotFoundException();
    await lockRequestRow(trx, access.organizationId, id, false);
    // The persisted audience determines access; shared locks prevent routing during this operation.
    const row = await staffRequestReadScope(trx, access)
      .select([
        'request.id',
        communicationEligibility().as('communicationEligibility'),
      ])
      .where('request.id', '=', id)
      .forShare(['request', 'category', 'organization'])
      .executeTakeFirst();
    if (!row) throw new NotFoundException();
    assertCommunicationEligibility(row.communicationEligibility, create);
  }

  async list(
    id: string,
    access: StaffAccess | undefined,
    pageSize = 25,
    cursor?: string,
  ) {
    assertStaffRequestRead(access);
    assertStaffRequestPermission(access, 'service_request.communication.read');
    return requestTransaction(
      this.database.client,
      access,
      ['service_request.communication.read'],
      async (trx, access) => {
        await this.parent(trx, access, id);
        const page = await this.communications.list(
          trx,
          access.organizationId,
          id,
          pageSize,
          cursor,
        );
        if (this.attachments)
          page.items = await this.attachments.decorate(
            trx,
            access.organizationId,
            id,
            'REQUESTER_COMMUNICATION',
            page.items,
          );
        return page;
      },
    );
  }

  async create(
    id: string,
    access: StaffAccess | undefined,
    body: unknown,
    submissionKey: string | undefined,
    correlationId?: string,
    attachmentClaim?: AttachmentClaim,
  ) {
    assertStaffRequestRead(access);
    assertStaffRequestPermission(access, 'service_request.communication.read');
    assertStaffRequestPermission(
      access,
      'service_request.communication.create',
    );
    if (!submissionKey || !requestUuid.test(submissionKey))
      throw new BadRequestException(
        'A valid communication submission key is required',
      );
    const attachments = this.attachments;
    if (attachmentClaim && !attachments)
      throw new BadRequestException('Attachments unavailable');
    const prepared =
      attachmentClaim && attachments
        ? await attachments.prepareFiles(
            attachmentClaim,
            staffAuthority(access),
          )
        : undefined;
    const normalized = normalizeCommunicationBody(body);
    return requestTransaction(
      this.database.client,
      access,
      [
        'service_request.communication.read',
        'service_request.communication.create',
      ],
      async (trx, access) => {
        await this.parent(trx, access, id, true);
        const attachmentDigest = checksum(normalized);
        const batch =
          attachmentClaim && attachments
            ? await attachments.prepare(
                trx,
                attachmentClaim,
                {
                  organizationId: access.organizationId,
                  context: 'REQUESTER_COMMUNICATION',
                  requestId: id,
                  staffId: access.staffIdentityId,
                },
                attachmentDigest,
                staffAuthority(access),
                prepared,
              )
            : undefined;
        const author = await trx
          .selectFrom('staff_identity as s')
          .select(safeStaffName.as('displayName'))
          .where('s.organization_id', '=', access.organizationId)
          .where('s.id', '=', access.staffIdentityId)
          .where('s.active', '=', true)
          .forShare()
          .executeTakeFirst();
        if (!author) throw new ForbiddenException('Access denied');
        const result = await this.communications.create(trx, {
          organizationId: access.organizationId,
          requestId: id,
          authorId: access.staffIdentityId,
          authorDisplayName: author.displayName.trim() || 'Staff member',
          submissionKey,
          body: normalized,
        });
        if (!result.created && this.attachments)
          await this.attachments.assertPriorBatch(
            trx,
            'REQUESTER_COMMUNICATION',
            result.communication.id,
            batch?.id,
          );
        if (batch && attachments)
          await attachments.finalize(
            trx,
            batch,
            id,
            result.communication.id,
            attachmentDigest,
          );
        if (result.created)
          await trx
            .insertInto('activity')
            .values({
              id: randomUUID(),
              organization_id: access.organizationId,
              service_request_id: id,
              activity_type: 'service_request_communication_created',
              actor_type: 'staff',
              actor_reference: null,
              staff_identity_id: access.staffIdentityId,
              metadata: {
                policy: 'F042',
                action: 'communication_created',
                communicationId: result.communication.id,
                correlationId:
                  correlationId && requestUuid.test(correlationId)
                    ? correlationId
                    : randomUUID(),
              },
            })
            .execute();
        return this.attachments
          ? ((
              await this.attachments.decorate(
                trx,
                access.organizationId,
                id,
                'REQUESTER_COMMUNICATION',
                [result.communication],
              )
            )[0] ?? result.communication)
          : result.communication;
      },
    );
  }
}
