/**
 * F064.1: the authenticated requester's own internal requests.
 *
 * Every response is re-whitelisted to the fields the page renders, so nothing
 * the API might add later reaches UI state without a deliberate change here.
 * A malformed update entry is dropped rather than failing a read whose status
 * and reference are still useful.
 */
import { createApiClient } from "../api/apiClient.js";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";

const UPDATE_LIMIT = 25;

function safeUpdates(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (update) =>
        typeof update?.id === "string" &&
        typeof update.body === "string" &&
        typeof update.sender?.displayName === "string" &&
        Number.isFinite(Date.parse(update.createdAt)),
    )
    .slice(0, UPDATE_LIMIT)
    .map((update) => ({
      id: update.id,
      body: update.body,
      createdAt: update.createdAt,
      sender: { displayName: update.sender.displayName },
    }));
}

function safeSummary(row) {
  return {
    id: row.id,
    reference: row.reference,
    issue: {
      name: row.issue?.name ?? "",
      icon: typeof row.issue?.icon === "string" ? row.issue.icon : null,
    },
    status: row.status,
    submittedAt: row.submittedAt,
    lastUpdateAt:
      typeof row.lastUpdateAt === "string" ? row.lastUpdateAt : null,
    serviceLocation:
      typeof row.serviceLocation === "string" ? row.serviceLocation : null,
  };
}

function usable(row) {
  return (
    typeof row?.id === "string" &&
    typeof row.reference === "string" &&
    typeof row.issue?.name === "string" &&
    typeof row.status === "string" &&
    Number.isFinite(Date.parse(row.submittedAt))
  );
}

export function createMyRequestsRepository({ getAccessToken, client } = {}) {
  const api =
    client ||
    createApiClient({
      baseUrl: readResidentIntakeConfig().apiBaseUrl,
      getAccessToken,
    });
  return {
    async list(page, signal) {
      const data = await api.get(
        `/my/internal-service-requests?page=${encodeURIComponent(String(page))}`,
        { authenticated: true, signal },
      );
      return {
        items: (Array.isArray(data?.items) ? data.items : [])
          .filter(usable)
          .map(safeSummary),
        page: Number.isInteger(data?.page) ? data.page : page,
        hasMore: data?.hasMore === true,
      };
    },
    async detail(id, signal) {
      const data = await api.get(
        `/my/internal-service-requests/${encodeURIComponent(id)}`,
        { authenticated: true, signal },
      );
      if (!usable(data)) throw new Error("unavailable");
      return {
        ...safeSummary(data),
        description: typeof data.description === "string" ? data.description : "",
        updates: safeUpdates(data.updates),
      };
    },
  };
}
