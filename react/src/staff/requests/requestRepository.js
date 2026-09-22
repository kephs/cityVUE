import { createApiClient, CityVueApiError } from "../../api/apiClient.js";
import { readResidentIntakeConfig } from "../../config/runtimeConfig.js";
const root = "/staff/service-requests";
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
function noteProjection(row) {
  if (
    !row ||
    !uuid.test(row.id) ||
    typeof row.body !== "string" ||
    row.body.length > 4000 ||
    typeof row.author?.displayName !== "string" ||
    row.author.displayName.length > 200 ||
    typeof row.createdAt !== "string" ||
    !Number.isFinite(Date.parse(row.createdAt))
  )
    throw invalid();
  return {
    id: row.id,
    body: row.body,
    author: { displayName: row.author.displayName },
    createdAt: row.createdAt,
  };
}
function communicationProjection(row) {
  if (
    !row ||
    row.direction !== "outbound" ||
    row.channel !== "portal" ||
    row.deliveryState !== "recorded" ||
    !uuid.test(row.id) ||
    typeof row.body !== "string" ||
    row.body.length > 4000 ||
    typeof row.author?.displayName !== "string" ||
    row.author.displayName.length > 200 ||
    typeof row.createdAt !== "string" ||
    !Number.isFinite(Date.parse(row.createdAt))
  )
    throw invalid();
  return {
    id: row.id,
    body: row.body,
    direction: row.direction,
    channel: row.channel,
    deliveryState: row.deliveryState,
    author: { displayName: row.author.displayName },
    createdAt: row.createdAt,
  };
}
function targetProjection(value) {
  if (
    !value ||
    !["staff", "role", "group"].includes(value.type) ||
    !uuid.test(value.id) ||
    typeof value.displayName !== "string" ||
    value.displayName.length > 200
  )
    throw invalid();
  return {
    type: value.type,
    id: value.id,
    displayName: value.displayName,
    ...(typeof value.active === "boolean" ? { active: value.active } : {}),
  };
}
function project(row, detail = false) {
  if (
    !row ||
    !uuid.test(row.serviceRequestId) ||
    !["public", "internal"].includes(row.audience) ||
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
    assignment: row.assignment ? targetProjection(row.assignment) : null,
    serviceRequestId: row.serviceRequestId,
    audience: row.audience,
    referenceNumber: row.referenceNumber,
    status: row.status,
    issueName: row.issueName,
    issueIcon: typeof row.issueIcon === "string" ? row.issueIcon : null,
    categoryName:
      typeof row.categoryName === "string" ? row.categoryName : null,
    serviceLocation:
      typeof row.serviceLocation === "string" ? row.serviceLocation : null,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    divisionId: row.divisionId,
    divisionName: row.divisionName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(detail
      ? {
          description: row.description,
          revision: row.revision,
          intakeChannel: ["web", "phone", "walk_in", "staff", "api"].includes(
            row.intakeChannel,
          )
            ? row.intakeChannel
            : null,
          canReadContact: row.canReadContact === true,
          capabilities: {
            workflowActions: Array.isArray(row.capabilities?.workflowActions)
              ? row.capabilities.workflowActions.filter((action) =>
                  ["start_work", "hold", "resume", "close", "reopen"].includes(
                    action,
                  ),
                )
              : [],
            ...Object.fromEntries(
              [
                "canRoute",
                "canAssign",
                "canManageWatchers",
                "canWatchSelf",
                "canReadContact",
                "canReadNotes",
                "canCreateNotes",
                "canReadCommunications",
                "canCreateCommunication",
              ].map((key) => [key, row.capabilities?.[key] === true]),
            ),
          },
        }
      : {}),
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
    async notes(id, cursor, signal) {
      const query = new URLSearchParams({ pageSize: "25" });
      if (cursor) query.set("cursor", cursor);
      const data = await api.get(`${path(id)}/notes?${query}`, options(signal));
      if (
        !Array.isArray(data?.items) ||
        data.items.length > 25 ||
        data.pageSize !== 25 ||
        typeof data.hasMore !== "boolean" ||
        !(
          data.nextCursor === null ||
          (typeof data.nextCursor === "string" &&
            /^[A-Za-z0-9_-]{1,256}$/.test(data.nextCursor))
        ) ||
        data.hasMore !== Boolean(data.nextCursor)
      )
        throw invalid();
      return {
        items: data.items.map(noteProjection),
        hasMore: data.hasMore,
        nextCursor: data.nextCursor,
      };
    },
    async createNote(id, body, submissionKey, signal) {
      if (!uuid.test(submissionKey)) throw invalid();
      return noteProjection(
        await api.post(
          `${path(id)}/notes`,
          { body },
          { ...options(signal), idempotencyKey: submissionKey },
        ),
      );
    },
    async communications(id, cursor, signal) {
      const query = new URLSearchParams({ pageSize: "25" });
      if (cursor) query.set("cursor", cursor);
      const data = await api.get(
        `${path(id)}/communications?${query}`,
        options(signal),
      );
      if (
        !Array.isArray(data?.items) ||
        data.items.length > 25 ||
        data.pageSize !== 25 ||
        typeof data.hasMore !== "boolean" ||
        !(
          data.nextCursor === null ||
          (typeof data.nextCursor === "string" &&
            /^[A-Za-z0-9_-]{1,256}$/.test(data.nextCursor))
        ) ||
        data.hasMore !== Boolean(data.nextCursor)
      )
        throw invalid();
      return {
        items: data.items.map(communicationProjection),
        hasMore: data.hasMore,
        nextCursor: data.nextCursor,
      };
    },
    async createCommunication(id, body, submissionKey, signal) {
      if (!uuid.test(submissionKey)) throw invalid();
      return communicationProjection(
        await api.post(
          `${path(id)}/communications`,
          { body },
          { ...options(signal), idempotencyKey: submissionKey },
        ),
      );
    },
    async contact(id, signal, audience = "internal") {
      path(id);
      if (!["public", "internal"].includes(audience)) throw invalid();
      const data = await api.get(
        `/staff/${audience}-service-requests/${id}/contact`,
        options(signal),
      );
      if (
        !data ||
        !["name", "email"].every(
          (key) => data[key] === null || typeof data[key] === "string",
        ) ||
        (data.name?.length ?? 0) > 200 ||
        (data.email?.length ?? 0) > 320
      )
        throw invalid();
      return { name: data.name, email: data.email };
    },
    async list(filters, signal) {
      const query = new URLSearchParams();
      for (const key of [
        "audience",
        "view",
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
    async activity(id, page, signal, pageSize = 25) {
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new Error("Invalid activity page size");
      const data = await api.get(
        `${path(id)}/activity?page=${page}&pageSize=${pageSize}`,
        options(signal),
      );
      const types = [
        "request_assigned",
        "request_reassigned",
        "request_unassigned",
        "watcher_added",
        "watcher_removed",
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
        data.items.length > pageSize
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
              "fromTargetType",
              "fromTargetName",
              "toTargetType",
              "toTargetName",
            ].map((key) => [key, row[key]]),
          );
        }),
      };
    },
    async targets(id, type, search, signal, purpose = "assignment") {
      const query = new URLSearchParams({ type, search, purpose });
      const data = await api.get(
        `${path(id)}/assignment-targets?${query}`,
        options(signal),
      );
      if (!Array.isArray(data?.items) || data.items.length > 25)
        throw invalid();
      return { items: data.items.map(targetProjection) };
    },
    async watchers(id, signal) {
      const data = await api.get(`${path(id)}/watchers`, options(signal));
      if (
        !Array.isArray(data?.items) ||
        data.items.length > 100 ||
        typeof data.watchingSelf !== "boolean"
      )
        throw invalid();
      return {
        items: data.items.map(targetProjection),
        watchingSelf: data.watchingSelf,
      };
    },
    ...Object.fromEntries(
      Object.entries({
        assign: "assignment",
        unassign: "assignment/remove",
        addWatcher: "watchers",
        removeWatcher: "watchers/remove",
        watchSelf: "watch-self",
        unwatchSelf: "unwatch-self",
      }).map(([name, suffix]) => [
        name,
        (id, input, signal) =>
          api.post(`${path(id)}/${suffix}`, input, options(signal)),
      ]),
    ),
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
        audiences: Array.isArray(data.audiences)
          ? data.audiences.filter((value) =>
              ["public", "internal"].includes(value),
            )
          : [],
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
