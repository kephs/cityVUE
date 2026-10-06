import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import type { ResolvedTenant } from './tenant-domain.js';

/** Reads the ADR-025 tenant-domain registry.
 *
 * The only lookup is exact equality on an already-normalized hostname. There
 * is no suffix, wildcard or case-insensitive matching, and no query shape that
 * could return a binding the resolver did not ask for. */
@Injectable()
export class TenantDomainRepository {
  constructor(private readonly database: DatabaseService) {}

  private get client(): Kysely<DatabaseSchema> {
    return this.database.client;
  }

  /**
   * Returns resolvable bindings for one exact hostname. Every condition that
   * makes a binding unusable is applied in SQL — inactive binding, unverified
   * binding and inactive Organization — so an unusable row is never carried
   * into application code where a later branch could mistake it for a tenant.
   *
   * Two rows are read rather than one. The database already forbids a
   * duplicate hostname, so a second row would mean that control had failed;
   * reading it lets the resolver detect the ambiguity and refuse instead of
   * silently serving whichever row sorted first.
   */
  findResolvable(hostname: string): Promise<ResolvedTenant[]> {
    return this.client
      .selectFrom('tenant_domain')
      .innerJoin(
        'organization',
        'organization.id',
        'tenant_domain.organization_id',
      )
      .select([
        'tenant_domain.id as domainId',
        'tenant_domain.organization_id as organizationId',
        'tenant_domain.hostname as hostname',
        'tenant_domain.role as role',
      ])
      .where('tenant_domain.hostname', '=', hostname)
      .where('tenant_domain.active', '=', true)
      .where('tenant_domain.verification_state', '=', 'verified')
      .where('organization.status', '=', 'active')
      .limit(2)
      .execute();
  }
}
