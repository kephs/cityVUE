import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { loadQuestions } from '../../src/admin/admin-question.domain.js';

/** Migrate existing template scenarios to an explicitly reviewed creation request. */
export async function reviewedCreation(
  db: Kysely<DatabaseSchema>,
  org: string,
  templateId: string,
) {
  return db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom('service_definition')
      .selectAll()
      .where('organization_id', '=', org)
      .where('id', '=', templateId)
      .executeTakeFirstOrThrow();
    if (!source.current_published_version_id)
      throw new Error('Published source required');
    const version = await trx
      .selectFrom('service_definition_version')
      .selectAll()
      .where('id', '=', source.current_published_version_id)
      .executeTakeFirstOrThrow();
    const questions = await loadQuestions(trx, org, version.id);
    return {
      categoryId: source.category_id,
      defaultPriority: version.default_priority,
      locationPolicy: version.location_policy,
      geographicEligibilityMode: 'no_geographic_restriction',
      handling: { actionType: 'internal_intake' },
      expectedSourceVersion: version.id,
      questions: questions.map(
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
    };
  });
}
