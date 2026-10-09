import { assertClientServingConfig } from "./servingConfig.mjs";

export const DATA_SOURCES = Object.freeze({ legacy: "legacy", api: "api" });

/** ADR-025 same-origin direction: the resident frontend and its API share an
 * origin, so the browser's own hostname reaches the server and selects the
 * tenant. One build therefore serves any verified tenant domain. */
export const DEFAULT_API_BASE_URL = "/api/v1";

export function readResidentIntakeConfig(environment = import.meta.env) {
    assertClientServingConfig(environment);
    const dataSource = String(environment?.VITE_CITYVUE_DATA_SOURCE || DATA_SOURCES.legacy).trim().toLowerCase();
    if (!Object.values(DATA_SOURCES).includes(dataSource)) {
        throw new Error("VITE_CITYVUE_DATA_SOURCE must be either legacy or api.");
    }

    const configuredApiBaseUrl = String(environment?.VITE_CITYVUE_API_BASE_URL || "").trim().replace(/\/$/, "");
    const apiBaseUrl = configuredApiBaseUrl || DEFAULT_API_BASE_URL;
    const developmentReadsEnabled = String(environment?.VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS || "false").trim().toLowerCase() === "true";
    // An absent value means same-origin; an explicit override is still only
    // accepted as an absolute HTTP(S) URL, which keeps local development on
    // 5173 pointing at the backend on 3000.
    if (dataSource === DATA_SOURCES.api && configuredApiBaseUrl) {
        let parsed;
        try { parsed = new URL(configuredApiBaseUrl); } catch { throw new Error("VITE_CITYVUE_API_BASE_URL must be a valid HTTP(S) URL."); }
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("VITE_CITYVUE_API_BASE_URL must be a valid HTTP(S) URL.");
    }
    const tenantId = String(environment?.VITE_ENTRA_TENANT_ID || '').trim();
    const webClientId = String(environment?.VITE_ENTRA_WEB_CLIENT_ID || '').trim();
    const apiScope = String(environment?.VITE_ENTRA_API_SCOPE || '').trim();
    const entraValues = [tenantId, webClientId, apiScope];
    if (entraValues.some(Boolean) && !entraValues.every(Boolean)) throw new Error('All CityVUE Entra settings must be configured together.');
    return { dataSource, apiBaseUrl, developmentReadsEnabled: dataSource === DATA_SOURCES.api && developmentReadsEnabled,
        entra: { enabled: dataSource === DATA_SOURCES.api && entraValues.every(Boolean), tenantId, webClientId, apiScope } };
}
