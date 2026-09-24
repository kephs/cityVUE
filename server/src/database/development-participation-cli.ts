import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import {
  assertDevelopmentDatabaseUrl,
  developmentOrganization,
} from './development-staff-input.js';
import { DatabaseService } from './database.service.js';

async function run() {
  const [command, mode] = process.argv.slice(2);
  const setting = command === 'enable' || command === 'disable';
  const flag = setting ? mode : command;
  const statusOnly = command === 'status';
  if (flag === '--help') {
    process.stdout.write(
      'F051 fictional area provisioning: --dry-run or --confirm. Requires explicit NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development, F051_FICTIONAL_DATA_ONLY=true and personal reqro_dev target. Default operation creates three fictional areas without enabling collection. Use enable or disable followed by --dry-run/--confirm to change only collection; status reports disabled/ready/incomplete. No requests or grants change.\n',
    );
    return;
  }
  if (
    process.argv.length !== (setting ? 4 : 3) ||
    (!statusOnly && !['--dry-run', '--confirm'].includes(flag ?? '')) ||
    process.env.NODE_ENV !== 'development' ||
    process.env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    process.env.F051_FICTIONAL_DATA_ONLY !== 'true'
  )
    throw Error('Explicit development opt-in required');
  assertDevelopmentDatabaseUrl(process.env.DATABASE_URL ?? '');
  const { AppModule } = await import('../app.module.js');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const db = app.get(DatabaseService).client;
    const diagnostic = await db.transaction().execute(async (trx) => {
      if (flag !== '--confirm')
        await sql`set transaction read only`.execute(trx);
      const target = await sql<{
        database: string;
        role: string;
        port: number;
      }>`select current_database() as database,current_user as role,inet_server_port() as port`.execute(
        trx,
      );
      const row = target.rows[0];
      if (
        row?.database !== 'reqro_dev' ||
        row.role !== 'reqro_dev_user' ||
        row.port !== 5432
      )
        throw Error('Unexpected target');
      const org = await trx
        .selectFrom('organization')
        .select([
          'name',
          'slug',
          'status',
          'service_participation_collection_enabled',
        ])
        .where('id', '=', developmentOrganization.id)
        .executeTakeFirst();
      if (
        org?.name !== developmentOrganization.name ||
        org.slug !== developmentOrganization.slug ||
        org.status !== 'active'
      )
        throw Error('Unexpected Organization');
      if (setting && flag === '--confirm')
        await trx
          .updateTable('organization')
          .set({
            service_participation_collection_enabled: command === 'enable',
          })
          .where('id', '=', developmentOrganization.id)
          .execute();
      if (!setting && !statusOnly && flag === '--confirm')
        for (const [index, label] of [
          'Fictional North Area',
          'Fictional Central Area',
          'Fictional South Area',
        ].entries())
          await trx
            .insertInto('participation_area')
            .values({
              organization_id: developmentOrganization.id,
              display_name: label,
              display_order: index,
            })
            .onConflict((oc) =>
              oc.columns(['organization_id', 'display_name']).doNothing(),
            )
            .execute();
      const enabled =
        setting && flag === '--confirm'
          ? command === 'enable'
          : org.service_participation_collection_enabled;
      const active = await trx
        .selectFrom('participation_area')
        .select('id')
        .where('organization_id', '=', developmentOrganization.id)
        .where('active', '=', true)
        .execute();
      return {
        collectionEnabled: enabled,
        activeAreaCount: active.length,
        state: !enabled ? 'disabled' : active.length ? 'ready' : 'incomplete',
        dryRun: flag === '--dry-run',
        requestedCollection: setting ? command : undefined,
      };
    });
    process.stdout.write(JSON.stringify(diagnostic) + '\n');
    process.stdout.write(
      flag === '--confirm'
        ? 'PASS: explicit development configuration applied; no requests or grants changed.\n'
        : 'PASS: personal development target validated; no writes.\n',
    );
  } finally {
    await app.close();
  }
}
run().catch(() => {
  process.stderr.write(
    'F051 development operation failed; sensitive details suppressed.\n',
  );
  process.exitCode = 1;
});
