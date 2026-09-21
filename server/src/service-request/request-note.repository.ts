import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { requestUuid } from './staff-request-scope.js';

// Preserve PostgreSQL microseconds in the keyset; JS Date would lose tie precision.
const noteTimestamp =
  sql<string>`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
    'createdAt',
  );
interface NoteRow {
  id: string;
  body: string;
  author_display_name: string;
  createdAt: string;
}
const projectNote = (row: NoteRow) => ({
  id: row.id,
  body: row.body,
  author: { displayName: row.author_display_name },
  createdAt: row.createdAt,
});

export function noteCursor(
  value?: string,
): { id: string; createdAt: string } | undefined {
  if (value === undefined) return undefined;
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const cursor = parsed as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(',') !== 'createdAt,id' ||
      typeof cursor.id !== 'string' ||
      !requestUuid.test(cursor.id) ||
      typeof cursor.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.createdAt) ||
      !Number.isFinite(Date.parse(cursor.createdAt))
    )
      throw new Error();
    if (
      cursor.createdAt.startsWith('0000') ||
      new Date(cursor.createdAt).toISOString() !==
        `${cursor.createdAt.slice(0, 23)}Z`
    )
      throw new Error();
    return { id: cursor.id, createdAt: cursor.createdAt };
  } catch {
    throw new BadRequestException('Invalid notes cursor');
  }
}

/** No update/delete operations. Every caller must authorize the parent within this transaction. */
@Injectable()
export class RequestNoteRepository {
  async list(
    trx: Transaction<DatabaseSchema>,
    organizationId: string,
    requestId: string,
    pageSize: number,
    cursor?: string,
  ) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new BadRequestException('Invalid notes page size');
    const before = noteCursor(cursor);
    let query = trx
      .selectFrom('request_internal_note')
      .select(['id', 'body', 'author_display_name', noteTimestamp])
      .where('organization_id', '=', organizationId)
      .where('service_request_id', '=', requestId);
    if (before)
      query = query.where(
        sql<boolean>`(created_at,id) < (${before.createdAt}::timestamptz,${before.id}::uuid)`,
      );
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(pageSize + 1)
      .execute();
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map(projectNote);
    const last = items.at(-1);
    return {
      items,
      pageSize,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ id: last.id, createdAt: last.createdAt }),
            ).toString('base64url')
          : null,
    };
  }

  async create(
    trx: Transaction<DatabaseSchema>,
    input: {
      organizationId: string;
      requestId: string;
      authorId: string;
      authorDisplayName: string;
      submissionKey: string;
      body: string;
    },
  ) {
    const row = await trx
      .insertInto('request_internal_note')
      .values({
        organization_id: input.organizationId,
        service_request_id: input.requestId,
        author_staff_identity_id: input.authorId,
        author_display_name: input.authorDisplayName,
        submission_key: input.submissionKey,
        body: input.body,
      })
      .onConflict((oc) =>
        oc
          .columns([
            'organization_id',
            'service_request_id',
            'author_staff_identity_id',
            'submission_key',
          ])
          .doNothing(),
      )
      .returning(['id', 'body', 'author_display_name', noteTimestamp])
      .executeTakeFirst();
    if (row) return { note: projectNote(row), created: true };
    const prior = await trx
      .selectFrom('request_internal_note')
      .select(['id', 'body', 'author_display_name', noteTimestamp])
      .where('organization_id', '=', input.organizationId)
      .where('service_request_id', '=', input.requestId)
      .where('author_staff_identity_id', '=', input.authorId)
      .where('submission_key', '=', input.submissionKey)
      .executeTakeFirstOrThrow();
    if (prior.body !== input.body)
      throw new ConflictException(
        'Note submission changed; reload before retrying',
      );
    return { note: projectNote(prior), created: false };
  }
}
