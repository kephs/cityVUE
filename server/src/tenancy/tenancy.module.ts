import { Module } from '@nestjs/common';
import { TenantDomainRepository } from './tenant-domain.repository.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';

/** ADR-025 request tenancy.
 *
 * Imported by `AppModule` so the resolution middleware can be applied, but
 * nothing yet consumes the context it attaches, and `bootstrap.ts` still
 * refuses to serve under the registry strategy. Request wiring of actual
 * Organization consumers is a later slice. */
@Module({
  providers: [
    TenantDomainRepository,
    TenantResolverService,
    TenantResolutionMiddleware,
  ],
  exports: [
    TenantDomainRepository,
    TenantResolverService,
    TenantResolutionMiddleware,
  ],
})
export class TenancyModule {}
