import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { validateEnvironment } from '../config/environment.js';
import { PinoLoggerService } from '../common/logging/pino-logger.service.js';
import { ServiceRequestRepository } from '../service-request/service-request.repository.js';
import { AttachmentService } from './attachment.service.js';
import { DatabaseService } from '../database/database.service.js';
import { commandFailure } from '../common/logging/log-sanitization.js';

/** Explicit local development maintenance; no production scheduler or public cleanup API. */
async function run() {
  // Existing TSX maintenance commands construct dependencies explicitly: TSX does
  // not emit Nest constructor metadata. Do not bootstrap unrelated HTTP modules.
  validateEnvironment(process.env);
  const config = new ConfigService<AppConfiguration, true>(configuration());
  const target = new URL(config.get('database.url', { infer: true }));
  if (
    config.get('deployment.profile', { infer: true }) !== 'development' ||
    config.get('app.environment', { infer: true }) === 'production' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !['/reqro_dev', '/reqro_test'].includes(target.pathname)
  )
    throw new Error('Cleanup target unavailable');
  const database = new DatabaseService(config, new PinoLoggerService(config));
  try {
    const attachments = new AttachmentService(
      database,
      config,
      new ServiceRequestRepository(),
    );
    attachments.assertEnabled();
    if (process.argv[2] === '--apply')
      process.stdout.write(JSON.stringify(await attachments.cleanup()) + '\n');
    else {
      const expired = await database.client
        .selectFrom('attachment_batch')
        .select('id')
        .where('state', '=', 'STAGED')
        .where('expires_at', '<=', new Date())
        .limit(101)
        .execute();
      process.stdout.write(
        JSON.stringify({
          dryRun: true,
          expiredBatches: expired.length,
          applyLimit: 100,
          orphanGraceMinutes: 60,
        }) + '\n',
      );
    }
  } finally {
    await database.onApplicationShutdown();
  }
}
void run().catch((error: unknown) => {
  process.stderr.write(commandFailure('Application event', error));
  process.exitCode = 1;
});
