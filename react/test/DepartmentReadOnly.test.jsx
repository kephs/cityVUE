import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import { AdminConfiguration } from "../src/admin/AdminConfigurationPage.jsx";
import DepartmentReadOnly from "../src/admin/DepartmentReadOnly.jsx";
import DepartmentWorkspace, {
  departmentReadEnabled,
} from "../src/admin/DepartmentWorkspace.jsx";
const id = "00000000-0000-4000-8000-000000000001";
const record = {
  id,
  name: "Synthetic Works",
  description: null,
  status: "active",
  displayOrder: 2,
  divisionCount: 1,
  categoryCount: 1,
};
const page = (items = [], pageNumber = 1, total = items.length) => ({
  items,
  total,
  page: pageNumber,
  pageSize: 25,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function clientFor(overrides = {}) {
  return {
    get: vi.fn(async (path) => {
      const [route, qs] = path.split("?");
      const params = new URLSearchParams(qs);
      const n = Number(params.get("page") || 1);
      if (route.endsWith("/divisions")) return page([], n);
      if (route.endsWith("/categories")) return page([], n);
      if (route.endsWith("/" + id)) return { ...record };
      return page([{ ...record }], n);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}
afterEach(() => vi.unstubAllEnvs());
test("development feature gate is off by default and impossible in a production build", () => {
  expect(departmentReadEnabled({ DEV: true })).toBe(false);
  expect(
    departmentReadEnabled({ DEV: false, VITE_DEPARTMENT_READ_ENABLED: "true" }),
  ).toBe(false);
  expect(
    departmentReadEnabled({ DEV: true, VITE_DEPARTMENT_READ_ENABLED: "false" }),
  ).toBe(false);
  expect(
    departmentReadEnabled({ DEV: true, VITE_DEPARTMENT_READ_ENABLED: "true" }),
  ).toBe(true);
});
test("fictional mode receives no client records and performs no API request", async () => {
  vi.stubEnv("VITE_DEPARTMENT_READ_ENABLED", "false");
  const client = clientFor();
  render(<DepartmentWorkspace client={client} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Open fictional preview" }),
  );
  expect(screen.queryByText(record.name)).not.toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalled();
});
test("live hierarchy uses the existing client only after configuration authorization", async () => {
  vi.stubEnv("VITE_DEPARTMENT_READ_ENABLED", "true");
  const client = clientFor();
  const get = client.get;
  client.get = vi.fn((path, options) =>
    path.startsWith("/admin/configuration?")
      ? Promise.resolve({ branding: null, capabilities: {} })
      : get(path, options),
  );
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/admin/departments"]}>
        <Routes>
          <Route
            path="/admin/:section"
            element={<AdminConfiguration client={client} />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
  await screen.findByText(record.name);
  expect(client.get.mock.calls[0][0]).toContain("/admin/configuration?");
  for (const [, options] of client.get.mock.calls)
    expect(options.authenticated).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Open fictional preview" }),
  ).not.toBeInTheDocument();
});
test("live data, read-only boundary, authoritative details and optional relationships", async () => {
  const client = clientFor();
  const get = client.get;
  client.get = vi.fn((path, options) =>
    path.includes("/categories?")
      ? Promise.resolve(
          page([
            {
              id: "00000000-0000-4000-8000-000000000002",
              name: "Synthetic Category",
              description: null,
              status: "archived",
              displayOrder: 1,
              departmentId: id,
              divisionId: null,
              iconKey: "tree",
              serviceDefinitionCount: 7,
            },
          ]),
        )
      : get(path, options),
  );
  const user = userEvent.setup();
  render(<DepartmentReadOnly client={client} />);
  await screen.findByText(record.name);
  expect(
    screen.getByText(/server total for the current filters/),
  ).toBeInTheDocument();
  const open = screen.getByRole("button", { name: "View " + record.name });
  open.focus();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Synthetic Category");
  expect(
    within(dialog).getByText("Directly under this Department; no Division."),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("7 service definitions")).toBeInTheDocument();
  expect(
    within(dialog).getByText(/not counts of published resident services/),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("heading", { name: "Department details" }),
  ).toHaveFocus();
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(open).toHaveFocus();
  for (const method of ["post", "patch", "put", "remove"])
    expect(client[method]).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /save|create|edit|delete/i }),
  ).not.toBeInTheDocument();
});
test("search, status, sorting and direction go to the server; page changes do not filter one page locally", async () => {
  const client = clientFor({
    get: vi.fn(async (path) => {
      const q = new URLSearchParams(path.split("?")[1]);
      return page([], Number(q.get("page")), 0);
    }),
  });
  const user = userEvent.setup();
  render(<DepartmentReadOnly client={client} />);
  await screen.findByText(/No Departments on this page/);
  await user.type(screen.getByLabelText("Search Departments"), "%_\\");
  await user.click(screen.getByRole("button", { name: "Search", exact: true }));
  await waitFor(() =>
    expect(
      new URLSearchParams(client.get.mock.lastCall[0].split("?")[1]).get(
        "search",
      ),
    ).toBe("%_\\"),
  );
  await user.selectOptions(screen.getByLabelText("Status"), "inactive");
  await user.selectOptions(screen.getByLabelText("Sort by"), "name");
  await user.selectOptions(screen.getByLabelText("Direction"), "desc");
  await waitFor(() =>
    expect(
      Object.fromEntries(
        new URLSearchParams(client.get.mock.lastCall[0].split("?")[1]),
      ),
    ).toMatchObject({
      page: "1",
      status: "inactive",
      sort: "name",
      direction: "desc",
    }),
  );
});
test("directory and relationships use independent bounded server pages", async () => {
  const records = Array.from({ length: 25 }, (_, i) => ({
    ...record,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    name: `Item ${i}`,
  }));
  const client = clientFor({
    get: vi.fn(async (path) => {
      const [route, qs] = path.split("?"),
        n = Number(new URLSearchParams(qs).get("page") || 1);
      if (route.endsWith("/" + id)) return record;
      if (route.endsWith("/categories")) return page([], n, 0);
      if (route.endsWith("/divisions"))
        return page(
          n === 1
            ? records.map(({ divisionCount, categoryCount, ...item }) => ({
                ...item,
                departmentId: id,
              }))
            : [
                {
                  id: record.id,
                  name: "Second Division page",
                  description: null,
                  status: "active",
                  displayOrder: 0,
                  departmentId: id,
                },
              ],
          n,
          26,
        );
      return page(
        n === 1
          ? records
          : [
              {
                ...record,
                id: "00000000-0000-4000-8000-000000000099",
                name: "Last page",
              },
            ],
        n,
        26,
      );
    }),
  });
  render(<DepartmentReadOnly client={client} />);
  await screen.findByText("Item 0");
  await userEvent.click(
    screen.getByRole("button", { name: "Next Departments" }),
  );
  await screen.findByText("Last page");
  expect(screen.queryByText("Item 0")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Previous Departments" }),
  );
  await screen.findByText("Item 0");
  await userEvent.click(screen.getByRole("button", { name: "View Item 0" }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("Item 24");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Next Divisions" }),
  );
  await within(dialog).findByText("Second Division page");
  expect(
    within(dialog).getByRole("button", { name: "Next Divisions" }),
  ).toBeDisabled();
  expect(
    client.get.mock.calls.filter(([path]) => path.includes("/divisions?")),
  ).toHaveLength(2);
});
test("late responses cannot replace a newer result, and obsolete requests are aborted", async () => {
  const old = deferred(),
    fresh = deferred();
  const client = clientFor({
    get: vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise),
  });
  render(<DepartmentReadOnly client={client} />);
  await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1));
  await userEvent.selectOptions(screen.getByLabelText("Status"), "archived");
  await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
  expect(client.get.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () =>
    fresh.resolve(page([{ ...record, name: "New result" }])),
  );
  await screen.findByText("New result");
  await act(async () => old.resolve(page([{ ...record, name: "Old result" }])));
  expect(screen.queryByText("Old result")).not.toBeInTheDocument();
});
for (const change of ["client", "user"])
  test(
    change + " change removes directory and open details synchronously",
    async () => {
      const first = clientFor(),
        pending = deferred(),
        second = clientFor({ get: vi.fn(() => pending.promise) });
      const context = {};
      const view = render(
        <DepartmentReadOnly client={first} authorizationContext={context} />,
      );
      await screen.findByText(record.name);
      await userEvent.click(
        screen.getByRole("button", { name: "View " + record.name }),
      );
      await within(screen.getByRole("dialog")).findByText(record.name);
      if (change === "user")
        first.get.mockImplementation(() => pending.promise);
      view.rerender(
        <DepartmentReadOnly
          client={change === "client" ? second : first}
          authorizationContext={change === "user" ? {} : context}
        />,
      );
      expect(screen.queryByText(record.name)).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "Loading authorized Departments",
        ),
      );
    },
  );
