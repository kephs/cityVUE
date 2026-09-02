import { createApiClient } from "../api/apiClient.js";
import { createApiCatalogRepository, createFixtureCatalogRepository } from "../catalog/catalogRepositories.js";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";
import { createApiServiceRequestRepository, createLegacyIssueRepository } from "../serviceRequests/serviceRequestRepositories.js";

export function createResidentIntakeRepositories({ environment, fetchImplementation, saveIssue, createTimestamp } = {}) {
    const config = readResidentIntakeConfig(environment);
    if (config.dataSource === "legacy") return { mode: "legacy", catalog: createFixtureCatalogRepository(), requests: createLegacyIssueRepository({ saveIssue, createTimestamp }) };
    const client = createApiClient({ baseUrl: config.apiBaseUrl, fetchImplementation });
    return { mode: "api", catalog: createApiCatalogRepository(client), requests: createApiServiceRequestRepository(client) };
}
