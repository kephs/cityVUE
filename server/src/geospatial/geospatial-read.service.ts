import type {
  AuthenticatedGeospatialRequest,
  GeospatialAuthorizationService,
} from './geospatial-authorization.service.js';

// No implementation or endpoint is registered in F025. Future providers must
// accept the server-authorized Organization scope; they do not authorize callers.
export interface GeospatialReadRepository<T> {
  getMapData(organizationId: string): Promise<T>;
}

export class GeospatialReadService<T> {
  constructor(
    private readonly authorization: GeospatialAuthorizationService,
    private readonly repository: GeospatialReadRepository<T>,
  ) {}

  async read(
    request: AuthenticatedGeospatialRequest,
    requestedOrganizationId?: string,
  ): Promise<T> {
    const context = this.authorization.authorizeRead(
      request,
      requestedOrganizationId,
    );
    return this.repository.getMapData(context.organizationId);
  }
}
