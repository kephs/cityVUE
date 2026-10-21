import { expect, test, vi } from "vitest";
import {
  createDepartmentReader,
  departmentReadQuery,
} from "../src/admin/departmentReader.js";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const record = {
  id,
  name: "Synthetic department",
  description: null,
  status: "active",
  displayOrder: 0,
  divisionCount: 1,
  categoryCount: 2,
};
const page = (items = [record], extra = {}) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...extra,
});
test("department adapter uses authenticated GET, exact paths, encoded literal query and caller signal", async () => {
  const controller = new AbortController();
  const client = { get: vi.fn().mockResolvedValue(page()) };
  const reader = createDepartmentReader(client);
  await reader.departments(
    { search: "%_\\ &+", status: "archived", sort: "name", direction: "desc" },
    controller.signal,
  );
  const [path, options] = client.get.mock.calls[0];
  expect(path.startsWith("/admin/departments?")).toBe(true);
  expect(Object.fromEntries(new URLSearchParams(path.split("?")[1]))).toEqual({
    page: "1",
    pageSize: "25",
    search: "%_\\ &+",
    status: "archived",
    sort: "name",
    direction: "desc",
  });
  expect(options).toEqual({ authenticated: true, signal: controller.signal });
  client.get.mockResolvedValue(record);
  expect(await reader.detail(id, controller.signal)).toEqual(record);
  expect(client.get).toHaveBeenLastCalledWith(
    `/admin/departments/${id}`,
    options,
  );
  for (const kind of ["divisions", "categories"]) {
    const { divisionCount, categoryCount, ...base } = record;
    const item = {
      ...base,
      departmentId: id,
      ...(kind === "categories"
        ? { divisionId: null, iconKey: "tree", serviceDefinitionCount: 3 }
        : {}),
    };
    client.get.mockResolvedValue(page([item]));
    expect((await reader[kind](id, {}, controller.signal)).items[0]).toEqual(
      item,
    );
    expect(client.get.mock.lastCall[0]).toMatch(
      `/admin/departments/${id}/${kind}?`,
    );
    expect(client.get.mock.lastCall[1]).toEqual(options);
  }
  expect(Object.keys(reader).sort()).toEqual([
    "categories",
    "departments",
    "detail",
    "divisions",
  ]);
});
test("server totals and bounded empty pages are retained", async () => {
  const reader = createDepartmentReader({
    get: vi
      .fn()
      .mockResolvedValue(page([], { total: 26, page: 3, pageSize: 25 })),
  });
  expect(await reader.departments({ page: 3 })).toEqual(
    page([], { total: 26, page: 3, pageSize: 25 }),
  );
});
for (const [label, patch] of Object.entries({
  wrongTotal: { total: -1 },
  wrongPage: { page: 2 },
  wrongPageSize: { pageSize: 100 },
  missingItems: { items: null },
  inconsistent: { total: 0 },
  extraPayload: { secret: "unexpected" },
  duplicate: { items: [record, record], total: 2 },
})) {
  test("rejects invalid page: " + label, async () => {
    await expect(
      createDepartmentReader({
        get: async () => page([record], patch),
      }).departments(),
    ).rejects.toThrow();
  });
}
for (const [label, patch] of Object.entries({
  id: { id: "../other" },
  name: { name: null },
  description: { description: {} },
  status: { status: "deleted" },
  order: { displayOrder: 0.5 },
  count: { categoryCount: "2" },
  payload: { versionPayload: { hidden: true } },
})) {
  test("rejects malformed record: " + label, async () => {
    await expect(
      createDepartmentReader({
        get: async () => ({ ...record, ...patch }),
      }).detail(id),
    ).rejects.toThrow();
  });
}
test("refuses mismatched detail and relationship parent identities", async () => {
  await expect(
    createDepartmentReader({
      get: async () => ({ ...record, id: other }),
    }).detail(id),
  ).rejects.toThrow();
  const { divisionCount, categoryCount, ...base } = record;
  await expect(
    createDepartmentReader({
      get: async () => page([{ ...base, departmentId: other }]),
    }).divisions(id),
  ).rejects.toThrow();
});
for (const query of [
  { organizationId: id },
  { page: 0 },
  { page: 10001 },
  { pageSize: 15 },
  { status: "deleted" },
  { sort: "sql" },
  { direction: "sideways" },
  { search: "\n" },
  { search: "a".repeat(101) },
]) {
  test("rejects unsupported query " + JSON.stringify(query), () =>
    expect(() => departmentReadQuery(query)).toThrow(),
  );
}
test("preserves HTTP refusal and cancellation for safe UI mapping", async () => {
  for (const status of [401, 403, 404, 500]) {
    const error = { status };
    await expect(
      createDepartmentReader({
        get: async () => {
          throw error;
        },
      }).departments(),
    ).rejects.toBe(error);
  }
  const signal = AbortSignal.abort();
  const client = { get: vi.fn().mockRejectedValue({ code: "cancelled" }) };
  await expect(
    createDepartmentReader(client).departments({}, signal),
  ).rejects.toEqual({ code: "cancelled" });
  expect(client.get.mock.lastCall[1].signal).toBe(signal);
});

test("nullable and malformed Category projections are validated without payload leakage", async () => {
  const { divisionCount, categoryCount, ...base } = record;
  const category = {
    ...base,
    departmentId: id,
    divisionId: other,
    iconKey: "tree",
    serviceDefinitionCount: 0,
  };
  const client = { get: vi.fn().mockResolvedValue(page([category])) };
  expect(
    (await createDepartmentReader(client).categories(id)).items[0].divisionId,
  ).toBe(other);
  for (const patch of [
    { divisionId: 7 },
    { divisionId: "not-a-uuid" },
    { serviceDefinitionCount: -1 },
    { iconKey: null },
  ]) {
    client.get.mockResolvedValue(page([{ ...category, ...patch }]));
    await expect(
      createDepartmentReader(client).categories(id),
    ).rejects.toThrow();
  }
  expect(() => departmentReadQuery({ search: "\ud800" })).toThrow();
});
