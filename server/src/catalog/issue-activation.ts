import { BadRequestException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  loadQuestions,
  validateQuestions,
} from '../admin/admin-question.domain.js';
import { validateHandling } from './issue-availability.js';
import { issueActionProjection } from './issue-action.domain.js';

/** Validate the resulting state, inside the caller's stable-Issue transaction. */
export async function validateActiveIssue(
  trx: Transaction<DatabaseSchema>,
  org: string,
  id: string,
) {
  const issue = await trx
    .selectFrom('service_definition')
    .selectAll()
    .where('organization_id', '=', org)
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  if (issue.status !== 'active') return;
  validateHandling(issue.availability, issue.action_type);
  issueActionProjection(issue);
  const { rows } = await sql<{
    eligible: boolean;
  }>`select (v.status='published' and c.status='active' and d.status='active' and (c.division_id is null or dv.status='active')) is true as eligible
    from service_definition i join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
    join category c on c.organization_id=i.organization_id and c.id=i.category_id
    join department d on d.organization_id=c.organization_id and d.id=c.department_id
    left join division dv on dv.organization_id=c.organization_id and dv.id=c.division_id where i.organization_id=${org} and i.id=${id}`.execute(
    trx,
  );
  if (!rows[0]?.eligible || !issue.current_published_version_id)
    throw new BadRequestException(
      'Issue configuration is unavailable for activation',
    );
  if (issue.action_type === 'internal_intake') {
    const questions = await loadQuestions(
      trx,
      org,
      issue.current_published_version_id,
    );
    validateQuestions(
      questions.map(
        ({ key, prompt, help, type, required, order, options }) => ({
          key,
          prompt,
          help,
          type,
          required,
          order,
          options,
        }),
      ),
      questions,
    );
  }
}
