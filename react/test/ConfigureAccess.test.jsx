import IssueDrawer from "../src/admin/IssueDrawer.jsx";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, Link } from "react-router-dom";
import { expect, test, vi } from "vitest";
import ConfigureAccess from "../src/admin/ConfigureAccess.jsx";
import {
  accessDraft,
  accessPresets,
  presetAccess,
} from "../src/admin/accessDraft.js";
const permission = (key, label, requires = [], sensitive = false) => ({
  key,
  label,
  requires,
  sensitive,
  description: `${label} description`,
  classification: "manageable",
  category: sensitive ? "Sensitive Information" : "Service Requests",
});
const permissions = [
  permission("service_request.view", "Read PUBLIC requests"),
  permission("service_request.start_work", "Start work", [
    "service_request.view",
  ]),
  permission(
    "service_request.contact.read",
    "Read requester contact",
    [],
    true,
  ),
];
const detail = (extra = {}) => ({
  staff: { id: "target", displayName: "Jordan Example", active: true },
  permissions,
  contributions: [],
  effective: [],
  authorizationRevision: "1",
  canConfigure: true,
  accessAdministrator: false,
  departments: [],
  divisions: [],
  ...extra,
});
function setup(d = detail(), patch = vi.fn()) {
  const client = { patch, get: vi.fn(async () => d) },
    onSaved = vi.fn(),
    onCancel = vi.fn(),
    onDenied = vi.fn();
  const result = render(
    <ConfigureAccess
      client={client}
      detail={d}
      onSaved={onSaved}
      onCancel={onCancel}
      onDenied={onDenied}
    />,
  );
  return {
    user: userEvent.setup(),
    client,
    onSaved,
    onCancel,
    onDenied,
    ...result,
  };
}
test("dependencies require explicit addition and Save sends only approved desired-state fields", async () => {
  const result = { changed: true, detail: detail() };
  const { user, client, onSaved } = setup(
    detail(),
    vi.fn(async () => result),
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Start work Assign in Access & Permissions",
    }),
  );
  expect(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  expect(client.patch).not.toHaveBeenCalled();
  expect(
    screen.getAllByRole("heading", { name: "Additional access required" }),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Refresh Access" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", {
      name: "Start work Assign in Access & Permissions",
    }),
  ).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("access-required-feedback"),
  );
  await waitFor(() =>
    expect(document.getElementById("access-required-feedback")).toHaveFocus(),
  );
  await user.click(screen.getByRole("button", { name: "Add Required Access" }));
  expect(
    screen.queryByRole("heading", { name: "Additional access required" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      name: "Required access added to this draft",
    }),
  ).toBeVisible();
  expect(screen.getByText("Nothing has been saved yet.")).toBeVisible();
  expect(client.patch).not.toHaveBeenCalled();

  expect(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  ).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/access/principals/target",
    {
      expectedAuthorizationRevision: "1",
      managedPermissionKeys: [
        "service_request.start_work",
        "service_request.view",
      ],
    },
    { authenticated: true },
  );
  expect(onSaved).toHaveBeenCalledWith(result);
});
test("outside access is non-editable; mixed removal is contribution-specific", async () => {
  const d = detail({
    contributions: [
      { key: "service_request.view", existing: true, managed: true },
      { key: "service_request.start_work", existing: true, managed: false },
    ],
    effective: ["service_request.view", "service_request.start_work"],
  });
  const { user } = setup(d);
  expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review Changes" })).toBeDisabled();
  expect(
    screen.getByText("1 assigned here · 2 assigned elsewhere"),
  ).toBeInTheDocument();
  const overview = within(
    screen.getByRole("region", { name: "Access Overview" }),
  );
  expect(overview.getAllByText("2 permissions")).toHaveLength(2);
  expect(
    screen.getByText("service_request.view").closest("details"),
  ).not.toHaveAttribute("open");
  expect(
    screen.queryByRole("checkbox", {
      name: "Start work Assign in Access & Permissions",
    }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  expect(
    screen.getByRole("heading", {
      name: "Access & Permissions assignment being removed",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Access to remove" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("1 change ready to save")).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("region", { name: "After these changes" }),
    ).getAllByText("2 permissions"),
  ).toHaveLength(2);
  expect(
    screen.getByText(
      /Jordan Example will still have this access because it is assigned elsewhere/,
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back to Editing" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Review Changes" }),
    ).toHaveFocus(),
  );
  expect(
    screen.getByText("0 assigned here · 2 assigned elsewhere · 1 change"),
  ).toBeInTheDocument();
});
test("sensitive additions require one confirmation and cancellation never saves", async () => {
  const { user, client } = setup();
  await user.click(screen.getByText(/^Sensitive Information/));
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read requester contact Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(
    screen.getByRole("dialog", { name: "Grant Sensitive Access?" }),
  ).toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep Reviewing",
    }),
  );
  expect(client.patch).not.toHaveBeenCalled();
});
test.each([
  ["ACCESS_STATE_STALE", 409],
  ["network", undefined],
])(
  "stale/uncertain outcome %s blocks retry and requires deliberate refresh",
  async (code, status) => {
    const { user, client } = setup(
      detail(),
      vi.fn(async () => {
        throw Object.assign(new Error("failure"), { code, status });
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Read public requests Assign in Access & Permissions",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Review Changes" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(
      screen.getByRole("button", { name: "Review Changes" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name:
          code === "ACCESS_STATE_STALE"
            ? "Refresh Access"
            : "Check Current Access",
      }),
    );
    expect(client.get).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name:
          code === "ACCESS_STATE_STALE"
            ? "Refresh Access"
            : "Check Current Access",
      }),
    );
    await waitFor(() => expect(client.get).toHaveBeenCalledOnce());
    expect(client.patch).toHaveBeenCalledOnce();
  },
);
test("dirty cancellation and preset replacement preserve draft until confirmed", async () => {
  const { user, onCancel } = setup();
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep Editing",
    }),
  );
  await user.selectOptions(screen.getByLabelText("Quick Setup"), "public-work");
  expect(
    screen.getByRole("dialog", { name: "Replace Current Draft?" }),
  ).toBeInTheDocument();
});
test("presets avoid new redundancy and never include sensitive/provisioning authority", () => {
  const d = detail({
    contributions: [{ key: "service_request.view", existing: true }],
    effective: ["service_request.view"],
  });
  expect(presetAccess(accessPresets[0], d)).toEqual([]);
  expect(
    accessPresets
      .flatMap((p) => p.keys)
      .some((k) =>
        /contact|answers|note|communication|tracking|admin.access|geospatial|ai\./.test(
          k,
        ),
      ),
  ).toBe(false);
  const admin = detail({
    permissions: [
      ...permissions,
      permission("admin.configuration.read", "View configuration"),
    ],
    contributions: [
      { key: "admin.access.read", existing: true },
      { key: "admin.access.manage", existing: true },
    ],
    effective: ["admin.access.read", "admin.access.manage"],
  });
  expect(
    accessDraft(admin, ["admin.configuration.read"]).changesAdministrator,
  ).toBe(true);
});

