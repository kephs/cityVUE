import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import {
  assertStaffRequestPermission,
  requestUuid,
  staffRequestReadScope,
} from './staff-request-scope.js';

@Injectable()
export class RequestAnswerService {
  constructor(private readonly database: DatabaseService) {}

  async read(
    id: string,
    access: StaffAccess | undefined,
    correlationId?: string,
  ) {
    assertStaffRequestPermission(access, 'service_request.answers.read');
    if (!requestUuid.test(id)) throw new NotFoundException();
    return this.database.client.transaction().execute(async (trx) => {
      const parent = await staffRequestReadScope(trx, access)
        .select('request.id')
        .where('request.id', '=', id)
        .forShare(['request', 'category', 'organization'])
        .executeTakeFirst();
      if (!parent) throw new NotFoundException();
      const rows = await trx
        .selectFrom('answer')
        .select([
          'question_id',
          'question_label',
          'question_type',
          'display_order',
          'text_value',
          'number_value',
          'boolean_value',
          'display_value',
        ])
        .where('organization_id', '=', access.organizationId)
        .where('service_request_id', '=', id)
        .orderBy('display_order')
        .orderBy('id')
        .execute();
      await sql`insert into request_answer_read_audit(organization_id,service_request_id,staff_identity_id,correlation_id)
        values(${access.organizationId},${id},${access.staffIdentityId},${correlationId && requestUuid.test(correlationId) ? correlationId : randomUUID()})`.execute(
        trx,
      );
      // The transaction promise resolves only after the mandatory audit commits.
      return {
        answers: rows.map((row) => ({
          questionId: row.question_id,
          label: row.question_label,
          type: row.question_type,
          order: row.display_order,
          displayValue:
            row.question_type === 'yes_no'
              ? row.boolean_value
                ? 'Yes'
                : 'No'
              : row.question_type === 'number'
                ? String(Number(row.number_value))
                : row.question_type === 'single_select'
                  ? (row.display_value ?? '')
                  : (row.text_value ?? ''),
        })),
      };
    });
  }
}
