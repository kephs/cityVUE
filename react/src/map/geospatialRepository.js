import { validateMapData } from './geospatialData.js';
import { createApiClient } from '../api/apiClient.js';
import { readResidentIntakeConfig } from '../config/runtimeConfig.js';

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

export function createApiGeospatialRepository(client) {
    return {
        mode: 'api',
        async loadMapData(_organizationId, { signal } = {}) {
            const data = await client.get('/geospatial', { authenticated: true, signal });
            // Scope comes from the verified server response, never a browser hint.
            return validateMapData(data, data?.organizationId);
        }
    };
}

export function createPreviewGeospatialRepository({ environment = import.meta.env, ...clientOptions } = {}) {
    const config = readResidentIntakeConfig(environment);
    if (config.dataSource === 'api') return createApiGeospatialRepository(createApiClient({ ...clientOptions, baseUrl: config.apiBaseUrl }));
    // A production/client build cannot serve the bundled development fixture.
    return { mode: 'demo', async loadMapData(organizationId, options) {
        if (!environment.DEV) throw new Error('Geographic data unavailable');
        const { syntheticBoundary, syntheticRequests } = await import('./syntheticMapData.js');
        return createSyntheticGeospatialRepository({ organizationId: PREVIEW_ORGANIZATION_ID, boundary: syntheticBoundary, requests: syntheticRequests }).loadMapData(organizationId, options);
    } };
}
