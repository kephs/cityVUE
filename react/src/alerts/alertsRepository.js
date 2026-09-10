import { createApiClient } from '../api/apiClient.js';
import { readResidentIntakeConfig } from '../config/runtimeConfig.js';

export async function loadActiveAlerts({ signal } = {}) {
    const config = readResidentIntakeConfig();
    if (config.dataSource !== 'api') return [];
    return createApiClient({ baseUrl: config.apiBaseUrl }).get('/alerts/active', { signal });
}
