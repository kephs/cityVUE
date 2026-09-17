import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';

// Only the server's StaffAccessGuard may populate staffAccess on an HTTP request.
// A future route must use @RequireEntra(), @RequirePermission('geospatial.read')
// and @UseGuards(StaffAccessGuard) before calling this internal service.
export interface AuthenticatedGeospatialRequest {
  staffAccess?: StaffAccess;
  id?: string; // Server-generated correlation ID from RequestLoggingMiddleware.
}

export interface TrustedOrganizationContext {
  readonly organizationId: string;
  readonly principalId: string;
  readonly permissions: readonly StaffAccess['permissions'][number][];
  readonly requestId?: string;
}

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GeospatialAuthorizationService {
  authorizeRead(
    request: AuthenticatedGeospatialRequest,
    requestedOrganizationId?: string,
  ): TrustedOrganizationContext {
    const staff = request.staffAccess;
    if (!staff) throw new UnauthorizedException();
    if (
      staff.development ||
      !staff.tenantId ||
      !staff.objectId ||
      !staff.staffIdentityId ||
      !uuidV4.test(staff.organizationId) ||
      !Array.isArray(staff.permissions) ||
      !staff.permissions.includes('geospatial.read') ||
      (requestedOrganizationId !== undefined &&
        requestedOrganizationId !== staff.organizationId)
    ) {
      throw new ForbiddenException('Access denied');
    }
    return {
      organizationId: staff.organizationId,
      principalId: staff.staffIdentityId,
      permissions: ['geospatial.read'],
      ...(request.id && uuidV4.test(request.id)
        ? { requestId: request.id }
        : {}),
    };
  }
}
