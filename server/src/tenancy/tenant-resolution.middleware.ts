import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfiguration } from '../config/configuration.js';
import { PinoLoggerService } from '../common/logging/pino-logger.service.js';
import { TenantResolverService } from './tenant-resolver.service.js';
import {
  resolvedTenant,
  TENANT_NOT_FOUND,
  TENANT_UNAVAILABLE,
  type RequestWithTenant,
  type TenantResolutionState,
} from './tenant-context.js';
import {
  createTenantHostPolicy,
  selectTrustedHost,
  type TenantHostPolicy,
} from './tenant-host-source.js';

/** ADR-025 Slice 1b-A request tenancy.
 *
 * Attaches a `TenantResolutionState` to every request and **never terminates
 * one**. Anonymous routes will require the context in a later slice; staff
 * and admin routes must keep deriving Organization from verified Entra
 * identity and ignore this entirely. Refusing here would impose resident
 * tenancy on staff routes, which is precisely the boundary ADR-025 forbids
 * crossing.
 *
 * No service or controller consumes the attached state in this slice, and
 * `bootstrap.ts` still refuses to serve under the registry strategy, so this
 * creates no production-serving path.
 *
 * The injection graph stays singleton: state travels on the request object
 * and will be passed explicitly to services, rather than making the
 * application request-scoped.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  private readonly strategy: 'development' | 'registry';
  private readonly developmentOrganizationId: string;
  private readonly policy: TenantHostPolicy;

  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly resolver: TenantResolverService,
    private readonly logger: PinoLoggerService,
  ) {
    this.strategy = config.get('tenancy.resolutionStrategy', { infer: true });
    this.developmentOrganizationId = config.get(
      'catalog.developmentOrganizationId',
      { infer: true },
    );
    this.policy = createTenantHostPolicy(
      config.get('tenancy.hostSource', { infer: true }),
      config.get('tenancy.trustedProxyCidrs', { infer: true }),
    );
  }

  async use(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const startedAt = Date.now();
    // RequestLoggingMiddleware assigns a server-owned id before this runs;
    // the fallback only covers a request that bypassed it.
    const correlationId =
      typeof request.id === 'string' ? request.id : randomUUID();
    let state: TenantResolutionState;
    try {
      state = await this.resolve(request, correlationId);
    } catch {
      // Any infrastructure failure is unavailable, never a default tenant.
      state = TENANT_UNAVAILABLE;
    }
    (request as Request & RequestWithTenant).tenantResolution = state;
    this.record(state, correlationId, Date.now() - startedAt);
    next();
  }

  private async resolve(
    request: Request,
    correlationId: string,
  ): Promise<TenantResolutionState> {
    if (this.strategy === 'development') {
      // Not a fallback: valid only inside the already-gated development
      // strategy, which environment validation confines to a development
      // NODE_ENV and profile with an explicit Organization. No registry
      // lookup happens here, and no hostname is consulted.
      if (!this.developmentOrganizationId) return TENANT_NOT_FOUND;
      return resolvedTenant({
        source: 'development',
        organizationId: this.developmentOrganizationId,
        correlationId,
      });
    }

    const selected = selectTrustedHost(
      this.policy,
      request.headers,
      request.socket.remoteAddress,
    );
    if (!selected.ok) return TENANT_NOT_FOUND;

    const binding = await this.resolver.resolve(selected.hostname);
    if (!binding) return TENANT_NOT_FOUND;
    return resolvedTenant({
      source: 'registry',
      organizationId: binding.organizationId,
      hostname: binding.hostname,
      domainId: binding.domainId,
      role: binding.role,
      correlationId,
    });
  }

  /** Sanitized operational evidence. The hostname logged is the normalizer's
   * canonical output, never a raw header, and no forwarded chain, token or
   * Organization identifier is emitted. */
  private record(
    state: TenantResolutionState,
    correlationId: string,
    durationMs: number,
  ): void {
    const resolved = state.status === 'resolved' ? state.context : undefined;
    this.logger.logger.info(
      {
        component: 'http',
        requestId: correlationId,
        durationMs,
        tenantResolution: state.status,
        ...(resolved ? { tenantSource: resolved.source } : {}),
        ...(resolved?.source === 'registry'
          ? { tenantHostname: resolved.hostname, tenantRole: resolved.role }
          : {}),
      },
      'Tenant resolution',
    );
  }
}
