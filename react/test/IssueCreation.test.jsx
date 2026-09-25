import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import IssueConfiguration from "../src/admin/IssueConfiguration.jsx";
import IssueCreationPicker from "../src/admin/IssueCreationPicker.jsx";
const category = { id: "category-a", name: "Roads", canManageHandling: true };
const summary = {
  items: [],
  total: 0,
  organizationTotal: 0,
  active: 0,
  inactive: 0,
  page: 1,
  pageSize: 25,
  canWrite: true,
};
const source = {
  id: "source-a",
  name: "Source A",
  category: "Roads",
  catalogVersionId: "version-a",
  defaultPriority: "low",
  locationPolicy: "optional",
  geographicEligibilityMode: "no_geographic_restriction",
  supportedGeography: true,
  questions: [],
};
async function setup({ capability = true, post } = {}) {
  const client = {
    get: vi.fn(async (url) => {
      if (url.startsWith("/admin/issues/summaries?")) return summary;
      if (url === "/admin/issues/categories") return { items: [] };
      if (url.startsWith("/admin/issues/creation/categories"))
        return {
          items: [{ ...category, canManageHandling: capability }],
          hasMore: false,
        };
      if (url.startsWith("/admin/issues/creation/sources/source-a?"))
        return { source };
      if (url.startsWith("/admin/issues/creation/sources?"))
        return { items: [source], hasMore: false };
      if (url.includes("assignment-targets")) return { items: [] };
      throw Error("Unexpected lookup");
    }),
    post: vi.fn(
      post || (async () => ({ issue: { id: "created" }, changed: true })),
    ),
    patch: vi.fn(),
  };
  const user = userEvent.setup(),
    onDenied = vi.fn();
  render(
    <MemoryRouter>
      <IssueConfiguration client={client} onDenied={onDenied} />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole("button", { name: "+ Add Issue" }));
  return { client, user, onDenied, dialog: within(screen.getByRole("dialog")) };
}
async function chooseCategory(ctx) {
  await ctx.user.click(
    ctx.dialog.getByRole("combobox", { name: "Category", exact: true }),
  );
  await ctx.user.click(
    await ctx.dialog.findByRole("option", { name: "Roads" }),
  );
}
async function complete(ctx) {
  await chooseCategory(ctx);
  await ctx.user.type(
    ctx.dialog.getByLabelText("Issue name"),
    "Fictional complete Issue",
  );
  await ctx.user.selectOptions(
    ctx.dialog.getByLabelText("Default Priority"),
    "urgent",
  );
  for (const name of ["External only", "Required", "No Geographic Restriction"])
    await ctx.user.click(ctx.dialog.getByRole("radio", { name, exact: true }));
}

