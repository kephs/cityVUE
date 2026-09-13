import { createApiClient } from '../api/apiClient.js';
import { readResidentIntakeConfig } from '../config/runtimeConfig.js';

export async function loadAIWorkspace({ signal, getAccessToken } = {}) {
    const config = readResidentIntakeConfig();
    if (!config.entra.enabled) throw new Error('staff-authentication-required');
    const client = createApiClient({ baseUrl: config.apiBaseUrl, getAccessToken });
    const options = { authenticated: true, signal };
    const status = await client.get('/ai/status', options);
    const models = status.enabled === true ? await client.get('/ai/models', options) : [];
    return { status, models };
}
