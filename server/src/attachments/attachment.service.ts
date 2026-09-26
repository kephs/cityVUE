import {
  communicationEligibility,
  assertCommunicationEligibility,
} from '../service-request/request-communication-policy.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { AppConfiguration } from '../config/configuration.js';
import type { StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { DatabaseService } from '../database/database.service.js';
import { ServiceRequestRepository } from '../service-request/service-request.repository.js';
import {
  authorizeRequestTransaction,
  lockRequestRow,
  lockRequestOrganization,
} from '../service-request/request-authorization.js';
import {
  assertStaffRequestRead,
  assertStaffRequestPermission,
  requestUuid,
  staffRequestReadScope,
} from '../service-request/staff-request-scope.js';
import {
  attachmentContexts,
  attachmentLimits,
  assertAttachmentCount,
  checksum,
  DevelopmentAttachmentScanner,
  processImage,
  type AttachmentContext,
  type AttachmentScanner,
} from './attachment.domain.js';
import {
  LocalAttachmentStorage,
  newStorageKey,
  type AttachmentStorage,
} from './attachment-storage.js';

type Trx = Transaction<DatabaseSchema>;
type Batch = Selectable<DatabaseSchema['attachment_batch']>;
export interface AttachmentClaim {
  batchId: string;
  token: string;
}
export interface AttachmentOwner {
  organizationId: string;
  context: AttachmentContext;
  requestId?: string;
  staffId?: string;
  issueId?: string;
  versionId?: string;
}
const project = (row: Selectable<DatabaseSchema['attachment']>) => ({
  id: row.id,
  filename: row.filename,
  mediaType: row.media_type,
  byteSize: row.byte_size,
  state: row.scan_state,
});

@Injectable()
export class AttachmentService {
  readonly storage: AttachmentStorage;
  readonly scanner: AttachmentScanner;
  private readonly enabled: boolean;
  private readonly organizationId: string;
  // Reject overload before buffering multipart or decoding. Local process bound, not distributed abuse protection.
  private inflight = 0;
  private processing = 0;
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly requests: ServiceRequestRepository,
  ) {
    this.enabled =
      config.get('attachments', { infer: true })?.developmentEnabled === true &&
      config.get('app.environment', { infer: true }) !== 'production' &&
      config.get('deployment.profile', { infer: true }) === 'development';
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
    this.storage = new LocalAttachmentStorage(
      resolve(__dirname, '../..', '.local-data', 'attachments'),
    );
    this.scanner = new DevelopmentAttachmentScanner();
  }
  assertEnabled() {
    if (!this.enabled)
      throw new ServiceUnavailableException('Attachments are unavailable.');
  }
  policy() {
    return {
      enabled: this.enabled,
      ...attachmentLimits,
      mediaTypes: ['image/jpeg', 'image/png', 'image/webp'],
      developmentScanner: true,
    };
  }
  acquire() {
    this.assertEnabled();
    if (this.inflight >= 2)
      throw new ServiceUnavailableException('Attachment processing is busy.');
    this.inflight++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.inflight--;
      }
    };
  }
  async authorizeParent(
    trx: Trx,
    requestId: string,
    context: AttachmentContext,
    access: StaffAccess | undefined,
    create = false,
  ) {
    if (!requestUuid.test(requestId) || !attachmentContexts.includes(context))
      throw new NotFoundException();
    access = await authorizeRequestTransaction(trx, access);
    await lockRequestRow(trx, access.organizationId, requestId, false);
    // staffRequestReadScope asserts trusted workforce identity and independent parent permissions.
    assertStaffRequestRead(access);
    const parent = staffRequestReadScope(trx, access);
    if (context === 'INTERNAL_NOTE') {
      assertStaffRequestPermission(access, 'service_request.note.read');
      if (create)
        assertStaffRequestPermission(access, 'service_request.note.create');
    }
    if (context === 'REQUESTER_COMMUNICATION') {
      assertStaffRequestPermission(
        access,
        'service_request.communication.read',
      );
      if (create)
        assertStaffRequestPermission(
          access,
          'service_request.communication.create',
        );
    }
    if (create && context === 'REQUEST_EVIDENCE') throw new NotFoundException();
    const authorizedParent = await parent
      .select([
        'request.id',
        communicationEligibility().as('communicationEligibility'),
      ])
      .where('request.id', '=', requestId)
      .forShare(['request', 'category', 'organization'])
      .executeTakeFirst();
    if (!authorizedParent) throw new NotFoundException();
    if (context === 'REQUESTER_COMMUNICATION')
      assertCommunicationEligibility(
        authorizedParent.communicationEligibility,
        create,
      );
  }
  private async audit(
    trx: Trx,
    batch: Batch,
    action: string,
    attachmentId: string | null = null,
    staffId: string | null = batch.staff_identity_id,
  ) {
    await trx
      .insertInto('attachment_audit')
      .values({
        organization_id: batch.organization_id,
        context: batch.context,
        action,
        batch_id: batch.id,
        attachment_id: attachmentId,
        service_request_id: batch.service_request_id,
        staff_identity_id: staffId,
      })
      .execute();
  }
  async startPublic(issueId: string, versionId: string) {
    this.assertEnabled();
    if (!requestUuid.test(issueId) || !requestUuid.test(versionId))
      throw new NotFoundException();
    if (
      !(await this.requests.loadSubmissionDefinition(
        this.database.client,
        this.organizationId,
        issueId,
        versionId,
      ))
    )
      throw new NotFoundException();
    return this.start({
      organizationId: this.organizationId,
      context: 'REQUEST_EVIDENCE',
      issueId,
      versionId,
    });
  }
  async startStaff(
    requestId: string,
    context: AttachmentContext,
    access: StaffAccess,
  ) {
    this.assertEnabled();
    return this.database.client.transaction().execute(async (trx) => {
      await this.authorizeParent(trx, requestId, context, access, true);
      return this.start(
        {
          organizationId: access.organizationId,
          context,
          requestId,
          staffId: access.staffIdentityId,
        },
        trx,
      );
    });
  }
  private async start(owner: AttachmentOwner, existing?: Trx) {
    const run = async (trx: Trx) => {
      await lockRequestOrganization(trx, owner.organizationId);
      // Serialize per-Organization admission; active stage and hourly caps bound anonymous storage/processing.
      await sql`select pg_advisory_xact_lock(hashtextextended(${owner.organizationId},46))`.execute(
        trx,
      );
      const counts = await trx
        .selectFrom('attachment_audit')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('action', '=', 'opened')
        .where('organization_id', '=', owner.organizationId)
        .where(
          'created_at',
          '>',
          sql<Date>`clock_timestamp() - interval '1 hour'`,
        )
        .executeTakeFirstOrThrow();
      const active = await trx
        .selectFrom('attachment_batch')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('organization_id', '=', owner.organizationId)
        .where('state', '=', 'STAGED')
        .executeTakeFirstOrThrow();
      if (Number(active.count) >= 20 || Number(counts.count) >= 100)
        throw new ServiceUnavailableException('Attachment staging is busy.');
      const token = randomBytes(32).toString('base64url');
      const batch = await trx
        .insertInto('attachment_batch')
        .values({
          organization_id: owner.organizationId,
          context: owner.context,
          token_digest: checksum(token),
          staff_identity_id: owner.staffId ?? null,
          service_definition_id: owner.issueId ?? null,
          service_definition_version_id: owner.versionId ?? null,
          service_request_id: owner.requestId ?? null,
          note_id: null,
          communication_id: null,
          submission_digest: null,
          finalized_at: null,
          expires_at: new Date(Date.now() + attachmentLimits.lifetimeMs),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit(trx, batch, 'opened');
      return { batchId: batch.id, token, expiresAt: batch.expires_at };
    };
    return existing
      ? run(existing)
      : this.database.client.transaction().execute(run);
  }
  private async batch(
    trx: Trx,
    claim: AttachmentClaim | undefined,
    access?: StaffAccess,
    allowFinal = false,
  ) {
    if (
      !claim ||
      !requestUuid.test(claim.batchId) ||
      !/^[\w-]{43}$/.test(claim.token)
    )
      throw new NotFoundException();
    // This lookup only locates the parent. The locked row is checked again below.
    const candidate = await trx
      .selectFrom('attachment_batch')
      .selectAll()
      .where('id', '=', claim.batchId)
      .executeTakeFirst();
    if (!candidate) throw new NotFoundException();
    if (candidate.context === 'REQUEST_EVIDENCE') {
      if (candidate.organization_id !== this.organizationId || access)
        throw new NotFoundException();
      await lockRequestOrganization(trx, candidate.organization_id);
    } else {
      if (
        !candidate.service_request_id ||
        candidate.organization_id !== access?.organizationId ||
        candidate.staff_identity_id !== access.staffIdentityId
      )
        throw new NotFoundException();
      await this.authorizeParent(
        trx,
        candidate.service_request_id,
        candidate.context as AttachmentContext,
        access,
        true,
      );
    }
    const batch = await trx
      .selectFrom('attachment_batch')
      .selectAll()
      .where('id', '=', claim.batchId)
      .forUpdate()
      .executeTakeFirst();
    if (
      batch?.organization_id !== candidate.organization_id ||
      (candidate.context !== 'REQUEST_EVIDENCE' &&
        batch.service_request_id !== candidate.service_request_id) ||
      batch.staff_identity_id !== candidate.staff_identity_id ||
      batch.context !== candidate.context ||
      !timingSafeEqual(
        Buffer.from(batch.token_digest, 'hex'),
        Buffer.from(checksum(claim.token), 'hex'),
      ) ||
      (!allowFinal && batch.state !== 'STAGED') ||
      new Date(batch.expires_at).getTime() <= Date.now()
    )
      throw new NotFoundException();
    if (batch.context === 'REQUEST_EVIDENCE') {
      if (batch.organization_id !== this.organizationId || access)
        throw new NotFoundException();
    } else {
      if (
        access?.organizationId !== batch.organization_id ||
        access.staffIdentityId !== batch.staff_identity_id
      )
        throw new NotFoundException();
      if (!batch.service_request_id) throw new NotFoundException();
    }
    return batch;
  }
  async admit(claim: AttachmentClaim, access?: StaffAccess) {
    this.assertEnabled();
    return this.database.client
      .transaction()
      .execute((trx) => this.batch(trx, claim, access).then(() => undefined));
  }
  async upload(
    claim: AttachmentClaim,
    fileId: string,
    file:
      { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    access?: StaffAccess,
  ) {
    this.assertEnabled();
    if (!requestUuid.test(fileId) || !file)
      throw new BadRequestException('A file is required.');
    // A disconnected HTTP response releases parser admission, not work already decoding.
    if (this.processing >= 2)
      throw new ServiceUnavailableException('Attachment processing is busy.');
    this.processing++;
    let written: { org: string; key: string } | undefined;
    try {
      const admitted = await this.database.client
        .transaction()
        .execute((trx) => this.batch(trx, claim, access));
      const processed = await processImage(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      if ((await this.scanner.scan(processed.bytes)) !== 'CLEAN')
        throw new BadRequestException('File was rejected.');
      const key = newStorageKey();
      await this.storage.write(admitted.organization_id, key, processed.bytes);
      written = { org: admitted.organization_id, key };
      const disposition = { retained: false };
      const result = await this.database.client
        .transaction()
        .execute(async (trx) => {
          const batch = await this.batch(trx, claim, access);
          const prior = await trx
            .selectFrom('attachment')
            .selectAll()
            .where('id', '=', fileId)
            .executeTakeFirst();
          if (prior) {
            if (
              prior.batch_id !== batch.id ||
              prior.content_checksum !== processed.checksum ||
              prior.filename !== processed.filename ||
              prior.scan_state !== 'CLEAN'
            )
              throw new ConflictException();
            return project(prior);
          }
          const rows = await trx
            .selectFrom('attachment')
            .select(['byte_size', 'source_byte_size'])
            .where('batch_id', '=', batch.id)
            .execute();
          assertAttachmentCount([
            ...rows.map((x) => Math.max(x.byte_size, x.source_byte_size)),
            Math.max(file.buffer.length, processed.byteSize),
          ]);
          await trx
            .insertInto('attachment')
            .values({
              id: fileId,
              organization_id: batch.organization_id,
              batch_id: batch.id,
              context: batch.context,
              storage_key: key,
              filename: processed.filename,
              media_type: processed.mediaType,
              byte_size: processed.byteSize,
              source_byte_size: file.buffer.length,
              content_checksum: processed.checksum,
              scan_state: 'PENDING_SCAN',
            })
            .execute();
          const clean = await trx
            .updateTable('attachment')
            .set({ scan_state: 'CLEAN' })
            .where('id', '=', fileId)
            .returningAll()
            .executeTakeFirstOrThrow();
          await this.audit(trx, batch, 'staged', fileId);
          disposition.retained = true;
          return project(clean);
        });
      if (!disposition.retained)
        await this.storage
          .remove(written.org, written.key)
          .catch(() => undefined);
      return result;
    } catch (error) {
      if (written)
        await this.storage
          .remove(written.org, written.key)
          .catch(() => undefined); // Inventory cleanup is authoritative after crash/cleanup failure.
      throw error;
    } finally {
      this.processing--;
    }
  }
  private async checkedBytes(file: Selectable<DatabaseSchema['attachment']>) {
    try {
      const bytes = await this.storage.read(
        file.organization_id,
        file.storage_key,
      );
      if (
        bytes.length !== file.byte_size ||
        checksum(bytes) !== file.content_checksum
      )
        throw new Error();
      return bytes;
    } catch {
      throw new NotFoundException();
    }
  }
  async preview(claim: AttachmentClaim, fileId: string, access?: StaffAccess) {
    this.assertEnabled();
    if (!requestUuid.test(fileId)) throw new NotFoundException();
    const locate = async (trx: Trx) => {
      const batch = await this.batch(trx, claim, access);
      const file = await trx
        .selectFrom('attachment')
        .selectAll()
        .where('batch_id', '=', batch.id)
        .where('id', '=', fileId)
        .where('scan_state', '=', 'CLEAN')
        .executeTakeFirst();
      if (!file) throw new NotFoundException();
      return { batch, file };
    };
    const prepared = await this.database.client.transaction().execute(locate);
    const bytes = await this.checkedBytes(prepared.file);
    return this.database.client.transaction().execute(async (trx) => {
      const current = await locate(trx);
      if (JSON.stringify(current.file) !== JSON.stringify(prepared.file))
        throw new NotFoundException();
      await this.audit(trx, current.batch, 'downloaded', fileId);
      return { metadata: project(current.file), bytes };
    });
  }
  async remove(
    claim: AttachmentClaim,
    fileId: string | undefined,
    access?: StaffAccess,
  ) {
    this.assertEnabled();
    return this.database.client.transaction().execute(async (trx) => {
      const batch = await this.batch(trx, claim, access);
      let query = trx
        .selectFrom('attachment')
        .selectAll()
        .where('batch_id', '=', batch.id);
      if (fileId) {
        if (!requestUuid.test(fileId)) throw new NotFoundException();
        query = query.where('id', '=', fileId);
      }
      const rows = await query.execute();
      for (const row of rows) {
        // Deleting metadata first leaves only a recoverable orphan if object deletion fails.
        await trx.deleteFrom('attachment').where('id', '=', row.id).execute();
        await this.audit(trx, batch, 'removed', row.id);
      }
      // Objects deliberately remain until inventory cleanup; rollback cannot strand a live row without its object.
      if (!fileId)
        await trx
          .deleteFrom('attachment_batch')
          .where('id', '=', batch.id)
          .execute();
      return { removed: true };
    });
  }
  async prepare(
    trx: Trx,
    claim: AttachmentClaim,
    owner: AttachmentOwner,
    digest: string,
    access?: StaffAccess,
    prepared?: { manifest: string; finalized: boolean },
  ) {
    this.assertEnabled();
    const batch = await this.batch(trx, claim, access, true);
    if (
      batch.organization_id !== owner.organizationId ||
      batch.context !== owner.context ||
      batch.staff_identity_id !== (owner.staffId ?? null) ||
      (owner.requestId && batch.service_request_id !== owner.requestId) ||
      batch.service_definition_id !== (owner.issueId ?? null) ||
      batch.service_definition_version_id !== (owner.versionId ?? null)
    )
      throw new NotFoundException();
    if (batch.state === 'FINALIZED') {
      if (batch.submission_digest !== digest)
        throw new ConflictException('Attachment submission changed.');
      return batch;
    }
    const files = await trx
      .selectFrom('attachment')
      .selectAll()
      .where('batch_id', '=', batch.id)
      .execute();
    if (!files.length || files.some((x) => x.scan_state !== 'CLEAN'))
      throw new ConflictException('Attachments are not ready.');
    if (prepared?.manifest !== this.manifest(files))
      throw new ConflictException(
        'Attachments changed; review before retrying.',
      );
    return batch;
  }

  private manifest(files: Selectable<DatabaseSchema['attachment']>[]) {
    return checksum(
      JSON.stringify([...files].sort((a, b) => a.id.localeCompare(b.id))),
    );
  }

  /** Immutable object reads happen before the final parent/child transaction. */
  async prepareFiles(claim: AttachmentClaim, access?: StaffAccess) {
    const prepared = await this.database.client
      .transaction()
      .execute(async (trx) => {
        const batch = await this.batch(trx, claim, access, true);
        return {
          finalized: batch.state === 'FINALIZED',
          files: await trx
            .selectFrom('attachment')
            .selectAll()
            .where('batch_id', '=', batch.id)
            .execute(),
        };
      });
    const { files, finalized } = prepared;
    if (
      !finalized &&
      (!files.length || files.some((file) => file.scan_state !== 'CLEAN'))
    )
      throw new ConflictException('Attachments are not ready.');
    if (!finalized)
      for (const file of files) {
        const bytes = await this.storage.read(
          file.organization_id,
          file.storage_key,
        );
        if (
          bytes.length !== file.byte_size ||
          checksum(bytes) !== file.content_checksum
        )
          throw new ServiceUnavailableException('Attachment unavailable.');
      }
    return { manifest: this.manifest(files), finalized };
  }
  async finalize(
    trx: Trx,
    batch: Batch,
    requestId: string,
    parentId: string,
    digest: string,
  ) {
    if (batch.state === 'FINALIZED') {
      if (
        batch.service_request_id !== requestId ||
        (batch.context === 'INTERNAL_NOTE' && batch.note_id !== parentId) ||
        (batch.context === 'REQUESTER_COMMUNICATION' &&
          batch.communication_id !== parentId)
      )
        throw new ConflictException();
      return;
    }
    const updated = await trx
      .updateTable('attachment_batch')
      .set({
        state: 'FINALIZED',
        service_request_id: requestId,
        note_id: batch.context === 'INTERNAL_NOTE' ? parentId : null,
        communication_id:
          batch.context === 'REQUESTER_COMMUNICATION' ? parentId : null,
        submission_digest: digest,
        finalized_at: new Date(),
      })
      .where('id', '=', batch.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit(trx, updated, 'finalized');
  }
  async assertPriorBatch(
    trx: Trx,
    context: AttachmentContext,
    parentId: string,
    batchId?: string,
  ) {
    if (!this.enabled && !batchId) return;
    const column = context === 'INTERNAL_NOTE' ? 'note_id' : 'communication_id';
    const prior = await trx
      .selectFrom('attachment_batch')
      .select('id')
      .where(column, '=', parentId)
      .executeTakeFirst();
    if (prior?.id !== batchId)
      throw new ConflictException('Attachment submission changed.');
  }
  async decorate<T extends { id: string }>(
    trx: Trx,
    organizationId: string,
    requestId: string,
    context: AttachmentContext,
    items: T[],
  ) {
    if (!this.enabled || !items.length) return items;
    const column =
      context === 'INTERNAL_NOTE' ? 'b.note_id' : 'b.communication_id';
    const rows = await trx
      .selectFrom('attachment as a')
      .innerJoin('attachment_batch as b', 'b.id', 'a.batch_id')
      .selectAll('a')
      .select(`${column} as parentId`)
      .where('b.organization_id', '=', organizationId)
      .where('b.service_request_id', '=', requestId)
      .where('b.context', '=', context)
      .where('b.state', '=', 'FINALIZED')
      .where(
        column,
        'in',
        items.map((x) => x.id),
      )
      .execute();
    return items.map((item) => {
      const attachments = rows
        .filter((x) => x.parentId === item.id)
        .map(project);
      return attachments.length ? { ...item, attachments } : item;
    });
  }
  async evidence(requestId: string, access: StaffAccess) {
    this.assertEnabled();
    return this.database.client.transaction().execute(async (trx) => {
      await this.authorizeParent(trx, requestId, 'REQUEST_EVIDENCE', access);
      const rows = await trx
        .selectFrom('attachment as a')
        .innerJoin('attachment_batch as b', 'b.id', 'a.batch_id')
        .selectAll('a')
        .where('b.organization_id', '=', access.organizationId)
        .where('b.service_request_id', '=', requestId)
        .where('b.context', '=', 'REQUEST_EVIDENCE')
        .where('b.state', '=', 'FINALIZED')
        .execute();
      return { items: rows.map(project) };
    });
  }
  async download(
    requestId: string,
    context: AttachmentContext,
    parentId: string,
    fileId: string,
    access: StaffAccess,
  ) {
    this.assertEnabled();
    if (!requestUuid.test(parentId) || !requestUuid.test(fileId))
      throw new NotFoundException();
    const locate = async (trx: Trx) => {
      await this.authorizeParent(trx, requestId, context, access);
      const column =
        context === 'INTERNAL_NOTE'
          ? 'b.note_id'
          : context === 'REQUESTER_COMMUNICATION'
            ? 'b.communication_id'
            : 'b.service_request_id';
      const file = await trx
        .selectFrom('attachment as a')
        .innerJoin('attachment_batch as b', 'b.id', 'a.batch_id')
        .selectAll('a')
        .where('b.organization_id', '=', access.organizationId)
        .where('b.service_request_id', '=', requestId)
        .where('b.context', '=', context)
        .where(column, '=', parentId)
        .where('a.id', '=', fileId)
        .where('a.scan_state', '=', 'CLEAN')
        .where('b.state', '=', 'FINALIZED')
        .executeTakeFirst();
      if (!file) throw new NotFoundException();
      const batch = await trx
        .selectFrom('attachment_batch')
        .selectAll()
        .where('id', '=', file.batch_id)
        .executeTakeFirstOrThrow();
      return { file, batch };
    };
    const prepared = await this.database.client.transaction().execute(locate);
    const bytes = await this.checkedBytes(prepared.file);
    return this.database.client.transaction().execute(async (trx) => {
      const current = await locate(trx);
      if (JSON.stringify(current.file) !== JSON.stringify(prepared.file))
        throw new NotFoundException();
      await this.audit(
        trx,
        current.batch,
        'downloaded',
        fileId,
        access.staffIdentityId,
      );
      return { metadata: project(current.file), bytes };
    });
  }
  async cleanup(now = new Date()) {
    this.assertEnabled();
    const expired = await this.database.client
      .transaction()
      .execute(async (trx) => {
        const batches = await trx
          .selectFrom('attachment_batch')
          .selectAll()
          .where('state', '=', 'STAGED')
          .where('expires_at', '<=', now)
          .forUpdate()
          .skipLocked()
          .limit(100)
          .execute();
        for (const batch of batches) {
          await trx
            .deleteFrom('attachment')
            .where('batch_id', '=', batch.id)
            .execute();
          await this.audit(trx, batch, 'expired');
          await trx
            .deleteFrom('attachment_batch')
            .where('id', '=', batch.id)
            .execute();
        }
        return batches.length;
      });
    let orphansRemoved = 0;
    if (this.storage instanceof LocalAttachmentStorage) {
      for (const object of await this.storage.inventory()) {
        // Grace period protects files whose metadata transaction has not committed yet.
        if (object.modifiedAt.getTime() > now.getTime() - 3600000) continue;
        const row = await this.database.client
          .selectFrom('attachment')
          .select('id')
          .where('organization_id', '=', object.organizationId)
          .where('storage_key', '=', object.key)
          .executeTakeFirst();
        if (!row) {
          await this.storage.remove(object.organizationId, object.key);
          orphansRemoved++;
        }
      }
    }
    return { expiredBatches: expired, orphansRemoved };
  }
}
