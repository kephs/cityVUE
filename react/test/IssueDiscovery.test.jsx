import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import IssueConfiguration from "../src/admin/IssueConfiguration.jsx";
import IssueTemplatePicker from "../src/admin/IssueTemplatePicker.jsx";
const issue = {
  id: "fixture",
  name: "Fixture Issue",
  category: "Roads",
  active: true,
  availability: "INTERNAL_AND_EXTERNAL",
  displayOrder: 0,
  requesterPolicy: "IDENTIFIED_REQUIRED",
  assignmentLabel: null,
};
const page = (items = [issue], extra = {}) => ({
  items,
  total: items.length,
  organizationTotal: 1,
  active: 1,
  inactive: 0,
  page: 1,
  pageSize: 25,
  canWrite: true,
  ...extra,
});

test("F056.5 polish numbers authoritative pages and renumbers sorted/filtered results without new API fields", async () => {
  const second = { ...issue, id: "second", name: "Second fixture" };
  const { user, client } = view(async (url) => {
    const q = new URLSearchParams(url.split("?")[1]);
    return page(
      q.has("status")
        ? [second]
        : q.get("sort") === "name"
          ? [second, issue]
          : [issue, second],
      {
        page: Number(q.get("page") || 1),
        total: 50,
        organizationTotal: 50,
      },
    );
  }, "/admin/issues?page=2");
  await screen.findByText(issue.name);
  expect(
    screen.getByRole("columnheader", { name: "Result Number" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("row", { name: issue.name }).cells[0],
  ).toHaveTextContent("26");
  expect(
    screen.getByRole("row", { name: second.name }).cells[0],
  ).toHaveTextContent("27");
  await user.selectOptions(screen.getByLabelText("Sort By"), "name");
  await waitFor(() =>
    expect(
      screen.getByRole("row", { name: second.name }).cells[0],
    ).toHaveTextContent(/^1$/),
  );
  expect(
    screen.getByRole("row", { name: issue.name }).cells[0],
  ).toHaveTextContent(/^2$/);
  await user.selectOptions(screen.getByLabelText("Status"), "active");
  await waitFor(() =>
    expect(
      screen.queryByRole("row", { name: issue.name }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("row", { name: second.name }).cells[0],
  ).toHaveTextContent(/^1$/);
  expect(
    client.get.mock.calls.every(
      ([url]) =>
        url.startsWith("/admin/issues/summaries?") ||
        url === "/admin/issues/categories",
    ),
  ).toBe(true);
});

test("F056.5 polish keeps clear actions secondary and empty search disabled", async () => {
  view(async () => page());
  await screen.findByText(issue.name);
  for (const name of ["Clear Filters", "Clear Search"]) {
    expect(screen.getByRole("button", { name, exact: true })).toHaveClass(
      "btn-outline-secondary",
    );
    expect(screen.getByRole("button", { name, exact: true })).not.toHaveClass(
      "btn-primary",
      "btn-link",
    );
  }
  expect(screen.getByRole("button", { name: "Clear Search" })).toBeDisabled();
});
function Location() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <>
      <output data-testid="query">{location.search}</output>
      <button onClick={() => navigate(-1)}>Browser Back</button>
      <button onClick={() => navigate(1)}>Browser Forward</button>
    </>
  );
}
function view(get, entry = "/admin/issues") {
  const client = {
      get: vi.fn((url, options) =>
        url === "/admin/issues/categories"
          ? Promise.resolve({ items: [] })
          : get(url, options),
      ),
      patch: vi.fn(),
      post: vi.fn(),
    },
    onDenied = vi.fn();
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Location />
      <IssueConfiguration client={client} onDenied={onDenied} />
    </MemoryRouter>,
  );
  return { client, onDenied, user: userEvent.setup() };
}
test("F056.1 filters, page size, sort and trimmed live search persist in URL; Back and Forward restore state", async () => {
  const { user, client } = view(async () => page());
  await screen.findByText(issue.name);
  await user.selectOptions(screen.getByLabelText("Rows per page"), "500");
  await user.selectOptions(screen.getByLabelText("Status"), "inactive");
  await user.selectOptions(screen.getByLabelText("Sort By"), "name");
  await user.type(screen.getByLabelText("Search Issues"), "  café  ");
  await waitFor(() =>
    expect(screen.getByTestId("query")).toHaveTextContent("search=caf%C3%A9"),
  );
  expect(screen.getByTestId("query")).toHaveTextContent("pageSize=500");
  await user.click(screen.getByText("Browser Back"));
  await waitFor(() =>
    expect(screen.getByLabelText("Search Issues")).toHaveValue(""),
  );
  await user.click(screen.getByText("Browser Forward"));
  await waitFor(() =>
    expect(screen.getByLabelText("Search Issues")).toHaveValue("café"),
  );
  await user.click(
    screen.getByRole("button", { name: "Clear Filters", exact: true }),
  );
  expect(screen.getByTestId("query")).toHaveTextContent(
    "?sort=name&pageSize=500",
  );
  expect(client.patch).not.toHaveBeenCalled();
  expect(client.post).not.toHaveBeenCalled();
});
test("F056.1 malformed URL normalizes safely before requests", async () => {
  const { client } = view(
    async () => page(),
    "/admin/issues?page=-2&pageSize=10000&sort=forged&organizationId=foreign",
  );
  await screen.findByText(issue.name);
  expect(screen.getByTestId("query")).toHaveTextContent("");
  expect(client.get).toHaveBeenCalledWith(
    "/admin/issues/summaries?",
    expect.anything(),
  );
});

test("F056.5 filters precede search; page size belongs to pagination; Clear Search retains filters", async () => {
  const { user } = view(
    async () => page(),
    "/admin/issues?search=sign&status=inactive&pageSize=100&sort=name&direction=desc",
  );
  await screen.findByText(issue.name);
  const filters = screen.getByRole("group", { name: "Find Issues" });
  const search = screen.getByRole("group", { name: "Search Issues" });
  expect(
    filters.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    within(filters).queryByLabelText("Rows per page"),
  ).not.toBeInTheDocument();
  const sizes = within(
    screen.getByRole("navigation", { name: "Issue pages" }),
  ).getByLabelText("Rows per page");
  expect(
    within(sizes)
      .getAllByRole("option")
      .map((option) => option.value),
  ).toEqual(["25", "50", "100", "250", "500"]);
  await user.click(screen.getByRole("button", { name: "Clear Search" }));
  await waitFor(() =>
    expect(screen.getByTestId("query")).not.toHaveTextContent("search="),
  );
  for (const value of [
    "status=inactive",
    "pageSize=100",
    "sort=name",
    "direction=desc",
  ])
    expect(screen.getByTestId("query")).toHaveTextContent(value);
});

test.each([401, 403])(
  "F056.5 detail denial %s clears configuration without a mutation",
  async (status) => {
    const { user, onDenied, client } = view(async (url) => {
      if (url.includes("summaries?")) return page();
      throw { status };
    });
    await screen.findByText(issue.name);
    await user.click(
      screen.getByRole("button", { name: "Configure Fixture Issue" }),
    );
    await waitFor(() => expect(onDenied).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(issue.name)).not.toBeInTheDocument();
    expect(client.patch).not.toHaveBeenCalled();
  },
);

test("F056.5 save supersedes a pending history-navigation list response", async () => {
  let requests = 0,
    late;
  const { user, client } = view(async (url) => {
    if (url.includes("summaries?")) {
      requests++;
      if (requests === 3)
        return new Promise((resolve) => {
          late = resolve;
        });
      return page();
    }
    if (url.includes("assignment-targets")) return { items: [] };
    return {
      issue: {
        ...issue,
        description: "",
        questions: [],
        coreRevision: 1,
        actionRevision: 1,
        policyRevision: 1,
        assignmentRevision: 1,
      },
    };
  });
  client.patch.mockResolvedValue({ issue, changed: true });
  await screen.findByText(issue.name);
  await user.selectOptions(screen.getByLabelText("Status"), "active");
  await screen.findByText(issue.name);
  await user.click(
    screen.getByRole("button", { name: "Configure Fixture Issue" }),
  );
  await user.type(screen.getByLabelText("Description"), "Updated description");
  // Simulates browser history while native modal background interaction is inert.
  fireEvent.click(screen.getByText("Browser Back"));
  await waitFor(() => expect(requests).toBe(3));
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await screen.findByText("Issue configuration updated.");
  await waitFor(() => expect(requests).toBe(4));
  expect(screen.queryByText("Loading Issues…")).not.toBeInTheDocument();
  await act(() => late(page([{ ...issue, name: "Obsolete response" }])));
  expect(screen.queryByText("Obsolete response")).not.toBeInTheDocument();
  expect(client.patch).toHaveBeenCalledOnce();
});
test("F056.1 late filter response cannot overwrite newer query and loading hides old rows", async () => {
  const pending = [];
  const { user } = view(
    (url, options) =>
      new Promise((resolve) => pending.push({ url, options, resolve })),
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  await user.selectOptions(screen.getByLabelText("Status"), "inactive");
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0].options.signal.aborted).toBe(true);
  await act(() =>
    pending[1].resolve(
      page([{ ...issue, name: "Current result", active: false }]),
    ),
  );
  await screen.findByText("Current result");
  await act(() =>
    pending[0].resolve(page([{ ...issue, name: "Stale result" }])),
  );
  expect(screen.queryByText("Stale result")).not.toBeInTheDocument();
});
test("F056.1 no results differs from empty organization; failed query retains controls and retries", async () => {
  let fail = true;
  const { user } = view(async () => {
    if (fail) throw { status: 503 };
    return page([]);
  }, "/admin/issues?search=missing&status=inactive");
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Search Issues")).toHaveValue("missing");
  expect(screen.getByLabelText("Status")).toHaveValue("inactive");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Refresh Issues" }));
  await screen.findByText("No Issues match these filters.", { exact: false });
  expect(
    screen.queryByText("No Issues are configured."),
  ).not.toBeInTheDocument();
});
test("F056.1 500 summaries render without full configuration hydration or editors", async () => {
  const items = Array.from({ length: 500 }, (_, n) => ({
    ...issue,
    id: `fixture-${n}`,
    name: `Synthetic Issue ${n}`,
  }));
  const { client } = view(
    async () =>
      page(items, { total: 525, organizationTotal: 525, pageSize: 500 }),
    "/admin/issues?pageSize=500",
  );
  // Scope scale assertions to native table rows; avoid repeated full-page label scans.
  await waitFor(() =>
    expect(document.querySelector("tbody")?.rows).toHaveLength(500),
  );
  const table = document.querySelector("table.issue-workspace-table");
  expect(table.rows).toHaveLength(501);
  expect(
    within(table.rows[500]).getByRole("button", {
      name: "Configure Synthetic Issue 499",
    }),
  ).toBeVisible();
  expect(document.querySelector("dialog, #issue-name")).toBeNull();
  expect(
    client.get.mock.calls.filter(([url]) =>
      url.startsWith("/admin/issues/summaries?"),
    ),
  ).toHaveLength(1);
  expect(client.get).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
}, 15000);
test("F056.1 detail must load fresh before editor and failure cannot mutate", async () => {
  let detailFails = true;
  const { user, client } = view(async (url) => {
    if (url.startsWith("/admin/issues/summaries?")) return page();
    if (url.includes("assignment-targets")) return { items: [] };
    if (detailFails) throw { status: 503 };
    return {
      issue: {
        ...issue,
        name: "Fresh authoritative name",
        description: "Fresh description",
        coreRevision: 9,
        actionRevision: 2,
        policyRevision: 3,
        assignmentRevision: 4,
      },
    };
  });
  await screen.findByText(issue.name);
  await user.click(
    screen.getByRole("button", { name: "Configure Fixture Issue" }),
  );
  await screen.findByText(/latest Issue configuration could not be loaded/);
  expect(screen.queryByLabelText("Issue name")).not.toBeInTheDocument();
  detailFails = false;
  await user.click(screen.getByRole("button", { name: "Retry Configuration" }));
  expect(await screen.findByLabelText("Issue name")).toHaveValue(
    "Fresh authoritative name",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056.1 template combobox keyboard selection, Change and late response protection", async () => {
  const pending = [],
    onChange = vi.fn(),
    onDenied = vi.fn();
  const client = {
    get: vi.fn(
      (url, options) =>
        new Promise((resolve) => pending.push({ url, options, resolve })),
    ),
  };
  render(
    <IssueTemplatePicker
      client={client}
      onChange={onChange}
      onDenied={onDenied}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.change(input, { target: { value: "Road" } });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(() => pending[1].resolve({ items: [issue], hasMore: true }));
  await screen.findByText("Keep typing to narrow the results.");
  await act(() =>
    pending[0].resolve({
      items: [{ ...issue, name: "Stale template" }],
      hasMore: false,
    }),
  );
  expect(screen.queryByText("Stale template")).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(
    within(screen.getByRole("listbox")).getByRole("option"),
  ).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith("fixture");
  expect(screen.getByRole("button", { name: "Change template" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Change template" }));
  expect(onChange).toHaveBeenLastCalledWith("");
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(screen.getByRole("combobox")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("F056.1 late search and page responses cannot replace newer results", async () => {
  const pending = [];
  const { user } = view(
    (url, options) =>
      new Promise((resolve) => pending.push({ url, options, resolve })),
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(() =>
    pending[0].resolve(page([issue], { total: 75, organizationTotal: 75 })),
  );
  await user.click(screen.getByRole("button", { name: "Next Issues" }));
  await waitFor(() => expect(pending).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Search Issues"), {
    target: { value: "newer" },
  });
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(() =>
    pending[2].resolve(page([{ ...issue, name: "New search result" }])),
  );
  await act(() =>
    pending[1].resolve(
      page([{ ...issue, name: "Old page result" }], { page: 2, total: 75 }),
    ),
  );
  expect(screen.queryByText("Old page result")).not.toBeInTheDocument();
  await screen.findByText("New search result");
  expect(screen.getByTestId("query")).not.toHaveTextContent("page=2");
  fireEvent.change(screen.getByLabelText("Search Issues"), {
    target: { value: "slow" },
  });
  await waitFor(() => expect(pending).toHaveLength(4));
  fireEvent.change(screen.getByLabelText("Search Issues"), {
    target: { value: "fast" },
  });
  await waitFor(() => expect(pending).toHaveLength(5));
  await act(() =>
    pending[4].resolve(page([{ ...issue, name: "Fast result" }])),
  );
  await act(() =>
    pending[3].resolve(page([{ ...issue, name: "Slow result" }])),
  );
  expect(screen.queryByText("Slow result")).not.toBeInTheDocument();
  expect(pending[3].options.signal.aborted).toBe(true);
});

test("F056.1 template error retries and empty search feedback is accessible", async () => {
  let fail = true;
  const client = {
    get: vi.fn(async () => {
      if (fail) throw { status: 503 };
      return { items: [], hasMore: false };
    }),
  };
  render(
    <IssueTemplatePicker
      client={client}
      onChange={vi.fn()}
      onDenied={vi.fn()}
    />,
  );
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry templates" }));
  await screen.findByText("No eligible templates match your search.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
