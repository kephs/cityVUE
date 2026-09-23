import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { checksum } from '../../src/attachments/attachment.domain.js';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import { AttachmentService } from '../../src/attachments/attachment.service.js';

test('F046 processing remains bounded after HTTP admission is released and recovers after failure', async () => {
  const waiting: ((error: Error) => void)[] = [];
  const database = {
    client: {
      transaction: () => ({
        execute: () =>
          new Promise<never>((_resolve, reject) => waiting.push(reject)),
      }),
    },
  } as unknown as DatabaseService;
  const config = new ConfigService<AppConfiguration, true>({
    attachments: { developmentEnabled: true },
    app: { environment: 'development' },
    deployment: { profile: 'development' },
    catalog: {
      developmentOrganizationId: '10000000-0000-4000-8000-000000000001',
    },
  });
  const service = new AttachmentService(
    database,
    config,
    {} as ServiceRequestRepository,
  );
  const claim = {
    batchId: '10000000-0000-4000-8000-000000000002',
    token: 'synthetic-only',
  };
  const file = {
    buffer: Buffer.from('synthetic'),
    originalname: 'synthetic.png',
    mimetype: 'image/png',
  };
  const releaseA = service.acquire(),
    releaseB = service.acquire();
  const first = service.upload(
    claim,
    '10000000-0000-4000-8000-000000000003',
    file,
  );
  const second = service.upload(
    claim,
    '10000000-0000-4000-8000-000000000004',
    file,
  );
  const completed = Promise.allSettled([first, second]);
  releaseA();
  releaseB();
  await assert.rejects(
    service.upload(claim, '10000000-0000-4000-8000-000000000005', file),
    ServiceUnavailableException,
  );
  assert.equal(waiting.length, 2);
  for (const reject of waiting.splice(0))
    reject(new Error('Fictional transaction failure'));
  assert.ok((await completed).every((result) => result.status === 'rejected'));
  const retry = service.upload(
    claim,
    '10000000-0000-4000-8000-000000000005',
    file,
  );
  assert.equal(waiting.length, 1);
  waiting[0]?.(new Error('Fictional transaction failure'));
  await assert.rejects(retry, /Fictional transaction failure/);
});

test('F046 finalized retries obey capability expiry while valid retries remain available', async () => {
  const organizationId = randomUUID(),
    batchId = randomUUID(),
    issueId = randomUUID(),
    versionId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const digest = checksum('synthetic submission');
  const row = {
    id: batchId,
    organization_id: organizationId,
    context: 'REQUEST_EVIDENCE',
    state: 'FINALIZED',
    token_digest: checksum(token),
    expires_at: new Date(Date.now() - 60000),
    staff_identity_id: null,
    service_definition_id: issueId,
    service_definition_version_id: versionId,
    submission_digest: digest,
  };
  const query = {
    selectAll() {
      return this;
    },
    where() {
      return this;
    },
    forUpdate() {
      return this;
    },
    async executeTakeFirst() {
      return row;
    },
  };
  const trx = {
    selectFrom: () => query,
  } as unknown as Transaction<DatabaseSchema>;
  const config = new ConfigService<AppConfiguration, true>({
    attachments: { developmentEnabled: true },
    app: { environment: 'development' },
    deployment: { profile: 'development' },
    catalog: { developmentOrganizationId: organizationId },
  });
  const service = new AttachmentService(
    {} as DatabaseService,
    config,
    {} as ServiceRequestRepository,
  );
  const claim = { batchId, token };
  const owner = {
    organizationId,
    context: 'REQUEST_EVIDENCE' as const,
    issueId,
    versionId,
  };
  for (const state of ['STAGED', 'FINALIZED']) {
    row.state = state;
    await assert.rejects(
      service.prepare(trx, claim, owner, digest),
      NotFoundException,
    );
  }
  row.state = 'FINALIZED';
  row.expires_at = new Date(Date.now() + 60000);
  assert.equal(await service.prepare(trx, claim, owner, digest), row);
});
