import { createApiClient } from "../api/apiClient.js";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";
import { createApiServiceRequestRepository } from "./serviceRequestRepositories.js";

export function createServiceRequestDetailsData({ environment, fetchImplementation } = {}) {
    const config = readResidentIntakeConfig(environment);
    if (config.dataSource !== "api" || !config.developmentReadsEnabled) return { mode: "unavailable" };
    return { mode: "api", repository: createApiServiceRequestRepository(createApiClient({ baseUrl: config.apiBaseUrl, fetchImplementation })) };
}