for (const status of [401, 403])
  test(
    status + " from a relationship clears all records without preview fallback",
    async () => {
      const client = clientFor();
      render(<DepartmentReadOnly client={client} />);
      await screen.findByText(record.name);
      client.get.mockRejectedValue({ status, message: "private diagnostic" });
      await userEvent.click(
        screen.getByRole("button", { name: "View " + record.name }),
      );
      await screen.findByRole("alert");
      expect(screen.queryByText(record.name)).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open fictional preview" }),
      ).not.toBeInTheDocument();
    },
  );
test("404 details are safe and network retry never uses fictional data", async () => {
  const client = clientFor();
  client.get.mockRejectedValueOnce(new Error("private server detail"));
  render(<DepartmentReadOnly client={client} />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(record.name);
  client.get.mockRejectedValue({ status: 404 });
  await userEvent.click(
    screen.getByRole("button", { name: "View " + record.name }),
  );
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "unavailable or no longer accessible",
  );
  expect(within(dialog).queryByText(record.name)).not.toBeInTheDocument();
});
test("reauthorization unmounts tenant data and never substitutes the fictional preview", async () => {
  vi.stubEnv("VITE_DEPARTMENT_READ_ENABLED", "true");
  const client = clientFor();
  const view = render(<DepartmentWorkspace client={client} />);
  await screen.findByText(record.name);
  view.rerender(
    <DepartmentWorkspace client={client} authorizationReady={false} />,
  );
  expect(screen.queryByText(record.name)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "renewed staff authentication",
  );
  expect(
    screen.queryByRole("button", { name: "Open fictional preview" }),
  ).not.toBeInTheDocument();
});

