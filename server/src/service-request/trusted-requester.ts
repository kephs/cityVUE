import { ForbiddenException } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { requestUuid } from './staff-request-scope.js';

/** Only verified provider adapters may issue this in-process context. Never deserialize it. */
export interface TrustedRequesterContext {
  readonly organizationId: string;
  readonly source: 'DEVELOPMENT_SYNTHETIC';
  readonly subject: string;
}
const issued = new WeakSet<object>();

/** CLI/test adapter, not a resident authentication endpoint or staff identity selection. */
export function developmentRequesterContext(
  environment: {
    NODE_ENV?: string;
    CITYVUE_DEPLOYMENT_PROFILE?: string;
    F050_ENABLE_SYNTHETIC?: string;
  },
  organizationId: string,
  subject: string,
): TrustedRequesterContext {
  if (
    !['development', 'test'].includes(environment.NODE_ENV ?? '') ||
    environment.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    environment.F050_ENABLE_SYNTHETIC !== 'true' ||
    !requestUuid.test(organizationId) ||
    subject !== subject.trim() ||
    !/^fictional-[a-z0-9][a-z0-9-]{0,99}$/.test(subject)
  )
    throw new ForbiddenException('Trusted requester provider unavailable');
  const context = Object.freeze({
    organizationId,
    source: 'DEVELOPMENT_SYNTHETIC' as const,
    subject,
  });
  issued.add(context);
  return context;
}

export function assertTrustedRequester(context: TrustedRequesterContext): void {
  if (!issued.has(context))
    throw new ForbiddenException('Trusted requester provider unavailable');
}

export async function resolveTrustedRequester(
  trx: Transaction<DatabaseSchema>,
  context: TrustedRequesterContext,
): Promise<string> {
  assertTrustedRequester(context);
  const organization = await trx
    .selectFrom('organization')
    .select('id')
    .where('id', '=', context.organizationId)
    .where('status', '=', 'active')
    .forShare()
    .executeTakeFirst();
  if (!organization)
    throw new ForbiddenException('Trusted requester provider unavailable');
  // A unique constraint arbitrates concurrent first resolution. DO NOTHING avoids mutating immutable identity.
  await trx
    .insertInto('requester')
    .values({
      organization_id: context.organizationId,
      identity_source: context.source,
      identity_subject: context.subject,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['organization_id', 'identity_source', 'identity_subject'])
        .doNothing(),
    )
    .execute();
  const row = await trx
    .selectFrom('requester')
    .select('id')
    .where('organization_id', '=', context.organizationId)
    .where('identity_source', '=', context.source)
    .where('identity_subject', '=', context.subject)
    .executeTakeFirstOrThrow();
  return row.id;
}
