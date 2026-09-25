import { Injectable, NotFoundException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { IssueActionDto } from './issue-action.controller.js';
import { issueActionProjection } from './issue-action.domain.js';
import {
  actionScope,
  assertActionRead,
  configureIssueAction,
} from './issue-action.command.js';
@Injectable()
export class IssueActionService {
  constructor(private readonly database: DatabaseService) {}
  async get(id: string, access: StaffAccess | undefined) {
    assertActionRead(access);
    const row = await actionScope(this.database.client, id, access)
      .select([
        'service.action_type',
        'service.redirect_url',
        'service.redirect_message',
        'service.redirect_label',
        'service.action_revision',
      ])
      .executeTakeFirst();
    if (!row) throw new NotFoundException();
    return { ...issueActionProjection(row), revision: row.action_revision };
  }
  async set(
    id: string,
    input: IssueActionDto,
    access: StaffAccess | undefined,
    correlation?: string,
  ) {
    const result = await this.database.client
      .transaction()
      .execute((trx) =>
        configureIssueAction(trx, id, input, access, correlation),
      );
    const { changed, ...response } = result;
    void changed;
    return response;
  }
}
