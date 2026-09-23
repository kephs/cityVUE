import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { sql } from 'kysely';
import { DatabaseService } from './database.service.js';
import {
  assertDevelopmentDatabaseUrl,
  developmentOrganization,
} from './development-staff-input.js';
import { CreateServiceRequestDto } from '../service-request/service-request.dto.js';
import { CreateServiceRequestService } from '../service-request/create-service-request.service.js';
import {
  developmentRequesterContext,
  resolveTrustedRequester,
} from '../service-request/trusted-requester.js';

async function run() {
  const [command, flag] = process.argv.slice(2);
  if (command === '--help') {
    process.stdout.write(
      'F050 fictional requester CLI: provision|create --dry-run|--confirm. Explicit NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development, F050_ENABLE_SYNTHETIC=true, F050_FICTIONAL_DATA_ONLY=true, F050_SUBJECT and F050_ORGANIZATION_ID required. Only localhost:5432/reqro_dev/reqro_dev_user and the existing fictional Organization are accepted. create reads strict PUBLIC intake JSON from F050_INPUT_FILE; identity comes only from the synthetic provider. No HTTP identity endpoint or historical linking. Load ignored environment explicitly. Dry run validates inputs/target without writes; confirm creates new fictional data. Subjects and payloads are never printed.\n',
    );
    return;
  }
  if (
    !['provision', 'create'].includes(command ?? '') ||
    !['--dry-run', '--confirm'].includes(flag ?? '') ||
    process.argv.length !== 4
  )
    throw new Error('Invalid command');
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    process.env.F050_FICTIONAL_DATA_ONLY !== 'true' ||
    process.env.F050_ORGANIZATION_ID !== developmentOrganization.id
  )
    throw new Error('Development opt-in required');
  assertDevelopmentDatabaseUrl(process.env.DATABASE_URL ?? '');
  const context = developmentRequesterContext(
    process.env,
    developmentOrganization.id,
    process.env.F050_SUBJECT ?? '',
  );
  let input: CreateServiceRequestDto | undefined;
  if (command === 'create') {
    input = plainToInstance(
      CreateServiceRequestDto,
      JSON.parse(
        await readFile(process.env.F050_INPUT_FILE ?? '', 'utf8'),
      ) as object,
    );
    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length || input.reportingIdentity !== 'identified')
      throw new Error('Invalid fictional intake');
  }
  const { AppModule } = await import('../app.module.js');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const database = app.get(DatabaseService);
    const target = await sql<{
      database: string;
      role: string;
      port: number;
    }>`select current_database() as database, current_user as role, inet_server_port() as port`.execute(
      database.client,
    );
    if (
      target.rows[0]?.database !== 'reqro_dev' ||
      target.rows[0].role !== 'reqro_dev_user' ||
      target.rows[0].port !== 5432
    )
      throw new Error('Unexpected target');
    const org = await database.client
      .selectFrom('organization')
      .select(['name', 'slug', 'status'])
      .where('id', '=', context.organizationId)
      .executeTakeFirst();
    if (
      org?.name !== developmentOrganization.name ||
      org.slug !== developmentOrganization.slug ||
      org.status !== 'active'
    )
      throw new Error('Unexpected Organization');
    if (flag === '--dry-run') {
      process.stdout.write(
        'PASS: fictional provider, strict input, personal development target and Organization validated; no writes. Creation policy/catalog validation occurs on confirmed creation.\n',
      );
    } else if (command === 'provision') {
      await database.client
        .transaction()
        .execute((trx) => resolveTrustedRequester(trx, context));
      process.stdout.write(
        'PASS: fictional Requester resolved; no requests linked or changed.\n',
      );
    } else if (input) {
      const receipt = await app
        .get(CreateServiceRequestService)
        .executeTrusted(input, context);
      process.stdout.write(
        JSON.stringify({
          id: receipt.id,
          referenceNumber: receipt.referenceNumber,
          status: receipt.status,
        }) + '\n',
      );
    }
  } finally {
    await app.close();
  }
}
run().catch(() => {
  process.stderr.write(
    'F050 development operation failed; sensitive details suppressed.\n',
  );
  process.exitCode = 1;
});
