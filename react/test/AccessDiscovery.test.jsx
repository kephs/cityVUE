import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import AccessDiscovery from "../src/admin/AccessDiscovery.jsx";

const permissions = [
  {
    key: "config",
    label: "View configuration",
    category: "Administrative Configuration",
    description: "Inspect access configuration and history.",
    requires: [],
  },
  {
    key: "contact",
    label: "View contact",
    category: "Sensitive Information",
    description: "Read protected contact.",
    sensitive: true,
    classification: "provisioning-only",
    requires: ["config"],
  },
];
function view(detailOverrides = {}) {
  const items = [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ].map(([departments, divisions], i) => ({
    id: String(i),
    displayName: `Staff ${i}`,
    departments,
    divisions,
    active: true,
    categories: ["Administrative Configuration"],
    source: "mixed",
  }));
  const client = {
    get: vi.fn(async (url) => {
      if (url.endsWith("/scopes")) return { departments: [], divisions: [] };
      if (url.endsWith("/permissions")) return { items: permissions };
      if (url.includes("/history"))
        return { items: [], page: 1, pageSize: 25, total: 0 };
      if (url.includes("principals?"))
        return { items, page: 1, pageSize: 25, total: 4, organizationTotal: 4 };
      return {
        staff: items[0],
        permissions,
        effective: ["config", "contact"],
        accessAdministrator: false,
        departments: [{ id: "d1", name: "Public Works", status: "active" }],
        divisions: [
          { id: "v1", name: "Former Operations", status: "inactive" },
        ],
        contributions: [
          { key: "config", managed: true, existing: true, sourceCount: 2 },
          { key: "contact", existing: true, managed: false, sourceCount: 1 },
        ],
        ...detailOverrides,
      };
    }),
  };
  render(<AccessDiscovery client={client} />);
  return { client, user: userEvent.setup() };
}
test("Access table uses Operational Scope, exact read-only wording and singular/plural memberships", async () => {
  view();
  await screen.findByText("Staff 0");
  expect(
    screen.getByRole("columnheader", { name: "Operational Scope" }),
  ).toBeInTheDocument();
  for (const text of [
    "1 Department · 1 Division",
    "1 Department · 2 Divisions",
    "2 Departments · 1 Division",
    "2 Departments · 2 Divisions",
  ])
    expect(screen.getByText(text)).toBeInTheDocument();
  expect(
    screen.getByText(
      "Read-only view. Status reflects whether the staff member is active in Reqro.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Staff pages" })).toHaveClass(
    "access-pagination",
  );
});
test("Drawer is summary-first, categories and sources collapsed, with mixed contributions explained", async () => {
  const { user, client } = view();
  await user.click(
    await screen.findByRole("button", { name: "View Access for Staff 0" }),
  );
  const dialog = screen.getByRole("dialog", { name: "View Access" });
  await within(dialog).findByRole("heading", { name: "Access Overview" });
  const summary = within(dialog).getByRole("region", {
    name: "Access Overview",
  });
  expect(summary).toHaveTextContent("Permissions2 permissions");
  expect(summary).toHaveTextContent("Access AdministratorNo");
  expect(summary).toHaveTextContent("Assigned from multiple sources");
  expect(
    within(dialog).getByRole("heading", {
      name: "What This Staff Member Can Do",
    }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("heading", { name: "How Access Is Assigned" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("heading", { name: "Departments & Divisions" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("heading", { name: "Recent Access Changes" }),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Public Works")).toHaveTextContent(
    /^Public Works$/,
  );
  expect(within(dialog).getByText("Former Operations")).toHaveTextContent(
    "Inactive",
  );
  expect(
    within(dialog).queryByText(/Department active|Division active/),
  ).not.toBeInTheDocument();
  const administration = within(dialog)
    .getByText("Administration")
    .closest("details");
  expect(administration.open).toBe(false);
  await user.click(administration.querySelector("summary"));
  expect(
    within(administration).getByText(
      "View staff access settings and access history.",
    ),
  ).toBeVisible();
  const category = within(dialog)
    .getByText("Sensitive Information")
    .closest("details");
  expect(category.open).toBe(false);
  expect(
    within(dialog).getByText(
      "Assigned outside Access & Permissions — 2 permissions",
    ),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText("Assigned in Access & Permissions — 1 permission"),
  ).toBeInTheDocument();
  const source = within(dialog).getByText("View assignment details");
  expect(source.closest("details").open).toBe(false);
  await user.click(category.querySelector("summary"));
  expect(category.open).toBe(true);
  expect(within(category).getByText("Read protected contact.")).toBeVisible();
  expect(within(category).getByText("Sensitive access")).toBeVisible();
  expect(
    within(category).queryByText("Set up by administrator"),
  ).not.toBeInTheDocument();
  expect(within(category).getByText("contact")).not.toBeVisible();
  await user.click(within(category).getByText("Details"));
  expect(within(category).getByText("View configuration")).toBeVisible();
  await user.click(source);
  expect(
    within(dialog).getByText(/only once in effective permissions/),
  ).toBeVisible();
  expect(within(dialog).getByText(/2 contributing roles/)).toBeVisible();
  expect(client.get.mock.calls.some(([url]) => url.includes("/history"))).toBe(
    false,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "View Access History" }),
  );
  await within(dialog).findByText(
    /No access changes have been recorded by Reqro/,
  );
  expect(
    within(dialog).queryByRole("button", {
      name: /Grant|Revoke|Save Changes|Configure Access/,
    }),
  ).not.toBeInTheDocument();
});
test("Drawer focuses its heading and closing restores the invoking action", async () => {
  const { user } = view();
  const trigger = await screen.findByRole("button", {
    name: "View Access for Staff 0",
  });
  await user.click(trigger);
  const heading = await screen.findByRole("heading", { name: "View Access" });
  expect(heading).toHaveFocus();
  // Native summary keyboard activation requires browser UAT; jsdom does not implement it.
  await user.click(screen.getByRole("button", { name: "Close configuration" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});
test("Uniform source stays in the overview and Details, without repeated badges or exposed keys", async () => {
  const { user } = view({
    contributions: [
      { key: "config", existing: true, managed: false, sourceCount: 1 },
      { key: "contact", existing: true, managed: false, sourceCount: 1 },
    ],
  });
  await user.click(
    await screen.findByRole("button", { name: "View Access for Staff 0" }),
  );
  const dialog = screen.getByRole("dialog", { name: "View Access" });
  const category = (
    await within(dialog).findByText("Sensitive Information")
  ).closest("details");
  expect(within(category).getByText("1 permission")).toBeVisible();
  await user.click(category.querySelector("summary"));
  expect(
    category.querySelectorAll(".access-permission-heading .badge"),
  ).toHaveLength(1);
  expect(within(category).getByText("Sensitive access")).toBeVisible();
  expect(within(category).getByText("contact")).not.toBeVisible();
  await user.click(within(category).getByText("Details"));
  for (const label of ["Permission key", "Requires", "Access assigned"])
    expect(within(category).getByText(label)).toBeVisible();
  expect(within(category).getByText("contact")).toBeVisible();
  expect(
    within(category).getByText("Assigned outside Access & Permissions"),
  ).toBeVisible();
  expect(
    within(category).getByText(/not managed through Access & Permissions/),
  ).toBeVisible();
  expect(
    within(dialog).queryByText(/These descriptions do not grant access/),
  ).not.toBeInTheDocument();
});
