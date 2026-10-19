import IssueService from "../../../assets/services/IssueService.js";
import { mapIntakeToLegacyIssue } from "../catalog/intakeCompatibility.js";
import { mapIntakeToCreateServiceRequest } from "./canonicalSubmission.js";

export function createLegacyIssueRepository({
  saveIssue = (issue) => IssueService.saveIssue(issue),
  createTimestamp = () => new Date().toISOString(),
} = {}) {
  return {
    mode: "legacy",
    async createServiceRequest(input) {
      const issue = saveIssue(
        mapIntakeToLegacyIssue({ ...input, dateReported: createTimestamp() }),
      );
      return {
        id: issue?.id,
        status: issue?.status || "Open",
        createdAt: issue?.dateReported || input.dateReported,
      };
    },
  };
}

/**
 * F065: the creation receipt is re-whitelisted here, so only the fields the
 * confirmation renders can reach UI state even if the response carries more.
 * The tracking object is admitted only when both parts are well formed, so a
 * partial or malformed response produces the no-credential fallback rather
 * than a broken link.
 */
function createReceipt(response) {
  const tracking = response?.tracking;
  const valid =
    typeof tracking?.credential === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(tracking.credential) &&
    Number.isFinite(Date.parse(tracking?.expiresAt));
  // F066: admitted only as one of the two known states, so an unexpected
  // value cannot reach the confirmation and be rendered as a claim about a
  // tracking link.
  const replay = response?.replay?.tracking;
  const replayed =
    replay === "issued_unrecoverable" || replay === "not_issued"
      ? replay
      : undefined;
  return {
    id: response?.id,
    referenceNumber: response?.referenceNumber,
    status: response?.status,
    createdAt: response?.createdAt,
    ...(valid
      ? {
          tracking: {
            credential: tracking.credential,
            expiresAt: tracking.expiresAt,
          },
        }
      : {}),
    ...(replayed ? { replay: { tracking: replayed } } : {}),
  };
}

export function createApiServiceRequestRepository(
  apiClient,
  { authenticated = false } = {},
) {
  return {
    mode: "api",
    createServiceRequest: (input, options) =>
      apiClient
        .post("/service-requests", mapIntakeToCreateServiceRequest(input), options)
        .then(createReceipt),
    readAnswers: (id, options) =>
      apiClient.get(
        `/staff/service-requests/${encodeURIComponent(id)}/answers`,
        { ...options, authenticated: true },
      ),
    getServiceRequestDetails: (id, options) =>
      apiClient.get(`/service-requests/${encodeURIComponent(id)}`, {
        ...options,
        authenticated,
      }),
    listServiceRequests: (query = {}, options) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== "" && value !== undefined) params.set(key, String(value));
      return apiClient.get(
        `/service-requests${params.size ? `?${params}` : ""}`,
        { ...options, authenticated },
      );
    },
  };
}
