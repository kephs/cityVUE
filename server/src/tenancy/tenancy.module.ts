import { Module } from '@nestjs/common';
import { TenantDomainRepository } from './tenant-domain.repository.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';

/** ADR-025 request tenancy.
 *
 * Imported by AppModule for request resolution. Resident controllers consume
 * the attached context; staff/admin retain identity-derived authority.
 * Registry startup is enabled subject to bootstrap readiness checks. */
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
