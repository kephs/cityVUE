import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import DepartmentsConfiguration from "../src/admin/DepartmentsConfiguration.jsx";
import {
  departmentErrors,
  departmentDraft,
} from "../src/admin/departmentPreview.js";
import { AdminConfiguration } from "../src/admin/AdminConfigurationPage.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";

afterEach(() => vi.restoreAllMocks());
async function preview(props) {
  const user = userEvent.setup();
  const result = render(<DepartmentsConfiguration {...props} />);
  await user.click(
    screen.getByRole("button", { name: "Open fictional preview" }),
  );
  return { user, ...result };
}
function admin(client, path = "/admin/departments") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/:section?"
            element={<AdminConfiguration client={client} />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}
const snapshot = {
  issues: { total: 0 },
  collection: { enabled: false },
  participationAreas: { active: 0 },
  health: [],
};

test("authorized navigation uses the existing admin section and only its GET contract", async () => {
  const client = { get: vi.fn().mockResolvedValue(snapshot) };
  admin(client, "/admin");
  await screen.findByText("Configuration at a glance");
  await userEvent.click(screen.getByRole("link", { name: "Departments" }));
  expect(
    await screen.findByText("Department directory not connected"),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Departments" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(client.get).toHaveBeenCalledTimes(2);
  for (const [url, options] of client.get.mock.calls) {
    expect(url).toBe("/admin/configuration?issuePage=1&areaPage=1");
    expect(options.authenticated).toBe(true);
  }
});

test.each([401, 403, 500, 503])(
  "configuration HTTP %s hides the entire department preview",
  async (status) => {
    const client = {
      get: vi.fn().mockRejectedValue({ status, message: "private diagnostic" }),
    };
    admin(client);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading authorized configuration",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      status < 500 ? "not authorized" : "could not be loaded",
    );
    expect(
      screen.queryByRole("button", { name: "Open fictional preview" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  },
);

test("changing client clears preview and ignores cancelled authorization responses", async () => {
  let resolve;
  const first = {
    get: vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  };
  const denied = { get: vi.fn().mockRejectedValue({ status: 403 }) };
  const wrapper = ({ client }) => (
    <ThemeProvider>
      <MemoryRouter initialEntries={["/admin/departments"]}>
        <Routes>
          <Route
            path="/admin/:section?"
            element={<AdminConfiguration client={client} />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
  const result = render(wrapper({ client: first }));
  result.rerender(wrapper({ client: denied }));
  await screen.findByRole("alert");
  await act(async () => resolve(snapshot));
  expect(
    screen.queryByText("Department directory not connected"),
  ).not.toBeInTheDocument();
});

test("live data is unavailable until fictional examples are explicitly opened", async () => {
  render(<DepartmentsConfiguration />);
  expect(
    screen.getByText("Live department administration is unavailable"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Public Works")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Open fictional preview" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "4 of 4 fictional departments",
  );
  expect(
    screen.getByLabelText("Fictional department counts"),
  ).toHaveTextContent("Total departments4Active2Inactive1Archived1");
});

test("a newly denied auth client removes an already opened fictional directory", async () => {
  const allowed = { get: vi.fn().mockResolvedValue(snapshot) };
  const denied = { get: vi.fn().mockRejectedValue({ status: 403 }) };
  const view = (client) => (
    <ThemeProvider>
      <MemoryRouter initialEntries={["/admin/departments"]}>
        <Routes>
          <Route
            path="/admin/:section?"
            element={<AdminConfiguration client={client} />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
  const result = render(view(allowed));
  await userEvent.click(
    await screen.findByRole("button", { name: "Open fictional preview" }),
  );
  expect(
    screen.getByRole("heading", { name: "Public Works" }),
  ).toBeInTheDocument();
  result.rerender(view(denied));
  expect(
    screen.queryByRole("heading", { name: "Public Works" }),
  ).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("not authorized");
});

test("search, status filters, empty results, reset and deterministic sorting", async () => {
  const { user } = await preview();
  await user.type(screen.getByRole("searchbox"), "street");
  expect(screen.getByRole("status")).toHaveTextContent("1 of 4");
  expect(
    screen.getByRole("heading", { name: "Public Works" }),
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Department status"),
    "inactive",
  );
  expect(screen.getByText("No matching departments")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await user.selectOptions(screen.getByLabelText("Sort departments"), "name");
  expect(
    screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent),
  ).toEqual([
    "Community Services",
    "Former Programs",
    "Parks & Recreation",
    "Public Works",
  ]);
  await user.selectOptions(
    screen.getByLabelText("Sort departments"),
    "name-desc",
  );
  expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
    "Public Works",
  );
  await user.selectOptions(
    screen.getByLabelText("Department status"),
    "archived",
  );
  expect(screen.getByRole("status")).toHaveTextContent("1 of 4");
  expect(
    within(screen.getByRole("listitem")).getByText("Archived"),
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Department status"),
    "inactive",
  );
  expect(
    within(screen.getByRole("listitem")).getByText("Inactive"),
  ).toBeInTheDocument();
});

test("empty preview can create a department without relationships", async () => {
  const { user } = await preview({ previewFactory: () => [] });
  expect(
    screen.getByText("No departments in this preview"),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Create department preview" }),
  );
  await user.type(
    screen.getByLabelText(/Department name/),
    "Example Department",
  );
  await user.click(screen.getByRole("button", { name: "Apply local preview" }));
  expect(
    screen.getByRole("heading", { name: "Example Department" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Nothing was saved to a server",
  );
});

test("form errors are associated, announced and focused; valid create stays local", async () => {
  const { user } = await preview();
  await user.click(
    screen.getByRole("button", { name: "Create department preview" }),
  );
  await user.click(screen.getByRole("button", { name: "Apply local preview" }));
  const name = screen.getByLabelText(/Department name/);
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription(/1–200/);
  expect(screen.getByRole("alert")).toHaveTextContent("highlighted fields");
  await user.type(name, "Public Works");
  await user.click(screen.getByRole("button", { name: "Apply local preview" }));
  expect(
    screen.getByText("This name already exists in the fictional preview."),
  ).toBeInTheDocument();
  await user.clear(name);
  await user.type(name, "Example Department");
  await user.clear(screen.getByLabelText("Display order"));
  await user.type(screen.getByLabelText("Display order"), "-1");
  await user.click(screen.getByRole("button", { name: "Apply local preview" }));
  expect(screen.getByLabelText("Display order")).toHaveFocus();
  await user.clear(screen.getByLabelText("Display order"));
  await user.type(screen.getByLabelText("Display order"), "5");
  await user.click(screen.getByRole("button", { name: "Apply local preview" }));
  expect(screen.getByRole("status")).toHaveTextContent("5 of 5");
});

test.each(["", "-1", "1.5", "2147483648", "abc"])(
  "rejects invalid display order %s",
  (displayOrder) => {
    expect(
      departmentErrors(
        { ...departmentDraft(), name: "Example", displayOrder },
        [],
      ).displayOrder,
    ).toBeTruthy();
  },
);
test("validates name length and allowed status without inventing a description limit", () => {
  const draft = {
    name: "X".repeat(201),
    description: "D".repeat(10000),
    status: "unknown",
    displayOrder: "0",
  };
  expect(Object.keys(departmentErrors(draft, []))).toEqual(["name", "status"]);
});

test("local edit updates all supported fields and never invokes network or persistent storage", async () => {
  const fetch = vi
    .spyOn(window, "fetch")
    .mockRejectedValue(new Error("unexpected request"));
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const { user, unmount } = await preview();
  await user.click(
    screen.getByRole("button", { name: "Edit preview for Public Works" }),
  );
  await user.clear(screen.getByLabelText(/Department name/));
  await user.type(screen.getByLabelText(/Department name/), "Example Works");
  await user.clear(screen.getByLabelText("Description"));
  await user.type(screen.getByLabelText("Description"), "Example description");
  await user.selectOptions(
    screen.getByLabelText("Status", { exact: true }),
    "inactive",
  );
  await user.click(screen.getByRole("button", { name: "Apply local preview" }));
  expect(
    screen.getByRole("heading", { name: "Example Works" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Example description")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /save|publish/i }),
  ).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  unmount();
  await preview();
  expect(screen.queryByText("Example Works")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Public Works" }),
  ).toBeInTheDocument();
});

test("dirty edits warn on unload; cancel supports keep editing and confirmed discard with focus restoration", async () => {
  const { user } = await preview();
  const trigger = screen.getByRole("button", {
    name: "Edit preview for Public Works",
  });
  await user.click(trigger);
  await user.type(screen.getByLabelText(/Department name/), " Changed");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(
    screen.getByRole("dialog", { name: "Discard unsaved preview changes?" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText(/Department name/)).toHaveValue(
    "Public Works Changed",
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Public Works" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

test("keyboard opens details, Escape closes pristine form, relationships remain read-only", async () => {
  const { user } = await preview();
  const trigger = screen.getByRole("button", { name: "View Public Works" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("heading", { name: "Public Works", level: 2 }),
  ).toHaveFocus();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Street Maintenance")).toBeInTheDocument();
  expect(within(dialog).getByText("Roads")).toBeInTheDocument();
  expect(within(dialog).getByText("Report a pothole")).toBeInTheDocument();
  expect(
    within(dialog).getByText(/do not establish live routing/),
  ).toBeInTheDocument();
  expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(
    screen.getByRole("button", { name: "Edit preview for Public Works" }),
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("categories can belong directly to a department without a division", async () => {
  const { user } = await preview();
  await user.click(
    screen.getByRole("button", { name: "View Parks & Recreation" }),
  );
  expect(
    screen.getByText("Directly under this Department; no Division."),
  ).toBeInTheDocument();
  expect(screen.getByText("No divisions in this example.")).toBeInTheDocument();
});

test("browser route navigation requires a deliberate discard of a dirty draft", async () => {
  const router = createMemoryRouter(
    [
      { path: "/admin/departments", element: <DepartmentsConfiguration /> },
      { path: "/elsewhere", element: <h1>Elsewhere</h1> },
    ],
    { initialEntries: ["/admin/departments"] },
  );
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Open fictional preview" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Create department preview" }),
  );
  await user.type(screen.getByLabelText(/Department name/), "Unfinished");
  await act(async () => {
    await router.navigate("/elsewhere");
  });
  expect(
    screen.getByRole("dialog", { name: "Leave this department preview?" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText(/Department name/)).toHaveValue("Unfinished");
  await act(async () => {
    await router.navigate("/elsewhere");
  });
  await user.click(screen.getByRole("button", { name: "Discard and leave" }));
  expect(
    await screen.findByRole("heading", { name: "Elsewhere" }),
  ).toBeInTheDocument();
});
