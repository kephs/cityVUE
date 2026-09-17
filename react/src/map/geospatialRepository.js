import { validateMapData } from './geospatialData.js';
import { syntheticBoundary, syntheticRequests } from './syntheticMapData.js';

// Demo scope mirrors the local seed. Browser scope is never an authorization boundary.
export const PREVIEW_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';

export function createSyntheticGeospatialRepository({ organizationId, boundary, requests }) {
    return {
        async loadMapData(requestedOrganizationId, { signal } = {}) {
            if (!requestedOrganizationId || requestedOrganizationId !== organizationId) throw new Error('Geographic data unavailable');
            if (signal?.aborted) throw new Error('Geographic data unavailable');
            // Return a distinct serializable snapshot so consumers cannot mutate provider fixtures.
            return validateMapData(structuredClone({ organizationId, boundary, requests }), requestedOrganizationId);
        }
    };
}

export function createPreviewGeospatialRepository() {
    // A production/client build cannot serve the bundled development fixture.
    if (!import.meta.env.DEV) return { loadMapData: async () => { throw new Error('Geographic data unavailable'); } };
    return createSyntheticGeospatialRepository({ organizationId: PREVIEW_ORGANIZATION_ID, boundary: syntheticBoundary, requests: syntheticRequests });
}