test("route navigation keeps dirty draft until explicit discard", async () => {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <Link to="/next">Leave page</Link>
          <ConfigureAccess client={{}} detail={detail()} onCancel={vi.fn()} />
        </>
      ),
    },
    { path: "/next", element: <h1>Next page</h1> },
  ]);
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("link", { name: "Leave page" }));
  expect(router.state.location.pathname).toBe("/");
  await user.click(screen.getByRole("button", { name: "Keep Editing" }));
  expect(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  ).toBeChecked();
  await user.click(screen.getByRole("link", { name: "Leave page" }));
  await user.click(screen.getByRole("button", { name: "Discard Changes" }));
  expect(
    await screen.findByRole("heading", { name: "Next page" }),
  ).toBeInTheDocument();
});

test("pending Save is submitted once and its late response is ignored after unmount", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { user, client, onSaved, unmount } = setup(
    detail(),
    vi.fn(() => pending),
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  await user.dblClick(screen.getByRole("button", { name: "Save Changes" }));
  expect(client.patch).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  unmount();
  resolve({ changed: true, detail: detail() });
  await pending;
  expect(onSaved).not.toHaveBeenCalled();
});

test("Issue Handling adds only its missing manageable requirements to the draft", async () => {
  const customPermissions = [
    permission("admin.configuration.read", "View configuration"),
    permission("admin.issues.write", "Manage Issues", [
      "admin.configuration.read",
    ]),
    permission("catalog.issue_action.manage", "Manage Issue Handling", [
      "admin.configuration.read",
      "admin.issues.write",
    ]),
  ].map((p) => ({ ...p, category: "Administrative Configuration" }));
  const { user, client } = setup(detail({ permissions: customPermissions }));
  await user.click(screen.getByText(/^Administration/));
  await user.click(
    screen.getByRole("checkbox", {
      name: "Manage Issue Handling Assign in Access & Permissions",
    }),
  );
  expect(
    screen.getByRole("checkbox", {
      name: "View configuration Assign in Access & Permissions",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", {
      name: "Manage Issues Assign in Access & Permissions",
    }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Add Required Access" }));
  const confirmation = screen.getByRole("status", {
    name: "Required access added to this draft",
  });
  expect(
    within(confirmation)
      .getAllByRole("listitem")
      .map((n) => n.textContent),
  ).toEqual(["View configuration", "Manage Issues"]);
  expect(
    screen.getByRole("checkbox", {
      name: "View configuration Assign in Access & Permissions",
    }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", {
      name: "Manage Issues Assign in Access & Permissions",
    }),
  ).toBeChecked();
  expect(
    screen.queryByRole("heading", { name: "Additional access required" }),
  ).not.toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
  expect(client.get).not.toHaveBeenCalled();
});

test("one sensitive dialog separates prerequisites, keeps safe focus and cancels without saving", async () => {
  const ps = [
    permission("admin.configuration.read", "View configuration"),
    permission("admin.issues.write", "Manage Issues", [
      "admin.configuration.read",
    ]),
    permission(
      "catalog.issue_action.manage",
      "Manage Issue Handling",
      ["admin.configuration.read", "admin.issues.write"],
      true,
    ),
    permission(
      "service_request.contact.read",
      "Read requester contact",
      [],
      true,
    ),
  ];
  const { user, client } = setup(detail({ permissions: ps }));
  await user.click(screen.getByText(/^Sensitive Information/));
  await user.click(
    screen.getByRole("checkbox", {
      name: "Manage Issue Handling Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Add Required Access" }));
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read requester contact Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  const save = screen.getByRole("button", { name: "Save Changes" });
  await user.click(save);
  const dialog = screen.getByRole("dialog", {
    name: "Grant Sensitive Access?",
  });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  const lists = within(dialog).getAllByRole("list");
  expect(
    within(lists[0])
      .getAllByRole("listitem")
      .map((n) => n.textContent),
  ).toEqual(["Manage Issue Handling", "Read requester contact"]);
  expect(
    within(lists[1])
      .getAllByRole("listitem")
      .map((n) => n.textContent),
  ).toEqual(["View configuration", "Manage Issues"]);
  expect(dialog).not.toHaveTextContent(
    /admin\.|catalog\.|service_request\.|Existing resource-access/,
  );
  const cancel = within(dialog).getByRole("button", { name: "Keep Reviewing" }),
    grant = within(dialog).getByRole("button", { name: "Grant Access" });
  expect(cancel).toHaveFocus();
  await user.tab({ shift: true });
  expect(grant).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  await waitFor(() => expect(save).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
});

test("Alex review groups three additions and preserves unchanged context and sensitive confirmation", async () => {
  const outside = [
    "service_request.view",
    "service_request.assign",
    "service_request.start_work",
    "service_request.hold",
    "service_request.resume",
  ];
  const existing = [...outside, "service_request.create"];
  const admin = [
    permission("admin.configuration.read", "View configuration"),
    permission("admin.issues.write", "Manage Issues", [
      "admin.configuration.read",
    ]),
    permission(
      "catalog.issue_action.manage",
      "Manage Issue Handling",
      ["admin.configuration.read", "admin.issues.write"],
      true,
    ),
  ].map((p) => ({ ...p, category: "Administrative Configuration" }));
  const { user, client } = setup(
    detail({
      staff: { id: "target", displayName: "Alex Example", active: true },
      effective: existing,
      contributions: existing.map((key) => ({
        key,
        managed: key === "service_request.create",
        existing: outside.includes(key),
      })),
      permissions: [
        ...existing.map((key, i) =>
          permission(key, `Existing permission ${i}`),
        ),
        ...admin,
      ],
      departments: [{ id: "d", name: "Public Works", status: "active" }],
      divisions: [{ id: "v", name: "Streets", status: "active" }],
    }),
  );
  await user.click(screen.getByText(/^Administration/));
  await user.click(
    screen.getByRole("checkbox", {
      name: "Manage Issue Handling Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Add Required Access" }));
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  const added = screen.getByRole("region", { name: "Access being added" });
  expect(within(added).getAllByRole("listitem")).toHaveLength(3);
  expect(within(added).getAllByText("Sensitive access")).toHaveLength(1);
  expect(
    within(added).getAllByText("Required by Manage Issue Handling"),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("region", { name: "Access being removed" }),
  ).not.toBeInTheDocument();
  const unchanged = screen.getByRole("region", {
    name: "Access that will not change",
  });
  expect(unchanged).toHaveTextContent("5 permissions assigned elsewhere");
  expect(unchanged).toHaveTextContent("Public Works");
  expect(unchanged).toHaveTextContent("Streets");
  const disclosure = within(unchanged).getByText("View permissions");
  expect(disclosure.closest("details")).not.toHaveAttribute("open");
  await user.click(disclosure);
  expect(
    within(disclosure.closest("details")).getAllByRole("listitem"),
  ).toHaveLength(5);
  const summary = screen.getByRole("region", { name: "After these changes" });
  expect(summary).toHaveTextContent("Current access6 permissions");
  expect(summary).toHaveTextContent("After changes9 permissions");
  expect(summary).toHaveTextContent("Access AdministratorNo");
  expect(screen.getByText("3 changes ready to save")).toBeVisible();
  expect(
    screen.queryByText(
      /Specific actions still require|Source counts may overlap/,
    ),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  const dialog = screen.getByRole("dialog", {
    name: "Grant Sensitive Access?",
  });
  expect(
    within(dialog).getByRole("button", { name: "Keep Reviewing" }),
  ).toHaveFocus();
  await user.click(
    within(dialog).getByRole("button", { name: "Keep Reviewing" }),
  );
  expect(client.patch).not.toHaveBeenCalled();
});

test("F057.3D removal review hides empty additions and preserves source meaning", async () => {
  const { user } = setup(
    detail({
      effective: ["service_request.view"],
      contributions: [
        { key: "service_request.view", managed: true, existing: true },
      ],
    }),
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  expect(
    screen.queryByRole("heading", { name: "Access being added" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/0 permissions to add|No access is being added/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      name: "Access & Permissions assignment being removed",
    }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Jordan Example will still have this access because it is assigned elsewhere.",
    ),
  ).toBeVisible();
});
test("F057.3D stale refresh cancellation preserves selections and blocks retry", async () => {
  const { user, client } = setup(
    detail(),
    vi.fn(async () => {
      throw Object.assign(new Error("stale"), {
        code: "ACCESS_STATE_STALE",
        status: 409,
      });
    }),
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(
    screen.getByRole("heading", { name: "Access has changed" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Someone changed access after you opened this staff member. Refresh the latest access before saving.",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Refresh Access" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep Editing",
    }),
  );
  expect(client.get).not.toHaveBeenCalled();
  expect(client.patch).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("checkbox", {
      name: "Read public requests Assign in Access & Permissions",
    }),
  ).toBeChecked();
  expect(screen.getByRole("button", { name: "Review Changes" })).toBeDisabled();
});
test("F057.3D Grant Access double submission is blocked while pending", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const { user, client, onSaved } = setup(
    detail(),
    vi.fn(() => pending),
  );
  await user.click(screen.getByText(/^Sensitive Information/));
  await user.click(
    screen.getByRole("checkbox", {
      name: "Read requester contact Assign in Access & Permissions",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review Changes" }));
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  const dialog = screen.getByRole("dialog", {
    name: "Grant Sensitive Access?",
  });
  expect(dialog).not.toHaveTextContent("service_request.contact.read");
  await user.dblClick(
    within(dialog).getByRole("button", { name: "Grant Access" }),
  );
  expect(client.patch).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  finish({ changed: true, detail: detail() });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});

test.each(["Close", "Escape"])(
  "F057.3D dirty drawer %s requires explicit discard before target switch",
  async (method) => {
    let closeHandler;
    const leave = vi.fn(),
      client = { patch: vi.fn() };
    render(
      <IssueDrawer title="Configure Access" onClose={() => closeHandler?.()}>
        <ConfigureAccess
          client={client}
          detail={detail()}
          onClose={leave}
          onCancel={leave}
          registerClose={(handler) => {
            closeHandler = handler;
          }}
        />
      </IssueDrawer>,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Read public requests Assign in Access & Permissions",
      }),
    );
    if (method === "Close")
      await user.click(
        screen.getByRole("button", { name: "Close configuration" }),
      );
    else
      fireEvent(
        screen.getByRole("dialog", { name: "Configure Access" }),
        new Event("cancel", { bubbles: false, cancelable: true }),
      );
    expect(leave).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("dialog", {
      name: "Discard Access Changes?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Keep Editing" }),
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Read public requests Assign in Access & Permissions",
      }),
    ).toBeChecked();
    await user.click(
      screen.getByRole("button", { name: "Close configuration" }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Discard Access Changes?" }),
      ).getByRole("button", { name: "Discard Changes" }),
    );
    expect(leave).toHaveBeenCalledOnce();
    expect(client.patch).not.toHaveBeenCalled();
  },
);
test("F057.3D clean close is immediate and Custom Access never saves", async () => {
  const { user, onCancel, client } = setup();
  await user.selectOptions(screen.getByLabelText("Quick Setup"), "custom");
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
