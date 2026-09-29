import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import InternalRequestWorkspace from "../src/staff/requests/InternalRequestWorkspace.jsx";

// jsdom does not implement CSS Grid track sizing, so these tests deliberately verify
// only what it can establish truthfully: the declared stylesheet rules, and the DOM
// composition that made the row coupling observable. The rendered vertical gap between
// Request Details and Additional Information is geometry and is measured in a real
// browser, not here.

vi.mock("../src/auth/AuthContext.jsx", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    account: { homeAccountId: "fictional-session" },
  }),
}));

const id = "10000000-0000-4000-8000-000000000001";
const css = readFileSync("react/src/staff/requests/staffRequests.css", "utf8");
/** The desktop two-column block, isolated by brace balance from its @media rule. */
const desktopBlock = (() => {
  const start = css.indexOf("@media (min-width: 1200px) {");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && (depth -= 1) === 0)
      return css.slice(start, i + 1);
  }
  throw new Error("unbalanced desktop media block");
})();
const declaration = (selector, block = desktopBlock) => {
  const match = block.match(
    new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`),
  );
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
};

test("F058.3 desktop row sizing keeps the trailing column-1 row flexible", () => {
  const layout = declaration(".request-workspace-layout");
  expect(layout).toContain("grid-template-rows: auto auto 1fr");
  // The previous `none` let grid split the spanning controls column's excess height
  // into row 2, which opened the gap under Request Details.
  expect(layout).not.toContain("grid-template-rows: none");
  expect(layout).toContain(
    "grid-template-columns: minmax(0, 1.7fr) minmax(22rem, 1fr)",
  );
});

test("F058.3 desktop placement of both columns is unchanged", () => {
  expect(declaration(".request-details")).toBe("grid-column: 1; grid-row: 2;");
  expect(declaration(".request-column-controls")).toBe(
    "grid-column: 2; grid-row: 2 / span 2;",
  );
  expect(declaration(".request-column-content")).toBe(
    "grid-column: 1; grid-row: 3;",
  );
  expect(declaration(".request-overview")).toBe("grid-column: 1 / -1;");
});

test("F058.3 columns stay top-aligned and the stale taller-side claim is gone", () => {
  // align-items/align-self keep each column at the top of its area, so neither
  // column's height can stretch the other's cards.
  expect(declaration(".request-workspace-layout", css)).toContain(
    "align-items: start",
  );
  expect(declaration(".request-column", css)).toContain("align-self: start");
  expect(css).not.toContain("The content stack is always the taller side");
  expect(desktopBlock).not.toMatch(/\border\s*:/);
});

test("F058.3 no CSS order property reorders the workspace columns or their cards", () => {
  for (const selector of [
    ".request-workspace-layout",
    ".request-column",
    ".request-column-controls",
    ".request-column-content",
    ".request-details",
    ".request-overview",
  ])
    expect(declaration(selector, css) ?? "").not.toMatch(/\border\s*:/);
});

const row = (overrides = {}) => ({
  serviceRequestId: id,
  audience: "public",
  referenceNumber: "TEST-0001",
  issueName: "Fictional street repair",
  categoryName: "Roads & Streets",
  description: "Fictional description",
  status: "in_progress",
  revision: 4,
  departmentId: "fictional-department",
  departmentName: "Public Works",
  divisionName: "Streets",
  serviceLocation: "Fictional test location",
  createdAt: "2026-09-26T12:00:00Z",
  updatedAt: "2026-09-26T12:00:00Z",
  assignment: null,
  requesterIdentity: "identified",
  canReadContact: true,
  canReadRequesterHistory: true,
  ...overrides,
  capabilities: {
    canReadAnswers: true,
    canReadNotes: true,
    canCreateNotes: true,
    canReadCommunications: true,
    canCreateCommunication: true,
    workflowActions: ["hold", "close"],
    canManageRequesterTracking: false,
    ...overrides.capabilities,
  },
});
const page = { items: [], nextCursor: null, page: 1, pageSize: 5, total: 0 };
const narrativeEvents = {
  items: [
    {
      id: "e1",
      type: "placed_on_hold",
      narrative: "Waiting for replacement part.",
      occurredAt: "2026-09-26T14:32:00Z",
      actorDisplay: "Staff member",
      fromStatus: "in_progress",
      toStatus: "on_hold",
    },
    {
      id: "e2",
      type: "request_closed",
      narrative: "Damaged sign replaced and inspected.",
      occurredAt: "2026-09-26T13:10:00Z",
      actorDisplay: "Staff member",
      fromStatus: "in_progress",
      toStatus: "closed",
    },
    {
      id: "e3",
      type: "request_routed",
      narrative: null,
      occurredAt: "2026-09-26T12:40:00Z",
      actorDisplay: "Staff member",
      fromStatus: null,
      toStatus: null,
      fromDepartment: "Facilities",
      toDepartment: "Public Works",
      toDivision: "District A",
    },
  ],
  page: 1,
  pageSize: 5,
  hasPreviousPage: false,
  hasNextPage: false,
};
function repo(overrides = {}) {
  const detail = overrides.row ?? row();
  return {
    detail: vi.fn().mockResolvedValue(detail),
    options: vi.fn().mockResolvedValue({ departments: [], divisions: [] }),
    list: vi
      .fn()
      .mockResolvedValue({ ...page, pageSize: 25, items: [detail], total: 1 }),
    contact: vi.fn().mockResolvedValue({ name: "Fictional protected person" }),
    readAnswers: vi.fn().mockResolvedValue({ answers: [] }),
    requesterHistory: vi.fn(),
    targets: vi.fn(),
    notes: vi.fn().mockResolvedValue(page),
    communications: vi.fn().mockResolvedValue(page),
    activity: vi.fn().mockResolvedValue(overrides.activity ?? page),
    watchers: vi.fn().mockResolvedValue(page),
    trackingState: vi.fn(),
    attachments: {
      policy: vi
        .fn()
        .mockResolvedValue({ enabled: overrides.evidence ?? true }),
      evidence: vi.fn().mockResolvedValue([]),
    },
  };
}
const show = (repository) =>
  render(
    <MemoryRouter initialEntries={[`/staff/requests/${id}`]}>
      <Routes>
        <Route
          path="/staff/requests/:requestId"
          element={<InternalRequestWorkspace repository={repository} />}
        />
      </Routes>
    </MemoryRouter>,
  );

test("F058.3 sparse left column still renders both columns as independent siblings", async () => {
  // The SR-202609-000013 shape: every optional left-column card is absent, so the
  // content row has no intrinsic height while the controls column stays tall.
  const repository = repo({
    row: row({
      description: "Short.",
      serviceLocation: null,
      capabilities: {
        canReadAnswers: false,
        canReadNotes: false,
        canCreateNotes: false,
        canReadCommunications: false,
        canCreateCommunication: false,
      },
    }),
    evidence: false,
    activity: narrativeEvents,
  });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Recent Activity" });
  const layout = container.querySelector(".request-workspace-layout");
  expect([...layout.children].map((el) => el.className)).toEqual([
    "ui-card request-overview",
    "ui-card request-details",
    "request-column request-column-controls",
    "request-column request-column-content",
  ]);
  const content = container.querySelector(".request-column-content");
  const controls = container.querySelector(".request-column-controls");
  // The trigger composition: an empty content column beside a populated controls column.
  // Request Evidence renders a loading card first, so wait for it to settle to null.
  await waitFor(() => expect(content.children).toHaveLength(0));
  expect(controls.children.length).toBeGreaterThan(1);
  expect(controls.contains(content)).toBe(false);
  expect(content.contains(controls)).toBe(false);
  // Request Details collapses to Description alone when Service Location is absent.
  const details = container.querySelector(".request-details");
  expect(within(details).queryByText("Service Location")).toBeNull();
  expect(within(details).getByText("Description")).toBeInTheDocument();
  // No inline height couples any card to the opposite column.
  for (const card of [...controls.children, ...layout.children])
    expect(card.style.height).toBe("");
});

test.each(["public", "internal"])(
  "F058.3 %s composition keeps accepted section order and Recent Activity last in the controls column",
  async (audience) => {
    const repository = repo({
      row: row({ audience }),
      activity: narrativeEvents,
    });
    const { container } = show(repository);
    await screen.findByRole("heading", { name: "Recent Activity" });
    const layout = container.querySelector(".request-workspace-layout");
    expect(
      [...layout.querySelectorAll("h3")].map((el) => el.textContent.trim()),
    ).toEqual([
      "Overview",
      "Request Details",
      "Actions",
      "Request Management",
      "Recent Activity",
      "Additional Information",
      "Request Evidence",
      "Collaboration",
    ]);
    const controls = container.querySelector(".request-column-controls");
    const classes = [...controls.children].map((el) => el.className);
    expect(classes.at(-1)).toBe("ui-card request-history");
    expect(classes.indexOf("ui-card request-management")).toBe(
      classes.length - 2,
    );
    expect(
      [...container.querySelector(".request-column-content").children].map(
        (el) => el.className,
      ),
    ).toEqual([
      "ui-card submitted-information",
      "ui-card request-evidence",
      "ui-card request-collaboration",
    ]);
  },
);

test("F058.3 Activity narrative cards and the routed event are unchanged in the sidebar", async () => {
  const repository = repo({ activity: narrativeEvents });
  const { container } = show(repository);
  await screen.findByText("Waiting for replacement part.");
  const preview = container.querySelector(
    ".request-column-controls .request-activity-preview",
  );
  expect(preview).not.toBeNull();
  const cards = preview.querySelectorAll(".activity-narrative-card");
  expect(
    [...cards].map((el) => el.querySelector("strong").textContent),
  ).toEqual(["Reason", "Resolution"]);
  expect(cards[0].querySelector(".activity-narrative")).toHaveTextContent(
    "Waiting for replacement part.",
  );
  const routed = within(preview)
    .getByRole("heading", { name: "Request routed" })
    .closest(".activity-item");
  expect(routed).toHaveClass("tone-routing");
  expect(routed.querySelector(".activity-marker i")).toHaveClass(
    "bi-signpost-split",
  );
  expect(routed).toHaveTextContent("To Public Works / District A");
  expect(routed.querySelector(".activity-narrative-card")).toBeNull();
});

test("F058.3 layout correction introduces no additional protected reads", async () => {
  const repository = repo({ activity: narrativeEvents });
  show(repository);
  await screen.findByRole("heading", { name: "Recent Activity" });
  for (const method of ["detail", "options", "watchers", "activity"])
    expect(repository[method]).toHaveBeenCalledTimes(1);
  expect(repository.activity).toHaveBeenCalledWith(
    id,
    1,
    expect.any(AbortSignal),
    5,
  );
  expect(repository.contact).not.toHaveBeenCalled();
  expect(repository.requesterHistory).not.toHaveBeenCalled();
});
