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
    return { mode: "api", createServiceRequest: (input, options) => apiClient.post("/service-requests", mapIntakeToCreateServiceRequest(input), options) };
}
