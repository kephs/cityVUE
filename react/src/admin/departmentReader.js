const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = ["active", "inactive", "archived"];
const invalid = () => new Error("Department response or query is invalid.");
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) throw invalid();
  return value;
}
function shape(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw invalid();
}
function record(value, kind, parent) {
  const base = ["id", "name", "description", "status", "displayOrder"];
  const extra =
    kind === "departments"
      ? ["divisionCount", "categoryCount"]
      : kind === "divisions"
        ? ["departmentId"]
        : ["departmentId", "divisionId", "iconKey", "serviceDefinitionCount"];
  shape(value, [...base, ...extra]);
  id(value.id);
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !(value.description === null || typeof value.description === "string") ||
    !statuses.includes(value.status) ||
    !integer(value.displayOrder, Number.MIN_SAFE_INTEGER)
  )
    throw invalid();
  if (kind === "departments") {
    if (!integer(value.divisionCount) || !integer(value.categoryCount))
      throw invalid();
  } else {
    if (id(value.departmentId) !== parent) throw invalid();
    if (
      kind === "categories" &&
      (!(
        value.divisionId === null ||
        (typeof value.divisionId === "string" && uuid.test(value.divisionId))
      ) ||
        typeof value.iconKey !== "string" ||
        !integer(value.serviceDefinitionCount))
    )
      throw invalid();
  }
  return Object.fromEntries(
    [...base, ...extra].map((key) => [key, value[key]]),
  );
}
export function departmentReadQuery(input = {}) {
  if (
    Object.keys(input).some(
      (key) =>
        !["page", "pageSize", "search", "status", "sort", "direction"].includes(
          key,
        ),
    )
  )
    throw invalid();
  const query = {
    page: 1,
    pageSize: 25,
    search: "",
    status: "all",
    sort: "displayOrder",
    direction: "asc",
    ...input,
  };
  if (
    !integer(query.page, 1) ||
    query.page > 10000 ||
    ![10, 25, 50, 100].includes(query.pageSize) ||
    typeof query.search !== "string" ||
    query.search.length > 100 ||
    Array.from(query.search).some(
      (c) =>
        c.length === 1 &&
        c.charCodeAt(0) >= 0xd800 &&
        c.charCodeAt(0) <= 0xdfff,
    ) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(query.search) ||
    !["all", ...statuses].includes(query.status) ||
    !["name", "displayOrder", "status"].includes(query.sort) ||
    !["asc", "desc"].includes(query.direction)
  )
    throw invalid();
  return query;
}
function page(value, kind, parent, query) {
  shape(value, ["items", "total", "page", "pageSize"]);
  if (
    !Array.isArray(value.items) ||
    !integer(value.total) ||
    value.page !== query.page ||
    value.pageSize !== query.pageSize ||
    value.items.length !==
      Math.min(
        query.pageSize,
        Math.max(0, value.total - (query.page - 1) * query.pageSize),
      )
  )
    throw invalid();
  const items = value.items.map((item) => record(item, kind, parent));
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw invalid();
  return {
    items,
    total: value.total,
    page: value.page,
    pageSize: value.pageSize,
  };
}
/** GET-only adapter. The server derives Organization authority from the staff identity. */
export function createDepartmentReader(client) {
  async function list(kind, parent, input, signal) {
    const query = departmentReadQuery(input);
    const path =
      kind === "departments"
        ? "/admin/departments"
        : `/admin/departments/${id(parent)}/${kind}`;
    const data = await client.get(`${path}?${new URLSearchParams(query)}`, {
      authenticated: true,
      signal,
    });
    return page(data, kind, parent, query);
  }
  return {
    departments: (query, signal) => list("departments", null, query, signal),
    divisions: (parent, query, signal) =>
      list("divisions", parent, query, signal),
    categories: (parent, query, signal) =>
      list("categories", parent, query, signal),
    detail: async (departmentId, signal) => {
      const data = record(
        await client.get(`/admin/departments/${id(departmentId)}`, {
          authenticated: true,
          signal,
        }),
        "departments",
      );
      if (data.id !== departmentId) throw invalid();
      return data;
    },
  };
}
export function departmentReadError(error) {
  if (error?.status === 401)
    return "Your staff session has expired. Sign in again to view Departments.";
  if (error?.status === 403) return "Department access is not authorized.";
  if (error?.status === 404)
    return "This Department is unavailable or no longer accessible.";
  return "Department data could not be loaded. Please retry.";
}
