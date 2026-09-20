import { createApiClient, CityVueApiError } from "../../api/apiClient.js";
import { readResidentIntakeConfig } from "../../config/runtimeConfig.js";
const root = "/staff/internal-service-requests";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const statusLabels = {
  open: "Open",
  in_progress: "In Progress",
  on_hold: "On Hold",
  closed: "Closed",
  cancelled: "Cancelled",
};
const invalid = () =>
  new CityVueApiError(
    "invalid-response",
    "Request information is unavailable.",
  );
function project(row, detail = false) {
  if (
    !row ||
    !uuid.test(row.serviceRequestId) ||
    row.audience !== "internal" ||
    !Object.hasOwn(statusLabels, row.status) ||
    typeof row.referenceNumber !== "string" ||
    typeof row.issueName !== "string" ||
    typeof row.departmentName !== "string"
  )
    throw invalid();
  if (
    detail &&
    (typeof row.description !== "string" ||
      !Number.isInteger(row.revision) ||
      row.revision < 1)
  )
    throw invalid();
  return {
    serviceRequestId: row.serviceRequestId,
    referenceNumber: row.referenceNumber,
    status: row.status,
    issueName: row.issueName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    divisionId: row.divisionId,
    divisionName: row.divisionName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(detail ? { description: row.description, revision: row.revision } : {}),
  };
}
export function createStaffRequestRepository({ getAccessToken, client } = {}) {
  const api =
    client ||
    createApiClient({
      baseUrl: readResidentIntakeConfig().apiBaseUrl,
      getAccessToken,
    });
  const options = (signal) => ({ authenticated: true, signal });
  const path = (id) => {
    if (!uuid.test(id))
      throw new CityVueApiError("not-found", "This request is unavailable.", {
        status: 404,
      });
    return `${root}/${id}`;
  };
  return {
    async list(filters, signal) {
      const query = new URLSearchParams();
      for (const key of [
        "search",
        "status",
        "departmentId",
        "divisionId",
        "page",
        "pageSize",
      ])
        if (filters[key]) query.set(key, String(filters[key]));
      const data = await api.get(`${root}?${query}`, options(signal));
      if (
        !Array.isArray(data?.items) ||
        !Number.isInteger(data.total) ||
        !Number.isInteger(data.page) ||
        !Number.isInteger(data.pageSize)
      )
        throw invalid();
      return {
        items: data.items.map((row) => project(row)),
        total: data.total,
        page: data.page,
        pageSize: data.pageSize,
        hasNextPage: data.hasNextPage === true,
        hasPreviousPage: data.hasPreviousPage === true,
      };
    },
    async activity(id, page, signal) {
      const data = await api.get(
        `${path(id)}/activity?page=${page}&pageSize=25`,
        options(signal),
      );
      const types = [
        "request_created",
        "work_started",
        "placed_on_hold",
        "work_resumed",
        "request_closed",
        "request_reopened",
        "request_routed",
      ];
      if (
        !Array.isArray(data?.items) ||
        !Number.isInteger(data.page) ||
        data.items.length > 25
      )
        throw invalid();
      return {
        page: data.page,
        hasPreviousPage: data.hasPreviousPage === true,
        hasNextPage: data.hasNextPage === true,
        items: data.items.map((row) => {
          if (
            !uuid.test(row.id) ||
            !types.includes(row.type) ||
            !["Staff member", "System", "Resident"].includes(
              row.actorDisplay,
            ) ||
            typeof row.occurredAt !== "string" ||
            (row.narrative !== null && typeof row.narrative !== "string")
          )
            throw invalid();
          return Object.fromEntries(
            [
              "id",
              "type",
              "occurredAt",
              "actorDisplay",
              "fromStatus",
              "toStatus",
              "fromDepartment",
              "fromDivision",
              "toDepartment",
              "toDivision",
              "narrative",
              "intakeChannel",
            ].map((key) => [key, row[key]]),
          );
        }),
      };
    },
    async detail(id, signal) {
      return project(await api.get(path(id), options(signal)), true);
    },
    async options(signal) {
      const data = await api.get(`${root}/workspace-options`, options(signal));
      if (
        !Array.isArray(data?.departments) ||
        !Array.isArray(data?.divisions) ||
        data.departments.some(
          (d) => !uuid.test(d.id) || typeof d.name !== "string",
        ) ||
        data.divisions.some(
          (d) =>
            !uuid.test(d.id) ||
            !uuid.test(d.departmentId) ||
            typeof d.name !== "string",
        )
      )
        throw invalid();
      return {
        canUpdate: data.canUpdate === true,
        departments: data.departments.map(({ id, name }) => ({ id, name })),
        divisions: data.divisions.map(({ id, name, departmentId }) => ({
          id,
          name,
          departmentId,
        })),
      };
    },
    workflow(id, input, signal) {
      return api.post(`${path(id)}/workflow`, input, options(signal));
    },
    route(id, input, signal) {
      return api.post(`${path(id)}/routing`, input, options(signal));
    },
  };
}
export function workspaceError(error) {
  if (error?.status === 401)
    return "Your staff session has expired. Please sign in again.";
  if (error?.status === 403)
    return "You do not have permission to access or update these requests.";
  if (error?.status === 404)
    return "This request is unavailable or outside your access.";
  if (error?.status === 400)
    return "The request information is not valid. Review your selection and try again.";
  if (error?.status === 409)
    return "This request changed. Reload the latest information before trying again.";
  return "Requests are temporarily unavailable. Please try again.";
}