test("switching selected Department aborts pending details; a late response cannot reopen it", async () => {
  const pending = deferred();
  const client = clientFor();
  render(<DepartmentReadOnly client={client} />);
  await screen.findByText(record.name);
  client.get.mockImplementation(() => pending.promise);
  await userEvent.click(
    screen.getByRole("button", { name: "View " + record.name }),
  );
  await waitFor(() => expect(client.get).toHaveBeenCalledTimes(4));
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Close configuration",
    }),
  );
  for (const [, options] of client.get.mock.calls.slice(1))
    expect(options.signal.aborted).toBe(true);
  await act(async () => pending.resolve(record));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("a late denial from an old user cannot clear the newly authorized user", async () => {
  const pending = deferred(),
    first = clientFor({ get: vi.fn(() => pending.promise) }),
    second = clientFor();
  const view = render(<DepartmentReadOnly client={first} />);
  await waitFor(() => expect(first.get).toHaveBeenCalled());
  view.rerender(<DepartmentReadOnly client={second} />);
  await screen.findByText(record.name);
  await act(async () => pending.reject({ status: 403 }));
  expect(screen.getByText(record.name)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
test("retry after denial mounts a new directory without retaining prior details", async () => {
  const client = clientFor({
    get: vi
      .fn()
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValue(page([record])),
  });
  render(<DepartmentReadOnly client={client} />);
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(record.name);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("production and default gates cannot issue Department GETs even with a client", () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_DEPARTMENT_READ_ENABLED", "true");
  const client = clientFor();
  render(<DepartmentWorkspace client={client} />);
  expect(
    screen.getByRole("button", { name: "Open fictional preview" }),
  ).toBeInTheDocument();
  expect(client.get).not.toHaveBeenCalled();
});

test("Category pagination retains nullable Division IDs without fabricating relationship names", async () => {
  const categories = Array.from({ length: 25 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
    name: `Category ${i}`,
    description: null,
    status: "active",
    displayOrder: 0,
    departmentId: id,
    divisionId: null,
    iconKey: "tree",
    serviceDefinitionCount: 0,
  }));
  const client = clientFor();
  const get = client.get;
  client.get = vi.fn((path, options) => {
    if (!path.includes("/categories?")) return get(path, options);
    const n = Number(new URLSearchParams(path.split("?")[1]).get("page"));
    return Promise.resolve(
      page(
        n === 1 ? categories : [{ ...categories[0], name: "Last Category" }],
        n,
        26,
      ),
    );
  });
  render(<DepartmentReadOnly client={client} />);
  await screen.findByText(record.name);
  await userEvent.click(
    screen.getByRole("button", { name: "View " + record.name }),
  );
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("Category 24");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Next Issue Categories" }),
  );
  await within(dialog).findByText("Last Category");
  expect(within(dialog).queryByText("Category 24")).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Next Issue Categories" }),
  ).toBeDisabled();
  const paths = client.get.mock.calls.map(([path]) => path);
  expect(
    paths.filter((path) => path.includes("/categories?")).at(-1),
  ).toContain("page=2");
  expect(paths.filter((path) => path.includes("/divisions?")).at(-1)).toContain(
    "page=1",
  );
});

test("live responsive styles retain single-column layout, wrapping and minimum touch targets", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile("react/src/admin/departmentReadOnly.css", "utf8");
  const shared = await readFile(
    "react/src/admin/departmentsConfiguration.css",
    "utf8",
  );
  expect(css).toContain("@media (max-width: 767.98px)");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(css).toContain("overflow-wrap: anywhere");
  expect(css).toContain("min-height: 44px");
  expect(shared).toContain("min-width: 44px");
  expect(shared).toContain(":focus-visible");
});

