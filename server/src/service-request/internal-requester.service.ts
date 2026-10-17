import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequesterAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { lockRequestRow } from './request-authorization.js';
import {
  authorizeRequesterTransaction,
  requesterRequestId,
} from './internal-requester-scope.js';
import { InternalRequesterRepository } from './internal-requester.repository.js';

export const REQUESTER_LIST_PAGE_SIZE = 25;
export const REQUESTER_LIST_PAGE_SIZE_MAXIMUM = 50;
const REQUESTER_LIST_PAGE_MAXIMUM = 1000;

@Injectable()
export class InternalRequesterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: InternalRequesterRepository,
  ) {}

  async list(
    access: RequesterAccess | undefined,
    page = 1,
    pageSize = REQUESTER_LIST_PAGE_SIZE,
  ) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > REQUESTER_LIST_PAGE_MAXIMUM ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > REQUESTER_LIST_PAGE_SIZE_MAXIMUM
    )
      throw new BadRequestException('Invalid request page');
    return this.database.client
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (trx) => {
        const current = await authorizeRequesterTransaction(trx, access);
        return this.repository.list(trx, current, page, pageSize);
      });
  }

  async detail(id: string, access: RequesterAccess | undefined) {
    return this.database.client
      .transaction()
      .setIsolationLevel('read committed')
      .execute(async (trx) => {
        const current = await authorizeRequesterTransaction(trx, access);
        // Same lock order as every other request read: organization, then the
        // parent row, then the scoped query.
        const requestId = requesterRequestId(id);
        await lockRequestRow(trx, current.organizationId, requestId, false);
        const detail = await this.repository.detail(trx, current, requestId);
        // Not theirs, not internal, or absent -- all indistinguishable.
        if (!detail) throw new NotFoundException();
        return detail;
      });
  }
}
