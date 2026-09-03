import IssueService from "../../../assets/services/IssueService.js";
import { mapIntakeToLegacyIssue } from "../catalog/intakeCompatibility.js";
import { mapIntakeToCreateServiceRequest } from "./canonicalSubmission.js";

export function createLegacyIssueRepository({ saveIssue = (issue) => IssueService.saveIssue(issue), createTimestamp = () => new Date().toISOString() } = {}) {
    return { mode: "legacy", async createServiceRequest(input) {
        const issue = saveIssue(mapIntakeToLegacyIssue({ ...input, dateReported: createTimestamp() }));
        return { id: issue?.id, status: issue?.status || "Open", createdAt: issue?.dateReported || input.dateReported };
    } };
}

export function createApiServiceRequestRepository(apiClient) {
    return {
        mode: "api",
        createServiceRequest: (input, options) => apiClient.post("/service-requests", mapIntakeToCreateServiceRequest(input), options),
        getServiceRequestDetails: (id, options) => apiClient.get(`/service-requests/${encodeURIComponent(id)}`, options),
        listServiceRequests: (query = {}, options) => {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) if (value !== "" && value !== undefined) params.set(key, String(value));
            return apiClient.get(`/service-requests${params.size ? `?${params}` : ""}`, options);
        }
    };
}
