import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import {
  assertDevelopmentDatabaseUrl,
  developmentOrganization,
} from './development-staff-input.js';
import { DatabaseService } from './database.service.js';
import { brandingInput, provisionBranding } from './organization-branding.js';
async function run() {
  const [command, mode] = process.argv.slice(2);
  if (command === '--help') {
    process.stdout.write(
      'F054 fictional branding: status | set --dry-run/--confirm | clear --dry-run/--confirm. Requires development profile, personal reqro_dev and F054_FICTIONAL_DATA_ONLY=true. Set uses F054_DISPLAY_NAME, optional F054_TAGLINE, optional F054_LOGO_KEY=example-organization. Set/clear require F054_EXPECTED_REVISION. No uploads or arbitrary logo references.\n',
    );
    return;
  }
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    process.env.F054_FICTIONAL_DATA_ONLY !== 'true' ||
    !['status', 'set', 'clear'].includes(command ?? '') ||
    (command === 'status'
      ? process.argv.length !== 3
      : process.argv.length !== 4 ||
        !['--dry-run', '--confirm'].includes(mode ?? ''))
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
    const target = (
      await sql<{
        database: string;
        role: string;
        port: number;
      }>`select current_database() as database,current_user as role,inet_server_port() as port`.execute(
        db,
      )
    ).rows[0];
    if (
      target?.database !== 'reqro_dev' ||
      target.role !== 'reqro_dev_user' ||
      target.port !== 5432
    )
      throw Error('Unexpected target');
    const org = await db
      .selectFrom('organization')
      .select(['name', 'slug', 'status'])
      .where('id', '=', developmentOrganization.id)
      .executeTakeFirst();
    if (
      org?.name !== developmentOrganization.name ||
      org.slug !== developmentOrganization.slug ||
      org.status !== 'active'
    )
      throw Error('Unexpected Organization');
    if (command === 'status') {
      const b = await db
        .selectFrom('organization_branding')
        .select(['display_name', 'tagline', 'logo_key', 'revision'])
        .where('organization_id', '=', developmentOrganization.id)
        .executeTakeFirstOrThrow();
      process.stdout.write(
        JSON.stringify({
          mode: b.display_name ? 'ORGANIZATION' : 'REQRO_DEFAULT',
          revision: b.revision,
          hasTagline: !!b.tagline,
          hasLogo: !!b.logo_key,
        }) + '\n',
      );
    } else {
      const raw = process.env.F054_EXPECTED_REVISION ?? '';
      if (!/^[1-9][0-9]{0,9}$/.test(raw))
        throw Error('Explicit revision required');
      const input = brandingInput(
        command === 'clear'
          ? { displayName: null, tagline: null, logoKey: null }
          : {
              displayName: process.env.F054_DISPLAY_NAME ?? null,
              tagline:
                process.env.F054_TAGLINE === ''
                  ? null
                  : (process.env.F054_TAGLINE ?? null),
              logoKey:
                process.env.F054_LOGO_KEY === ''
                  ? null
                  : (process.env.F054_LOGO_KEY ?? null),
            },
      );
      if (command === 'set' && !input.displayName)
        throw Error('Display name required');
      const result = await provisionBranding(
        db,
        developmentOrganization.id,
        input,
        Number(raw),
        mode === '--dry-run',
      );
      process.stdout.write(
        JSON.stringify({ operation: command, ...result }) + '\n',
      );
    }
  } finally {
    await app.close();
  }
}
run().catch(() => {
  process.stderr.write(
    'F054 development branding operation failed; private details suppressed.\n',
  );
  process.exitCode = 1;
});
