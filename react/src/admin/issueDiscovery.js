export const issueQueryDefaults = {
  search: "",
  status: "all",
  category: "",
  requesterPolicy: "all",
  assignmentState: "all",
  sort: "default",
  direction: "asc",
  page: "1",
  pageSize: "25",
};
export function readIssueQuery(params) {
  const result = { ...issueQueryDefaults };
  const allowed = {
    status: ["all", "active", "inactive"],
    requesterPolicy: ["all", "IDENTIFIED_REQUIRED", "ANONYMOUS_ALLOWED"],
    assignmentState: ["all", "assigned", "none"],
    sort: [
      "default",
      "name",
      "category",
      "order",
      "status",
      "policy",
      "assignment",
    ],
    direction: ["asc", "desc"],
    pageSize: ["25", "50", "100", "250", "500"],
  };
  for (const [key, values] of Object.entries(allowed)) {
    if (values.includes(params.get(key))) result[key] = params.get(key);
  }
  const page = params.get("page");
  if (/^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page)))
    result.page = page;
  const category = params.get("category") || "";
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      category,
    )
  )
    result.category = category;
  const search = (params.get("search") || "").trim();
  if (search.length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/u.test(search))
    result.search = search;
  return result;
}
export function issueQueryParams(query) {
  return new URLSearchParams(
    Object.entries(query).filter(
      ([key, value]) => value !== issueQueryDefaults[key],
    ),
  );
}
