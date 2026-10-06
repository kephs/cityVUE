import { Module } from '@nestjs/common';
import { TenantDomainRepository } from './tenant-domain.repository.js';
import { TenantResolverService } from './tenant-resolver.service.js';

/** ADR-025 Slice 1a foundation.
 *
 * Intentionally not imported by `AppModule`. Request wiring, TenantContext and
 * registry activation are Slice 1b, and importing this module earlier would
 * make an unwired resolver look servable. */
@Module({
  providers: [TenantDomainRepository, TenantResolverService],
  exports: [TenantDomainRepository, TenantResolverService],
})
export class TenancyModule {}
