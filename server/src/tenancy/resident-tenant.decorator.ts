import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { RequestWithTenant, TenantContext } from './tenant-context.js';

/**
 * ADR-025 resident tenant accessor.
 *
 * Named for the authority it carries. Resident surfaces take their
 * Organization from the trusted hostname registry; staff and admin surfaces
 * take theirs from verified Entra identity and must **not** use this. The
 * two authorities are deliberately different primitives so they cannot be
 * confused at a call site.
 *
 * Resident controllers consume this context; staff/admin controllers do not.
 */
export function residentTenantFromRequest(
  request: RequestWithTenant,
): TenantContext {
  const state = request.tenantResolution;
  if (state?.status === 'resolved') return state.context;
  if (state?.status === 'invalid_authority') throw new BadRequestException();
  // Infrastructure failure is reported separately because it is independent
  // of whether a hostname belongs to a customer.
  if (state?.status === 'unavailable') throw new ServiceUnavailableException();
  // Everything else — unknown, inactive, unverified,
  // ambiguous, untrusted peer, or middleware never having run — is one
  // indistinguishable 404 carrying no internal detail.
  throw new NotFoundException();
}

export const ResidentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext =>
    residentTenantFromRequest(
      context.switchToHttp().getRequest<RequestWithTenant>(),
    ),
);