test("F056.5 Add starts with Category, no priority/location/geographic assumptions and optional source hidden", async () => {
  const c = await setup();
  expect(
    c.dialog
      .getByRole("combobox", { name: "Category", exact: true })
      .compareDocumentPosition(c.dialog.getByLabelText("Issue name")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(c.dialog.getByLabelText("Default Priority")).toHaveValue("");
  expect(
    c.dialog.getByRole("radio", { name: "No, start with a new configuration" }),
  ).toBeChecked();
  expect(
    c.dialog.queryByRole("combobox", { name: "Search existing Issues" }),
  ).not.toBeInTheDocument();
  for (const name of [
    "Required",
    "Optional",
    "Not Used",
    "No Geographic Restriction",
  ])
    expect(
      c.dialog.getByRole("radio", { name, exact: true }),
    ).not.toBeChecked();
  expect(c.dialog.getByRole("button", { name: "Create Issue" })).toBeDisabled();
  expect(
    c.dialog.getByRole("heading", { name: "Follow-up questions" }),
  ).toBeInTheDocument();
  expect(c.client.post).not.toHaveBeenCalled();
});
test("F056.5 Add Category drives assignment lookup without a source", async () => {
  const c = await setup();
  await chooseCategory(c);
  await waitFor(() =>
    expect(c.client.get).toHaveBeenCalledWith(
      expect.stringContaining(
        "creation/assignment-targets?categoryId=category-a",
      ),
      expect.anything(),
    ),
  );
  expect(
    c.client.get.mock.calls.some(([url]) => url.includes("/templates")),
  ).toBe(false);
});
test("F056.5 External Redirect is configured before one complete Create request", async () => {
  const c = await setup();
  await complete(c);
  await c.user.click(
    c.dialog.getByRole("radio", {
      name: "Send the requester to another service",
    }),
  );
  expect(
    c.dialog
      .getByRole("group", { name: "How should external requests be handled?" })
      .compareDocumentPosition(c.dialog.getByText("External Redirect")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(c.dialog.getByRole("button", { name: "Create Issue" })).toBeDisabled();
  await c.user.type(
    c.dialog.getByLabelText("Destination URL"),
    "https://example.org/service",
  );
  await c.user.type(
    c.dialog.getByLabelText("Handoff message"),
    "Continue to the fictional service.",
  );
  await c.user.click(c.dialog.getByRole("button", { name: "Create Issue" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(c.client.post).toHaveBeenCalledTimes(1);
  expect(c.client.patch).not.toHaveBeenCalled();
  expect(c.client.post.mock.calls[0][1]).toMatchObject({
    categoryId: "category-a",
    defaultPriority: "urgent",
    locationPolicy: "required",
    geographicEligibilityMode: "no_geographic_restriction",
    availability: "EXTERNAL_ONLY",
    handling: {
      actionType: "external_redirect",
      destination: "https://example.org/service",
      message: "Continue to the fictional service.",
    },
    questions: [],
  });
});
test("F056.5 changing Availability removes an invalid redirect draft; capability never grants authority", async () => {
  const c = await setup();
  await complete(c);
  await c.user.click(
    c.dialog.getByRole("radio", {
      name: "Send the requester to another service",
    }),
  );
  await c.user.click(
    c.dialog.getByRole("radio", { name: "Internal only", exact: true }),
  );
  expect(
    c.dialog.queryByRole("radio", {
      name: "Send the requester to another service",
    }),
  ).not.toBeInTheDocument();
  expect(c.dialog.queryByLabelText("Destination URL")).not.toBeInTheDocument();
  expect(c.dialog.getByText("Reqro Intake")).toBeInTheDocument();
});
test("F056.5 ordinary creator is not offered unauthorized redirect selection", async () => {
  const c = await setup({ capability: false });
  await complete(c);
  expect(
    c.dialog.getByText(
      "Your current access does not allow External Redirect configuration for this Category.",
    ),
  ).toBeInTheDocument();
  expect(
    c.dialog.queryByRole("radio", {
      name: "Send the requester to another service",
    }),
  ).not.toBeInTheDocument();
  expect(c.dialog.getByRole("button", { name: "Create Issue" })).toBeEnabled();
});
test("F056.5 source is Category-scoped, reviewed once and guarded against discarded edits", async () => {
  const c = await setup();
  await c.user.click(
    c.dialog.getByRole("radio", { name: "Yes, copy an existing Issue" }),
  );
  expect(
    c.dialog.getByRole("combobox", { name: "Search existing Issues" }),
  ).toBeDisabled();
  await chooseCategory(c);
  await c.user.click(
    c.dialog.getByRole("combobox", { name: "Search existing Issues" }),
  );
  await c.user.click(await c.dialog.findByRole("option", { name: /Source A/ }));
  await c.dialog.findByText(/Starting From/);
  expect(c.dialog.getByLabelText("Default Priority")).toHaveValue("low");
  expect(
    c.dialog.getByRole("radio", { name: "Optional", exact: true }),
  ).toBeChecked();
  expect(
    c.client.get.mock.calls.some(([url]) =>
      url.includes("creation/sources?categoryId=category-a"),
    ),
  ).toBe(true);
  await c.user.selectOptions(
    c.dialog.getByLabelText("Default Priority"),
    "high",
  );
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await c.user.click(
    c.dialog.getByRole("button", { name: "Change Search existing Issues" }),
  );
  expect(confirm).toHaveBeenCalled();
  expect(c.dialog.getByLabelText("Default Priority")).toHaveValue("high");
  confirm.mockReturnValue(true);
  await c.user.click(c.dialog.getByRole("button", { name: "Change Category" }));
  expect(c.dialog.queryByText(/Starting From/)).not.toBeInTheDocument();
  expect(
    c.dialog.getByRole("combobox", { name: "Search existing Issues" }),
  ).toBeDisabled();
  confirm.mockRestore();
});
test("F056.5 failed Create preserves draft, and pending Create is single flight", async () => {
  let reject;
  const c = await setup({
    post: () =>
      new Promise((_, r) => {
        reject = r;
      }),
  });
  await complete(c);
  await c.user.click(c.dialog.getByRole("button", { name: "Create Issue" }));
  expect(c.client.post).toHaveBeenCalledTimes(1);
  expect(c.dialog.getByLabelText("Issue name")).toBeDisabled();
  reject({
    status: 400,
    code: "ISSUE_CATEGORY_UNAVAILABLE",
    message:
      "The Category is no longer available. Select an eligible Category.",
  });
  await c.dialog.findByRole("alert");
  expect(c.dialog.getByLabelText("Issue name")).toHaveValue(
    "Fictional complete Issue",
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
test("F056.5 Category search ignores superseded responses and supports keyboard selection", async () => {
  const pending = [];
  const client = {
    get: vi.fn(
      (url) => new Promise((resolve) => pending.push({ url, resolve })),
    ),
  };
  const select = vi.fn(),
    user = userEvent.setup();
  render(
    <IssueCreationPicker
      client={client}
      endpoint="/admin/issues/creation/categories"
      label="Category"
      onSelect={select}
      onClear={() => {}}
      onDenied={() => {}}
    />,
  );
  const input = screen.getByRole("combobox");
  await user.click(input);
  await waitFor(() => expect(pending).toHaveLength(1));
  await user.type(input, "road");
  await waitFor(() => expect(pending.length).toBeGreaterThan(1));
  pending.at(-1).resolve({ items: [category], hasMore: false });
  await screen.findByRole("option", { name: "Roads" });
  pending[0].resolve({
    items: [{ id: "old", name: "Old result" }],
    hasMore: false,
  });
  await user.keyboard("{ArrowDown}{Enter}");
  expect(select).toHaveBeenCalledWith(category);
  expect(screen.queryByText("Old result")).not.toBeInTheDocument();
});

test("F056.5 stale source blocks retry until deliberate refresh and review", async () => {
  const c = await setup({
    post: async () => {
      throw {
        status: 409,
        code: "ISSUE_SOURCE_STALE",
        message: "Refresh the source configuration before creating this Issue.",
      };
    },
  });
  await chooseCategory(c);
  await c.user.type(c.dialog.getByLabelText("Issue name"), "Reviewed copy");
  await c.user.click(
    c.dialog.getByRole("radio", { name: "External only", exact: true }),
  );
  await c.user.click(
    c.dialog.getByRole("radio", { name: "Yes, copy an existing Issue" }),
  );
  await c.user.click(
    c.dialog.getByRole("combobox", { name: "Search existing Issues" }),
  );
  await c.user.click(await c.dialog.findByRole("option", { name: /Source A/ }));
  await c.dialog.findByText(/Starting From/);
  await c.user.click(c.dialog.getByRole("button", { name: "Create Issue" }));
  await c.dialog.findByRole("alert");
  expect(c.dialog.getByRole("button", { name: "Create Issue" })).toBeDisabled();
  expect(c.dialog.getByLabelText("Issue name")).toHaveValue("Reviewed copy");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  await c.user.click(
    c.dialog.getByRole("button", { name: "Refresh source configuration" }),
  );
  await waitFor(() =>
    expect(
      c.dialog.getByRole("button", { name: "Create Issue" }),
    ).toBeEnabled(),
  );
  expect(c.client.post).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

test("F056.5 selecting Category preserves manually chosen blank-creation policies", async () => {
  const c = await setup();
  expect(
    c.dialog.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveFocus();
  await c.user.selectOptions(
    c.dialog.getByLabelText("Default Priority"),
    "urgent",
  );
  await c.user.click(
    c.dialog.getByRole("radio", { name: "Required", exact: true }),
  );
  await chooseCategory(c);
  await c.user.click(c.dialog.getByRole("button", { name: "Change Category" }));
  expect(c.dialog.getByLabelText("Default Priority")).toHaveValue("urgent");
  expect(
    c.dialog.getByRole("radio", { name: "Required", exact: true }),
  ).toBeChecked();
});

test("F056.5 explains Availability and Category prerequisites for Handling", async () => {
  const c = await setup();
  expect(
    c.dialog.getByText(
      "Choose Availability above to see the available Handling options.",
    ),
  ).toBeInTheDocument();
  await c.user.click(
    c.dialog.getByRole("radio", { name: "External only", exact: true }),
  );
  expect(
    c.dialog.getByText(
      "Select a Category under General to check available Handling options.",
    ),
  ).toBeInTheDocument();
  await c.user.click(
    c.dialog.getByRole("radio", { name: "Internal and external", exact: true }),
  );
  expect(
    c.dialog.getByText(
      /Internal only and Internal and external Issues use Reqro Intake/,
    ),
  ).toBeInTheDocument();
});

test("F056.5 Handling follows Availability before Service Location and Geographic Eligibility", async () => {
  const c = await setup();
  const headings = [
    ...screen.getByRole("dialog").querySelectorAll("h4, legend"),
  ].map((node) => node.textContent);
  expect(headings.indexOf("Handling")).toBeGreaterThan(
    headings.indexOf("Where can this Issue be used?"),
  );
  expect(headings.indexOf("Service Location")).toBeGreaterThan(
    headings.indexOf("Handling"),
  );
  expect(headings.indexOf("Geographic Eligibility")).toBeGreaterThan(
    headings.indexOf("Service Location"),
  );
  await complete(c);
  await c.user.click(
    c.dialog.getByRole("radio", {
      name: "Send the requester to another service",
    }),
  );
  expect(
    c.dialog
      .getByLabelText("Destination URL")
      .compareDocumentPosition(
        c.dialog.getByRole("group", { name: "Service Location", exact: true }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