for (const method of ["Escape", "Close"])
  test(`restores the keyboard opener after dialog removal using ${method}`, async () => {
    render(<DepartmentReadOnly client={clientFor()} />);
    const opener = await screen.findByRole("button", {
      name: "View " + record.name,
    });
    opener.focus();
    await userEvent.keyboard("{Enter}");
    await within(screen.getByRole("dialog")).findByText(record.name);
    const focus = vi.spyOn(opener, "focus").mockImplementation(() => {
      expect(document.querySelector("dialog")).toBeNull();
      HTMLElement.prototype.focus.call(opener);
    });
    if (method === "Escape")
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { bubbles: false, cancelable: true }),
      );
    else
      await userEvent.click(
        screen.getByRole("button", { name: "Close configuration" }),
      );
    await waitFor(() => expect(opener).toHaveFocus());
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
    await userEvent.tab();
    expect(opener).not.toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

test("restores the directory heading when a refreshed page removes the opener", async () => {
  const client = clientFor();
  render(<DepartmentReadOnly client={client} />);
  const opener = await screen.findByRole("button", {
    name: "View " + record.name,
  });
  await userEvent.click(opener);
  await within(screen.getByRole("dialog")).findByText(record.name);
  client.get.mockResolvedValue(page([]));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Departments" }));
  await waitFor(() => expect(opener.isConnected).toBe(false));
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: false, cancelable: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Department directory" }),
    ).toHaveFocus(),
  );
});

for (const change of ["replacement", "revocation"])
  test(`does not restore focus to the old opener after authorization ${change}`, async () => {
    vi.stubEnv("VITE_DEPARTMENT_READ_ENABLED", "true");
    const client = clientFor();
    const context = {};
    const view = render(
      <DepartmentWorkspace client={client} authorizationContext={context} />,
    );
    const opener = await screen.findByRole("button", {
      name: "View " + record.name,
    });
    await userEvent.click(opener);
    await within(screen.getByRole("dialog")).findByText(record.name);
    const focus = vi.spyOn(opener, "focus");
    view.rerender(
      <DepartmentWorkspace
        client={client}
        authorizationContext={change === "replacement" ? {} : context}
        authorizationReady={change !== "revocation"}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener.isConnected).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
