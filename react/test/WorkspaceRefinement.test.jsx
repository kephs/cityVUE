import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Routes,
  Route,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { expect, test, vi } from "vitest";
import InternalRequestWorkspace from "../src/staff/requests/InternalRequestWorkspace.jsx";

vi.mock("../src/auth/AuthContext.jsx", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    account: { homeAccountId: "fictional-session" },
  }),
}));
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const row = (audience = "public") => ({
  serviceRequestId: id,
  audience,
  referenceNumber: "TEST-0001",
  issueName: "Fictional street repair",
  categoryName: "Roads & Streets",
  description: "Fictional description",
  status: "open",
  revision: 1,
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
  capabilities: {
    canReadAnswers: true,
    canReadNotes: true,
    canCreateNotes: true,
    canReadCommunications: true,
    canCreateCommunication: true,
    workflowActions: [],
    canManageRequesterTracking: false,
  },
});
const page = { items: [], nextCursor: null, page: 1, pageSize: 5, total: 0 };
function repo(audience = "public") {
  return {
    detail: vi.fn().mockResolvedValue(row(audience)),
    options: vi.fn().mockResolvedValue({ departments: [], divisions: [] }),
    list: vi.fn().mockResolvedValue({
      ...page,
      pageSize: 25,
      items: [row(audience)],
      total: 1,
    }),
    contact: vi.fn().mockResolvedValue({
      name: "Fictional protected person",
      email: "fictional@example.test",
    }),
    readAnswers: vi.fn().mockResolvedValue({ answers: [] }),
    requesterHistory: vi.fn(),
    targets: vi.fn(),
    notes: vi.fn().mockResolvedValue(page),
    communications: vi.fn().mockResolvedValue(page),
    activity: vi.fn().mockResolvedValue(page),
    watchers: vi.fn().mockResolvedValue(page),
    trackingState: vi.fn(),
    attachments: {
      policy: vi.fn().mockResolvedValue({ enabled: true }),
      evidence: vi.fn().mockResolvedValue([]),
    },
  };
}
function Navigation() {
  const navigate = useNavigate(),
    location = useLocation();
  return (
    <>
      <button onClick={() => navigate(`/staff/requests/${other}`)}>
        Open other request
      </button>
      <output aria-label="Current URL">
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}
function show(repository, path = `/staff/requests/${id}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Navigation />
      <Routes>
        <Route
          path="/staff/requests"
          element={<InternalRequestWorkspace repository={repository} />}
        />
        <Route
          path="/staff/requests/:requestId"
          element={<InternalRequestWorkspace repository={repository} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
test.each(["public", "internal"])(
  "F058.2B %s initial request-count baseline preserves explicit protected reads",
  async (audience) => {
    const repository = repo(audience);
    show(repository);
    await screen.findByText("No attachments");
    await screen.findByText(
      audience === "public"
        ? "No messages have been added."
        : "No internal notes have been added.",
    );
    for (const method of ["detail", "options", "watchers", "activity"])
      expect(repository[method]).toHaveBeenCalledTimes(1);
    expect(repository.activity).toHaveBeenCalledWith(
      id,
      1,
      expect.any(AbortSignal),
      5,
    );
    expect(repository.attachments.policy).toHaveBeenCalledTimes(2);
    expect(repository.attachments.evidence).toHaveBeenCalledTimes(1);
    expect(
      repository[audience === "public" ? "communications" : "notes"],
    ).toHaveBeenCalledTimes(1);
    expect(
      repository[audience === "public" ? "notes" : "communications"],
    ).not.toHaveBeenCalled();
    for (const method of [
      "contact",
      "readAnswers",
      "requesterHistory",
      "targets",
      "trackingState",
    ])
      expect(repository[method]).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/Fictional protected person/),
    ).not.toBeInTheDocument();
  },
);
test("F058.2B bounded list baseline makes no detail or protected-child calls", async () => {
  const repository = repo();
  show(repository, "/staff/requests");
  await screen.findByText("Fictional street repair");
  expect(repository.list).toHaveBeenCalledTimes(1);
  expect(repository.options).toHaveBeenCalledTimes(1);
  for (const method of [
    "detail",
    "contact",
    "readAnswers",
    "notes",
    "communications",
    "activity",
    "watchers",
    "targets",
  ])
    expect(repository[method]).not.toHaveBeenCalled();
});

test.each(["public", "internal"])(
  "F058.2B %s uses logical section order and preserves Collaboration guidance",
  async (audience) => {
    const { container } = show(repo(audience));
    await screen.findByText("No attachments");
    const layout = container.querySelector(".request-workspace-layout");
    const sections = [...layout.children];
    expect(sections.map((el) => el.className)).toEqual([
      "ui-card request-overview",
      "ui-card request-details",
      "request-column request-column-controls",
      "request-column request-column-content",
    ]);
    expect(
      [...layout.querySelectorAll("h3")].map((el) => el.textContent.trim()),
    ).toEqual([
      "Overview",
      "Request Details",
      "Request Management",
      "Recent Activity",
      "Additional Information",
      "Request Evidence",
      "Collaboration",
    ]);
    for (const name of ["Request Evidence", "Collaboration"])
      expect(sections[3]).toContainElement(
        screen.getByRole("heading", { name }),
      );
    expect(sections[3]).toContainElement(
      screen.getByRole("button", { name: "View Additional Information" }),
    );
    // UAT decision: Recent Activity sits in the right column below Management.
    expect(sections[2]).toContainElement(
      screen.getByRole("heading", { name: "Recent Activity" }),
    );
    expect(sections[2]).toContainElement(
      screen.getByRole("button", { name: "View requester contact" }),
    );
    expect(sections[2]).toHaveTextContent("Unassigned");
    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual(
      audience === "public"
        ? ["Requester Communication", "Internal Notes"]
        : ["Internal Notes", "Requester Communication"],
    );
    if (audience === "internal")
      expect(sections[0]).toHaveTextContent(
        "Visible only to authorized staff.",
      );
    else
      expect(
        screen.getByRole("complementary", {
          name: "About Requester Communication",
        }),
      ).toHaveTextContent("does not currently send them to the requester");
  },
);

test.each(["contact", "answers", "communication", "activity"])(
  "F058.2B request switch aborts late %s data and closes request-specific disclosures",
  async (kind) => {
    const repository = repo();
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const method = {
      contact: "contact",
      answers: "readAnswers",
      communication: "communications",
      activity: "activity",
    }[kind];
    if (kind === "activity")
      repository.activity
        .mockResolvedValueOnce(page)
        .mockReturnValueOnce(pending);
    else repository[method].mockReturnValueOnce(pending);
    show(repository);
    await screen.findByRole("heading", { name: "Fictional street repair" });
    if (kind === "contact")
      fireEvent.click(
        screen.getByRole("button", { name: "View requester contact" }),
      );
    if (kind === "answers")
      fireEvent.click(
        screen.getByRole("button", { name: "View Additional Information" }),
      );
    if (kind === "activity")
      fireEvent.click(
        screen.getByRole("button", { name: "View full activity" }),
      );
    await waitFor(() => expect(repository[method]).toHaveBeenCalled());
    const call = repository[method].mock.lastCall;
    const signal =
      kind === "answers"
        ? call[1].signal
        : call.find((arg) => arg instanceof AbortSignal);
    repository.detail.mockResolvedValue({
      ...row(),
      serviceRequestId: other,
      issueName: "Fictional second request",
    });
    fireEvent.click(screen.getByRole("button", { name: "Open other request" }));
    await screen.findByRole("heading", { name: "Fictional second request" });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(
        kind === "contact"
          ? { name: "Late protected value", email: "late@example.test" }
          : kind === "answers"
            ? {
                answers: [
                  {
                    questionId: "test",
                    label: "Late protected value",
                    displayValue: "Late protected value",
                  },
                ],
              }
            : {
                ...page,
                items: [
                  {
                    id,
                    body: "Late protected value",
                    type: "request_created",
                    author: { displayName: "Late protected value" },
                    createdAt: row().createdAt,
                  },
                ],
              },
      ),
    );
    expect(screen.queryByText(/Late protected value/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

test("F058.2B Manage Request and Back preserve every existing list query parameter", async () => {
  const repository = repo();
  const query =
    "q=repair&search=TEST&audience=public&view=mine&assignment=assigned&status=open&departmentId=fictional-department&divisionId=fictional-division&sort=issue&direction=asc&page=2&pageSize=50";
  repository.list.mockResolvedValue({
    ...page,
    items: [row()],
    total: 75,
    page: 2,
    pageSize: 50,
    hasPreviousPage: true,
  });
  show(repository, "/staff/requests?" + query);
  fireEvent.click(await screen.findByRole("link", { name: /Manage Request:/ }));
  await screen.findByRole("heading", { name: "Fictional street repair" });
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    `/staff/requests/${id}?${query}`,
  );
  fireEvent.click(
    screen.getByRole("link", { name: /Back to Service Requests/ }),
  );
  await screen.findByRole("link", { name: /Manage Request:/ });
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "/staff/requests?" + query,
  );
  expect(repository.list.mock.lastCall[0]).toMatchObject({
    q: "repair",
    search: "TEST",
    audience: "public",
    view: "mine",
    assignment: "assigned",
    status: "open",
    departmentId: "fictional-department",
    divisionId: "fictional-division",
    sort: "issue",
    direction: "asc",
    page: 2,
    pageSize: 50,
  });
});

test("F058.2B mobile cards reuse list data and viewport changes do not refetch", async () => {
  const previous = window.matchMedia;
  let change;
  const media = {
    matches: true,
    addEventListener: (_, callback) => {
      change = callback;
    },
    removeEventListener: vi.fn(),
  };
  window.matchMedia = () => media;
  try {
    const repository = repo();
    const view = show(repository, "/staff/requests");
    const results = await screen.findByRole("list", {
      name: "Service Request results",
    });
    expect(within(results).getAllByRole("article")).toHaveLength(1);
    expect(
      within(results).getByRole("link", { name: /Manage Request:/ }),
    ).toHaveAttribute("href", `/staff/requests/${id}`);
    expect(screen.queryByRole("table")).toBeNull();
    act(() => {
      media.matches = false;
      change();
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Service Request results" }),
    ).toBeNull();
    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(repository.detail).not.toHaveBeenCalled();
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  } finally {
    window.matchMedia = previous;
  }
});

test.each([undefined, 500])(
  "F058.2B uncertain lifecycle result (%s) gives factual guidance and read-only retry",
  async (status) => {
    const repository = repo();
    repository.detail.mockResolvedValue({
      ...row(),
      capabilities: { ...row().capabilities, workflowActions: ["start_work"] },
    });
    repository.workflow = vi
      .fn()
      .mockRejectedValue(
        status ? { status } : new Error("Fictional network failure"),
      );
    show(repository);
    fireEvent.click(await screen.findByRole("button", { name: "Start Work" }));
    await screen.findByText(
      "We couldn't confirm the result. Check the latest request details before trying again.",
    );
    expect(repository.workflow).toHaveBeenCalledTimes(1);
    expect(repository.detail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Fictional street repair" });
    expect(repository.detail).toHaveBeenCalledTimes(2);
    expect(repository.workflow).toHaveBeenCalledTimes(1);
  },
);

test.each([
  [false, true],
  [false, false],
  [true, true],
  [true, false],
])(
  "review correction: compact=%s location=%s retains both links and bounded context",
  async (compact, hasLocation) => {
    const previous = window.matchMedia;
    window.matchMedia = () => ({
      matches: compact,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    try {
      const repository = repo();
      repository.list.mockResolvedValue({
        ...page,
        total: 1,
        pageSize: 25,
        items: [
          {
            ...row(),
            serviceLocation: hasLocation ? "123 Fictional Lane" : null,
          },
        ],
      });
      show(repository, "/staff/requests?q=repair");
      const issue = await screen.findByRole("link", {
        name: "Fictional street repair",
      });
      const manage = screen.getByRole("link", { name: /Manage Request:/ });
      expect(issue).toHaveAttribute("href", manage.getAttribute("href"));
      expect(issue.getAttribute("href")).toContain("?q=repair");
      const result = compact ? issue.closest("article") : issue.closest("tr");
      const reference = within(result).getByText("TEST-0001");
      if (hasLocation) {
        const location = within(result).getByText("123 Fictional Lane");
        // Cards keep the reference inline; the table gives it its own column.
        const [first, second] = compact
          ? [reference, location]
          : [location, reference];
        expect(
          first.compareDocumentPosition(second) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      } else expect(result.querySelector(".ui-location")).toBeNull();
      expect(repository.list).toHaveBeenCalledTimes(1);
      expect(repository.options).toHaveBeenCalledTimes(1);
      expect(repository.detail).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = previous;
    }
  },
);

test("F058.2B Actions holds capability-driven lifecycle plus a full-width Route Request", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({
    ...row(),
    capabilities: {
      ...row().capabilities,
      canAssign: true,
      canRoute: true,
      workflowActions: ["start_work", "close"],
    },
  });
  const { container } = show(repository);
  const start = await screen.findByRole("button", { name: "Start Work" });
  const actions = container.querySelector(".request-actions");
  expect(
    within(actions).getByRole("heading", { name: "Actions" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Work" })).toBeNull();
  expect(actions.querySelector(".bi-lightning-charge")).toBeInTheDocument();
  const lifecycle = actions.querySelector(".request-action-buttons");
  expect([...lifecycle.children].map((el) => el.textContent.trim())).toEqual([
    "Start Work",
    "Close Request",
  ]);
  expect(start.parentElement).toBe(lifecycle);
  const route = within(actions).getByRole("button", { name: "Route Request" });
  expect(route).toHaveClass("request-route-action");
  expect(route.parentElement).toBe(actions);
  expect(route.querySelector(".bi-signpost-split")).toBeInTheDocument();
  expect(
    lifecycle.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const management = container.querySelector(".request-management");
  expect(
    actions.compareDocumentPosition(management) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(container.querySelector(".request-work")).toBeNull();
  expect(container.querySelector(".request-requester")).toBeNull();
});

test("F058.2B Actions adapts to the authorized actions and never manufactures them", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({
    ...row(),
    status: "in_progress",
    capabilities: {
      ...row().capabilities,
      canRoute: false,
      workflowActions: ["hold", "close", "start_work"],
    },
  });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Actions" });
  expect(
    [...container.querySelectorAll(".request-action-buttons > button")].map(
      (el) => el.textContent.trim(),
    ),
  ).toEqual(["Place on Hold", "Close Request"]);
  expect(screen.queryByRole("button", { name: "Start Work" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Route Request" })).toBeNull();
});

test("F058.2B no authorized action removes the Actions card but keeps Request Management", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({
    ...row(),
    capabilities: {
      ...row().capabilities,
      canRoute: false,
      canAssign: false,
      workflowActions: [],
    },
  });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Request Management" });
  expect(container.querySelector(".request-actions")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Start Work|Route Request/ }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Manage assignment" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Manage watchers" }),
  ).toBeInTheDocument();
});

test("F058.2B Request Management keeps its row order and protected access boundaries", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({
    ...row(),
    capabilities: {
      ...row().capabilities,
      canAssign: true,
      canManageRequesterTracking: true,
    },
  });
  repository.trackingState = vi
    .fn()
    .mockResolvedValue({ status: "not_issued", version: "fictional" });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Request Management" });
  const management = container.querySelector(".request-management");
  expect(
    [...management.querySelectorAll(".request-management-row h4")].map(
      (el) => el.textContent,
    ),
  ).toEqual([
    "Assignment",
    "Watchers",
    "Requester Contact",
    "Request Tracker",
    "Requester History",
  ]);
  expect(
    within(management)
      .getByRole("button", { name: "Manage assignment" })
      .closest(".request-management-row"),
  ).toHaveTextContent("Unassigned");
  expect(
    within(management)
      .getByRole("button", { name: "View requester contact" })
      .closest(".request-management-row"),
  ).toHaveTextContent("Separate, audited access");
  expect(
    await screen.findByText(
      "Not issued · Manage secure request tracking access",
    ),
  ).toBeInTheDocument();
  expect(management.textContent).not.toMatch(/tracking link/i);
  expect(repository.contact).not.toHaveBeenCalled();
  expect(repository.requesterHistory).not.toHaveBeenCalled();
});

test("F058.2B Intake Channel is projected into the upper Issue metadata row", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({ ...row(), intakeChannel: "api" });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Fictional street repair" });
  const meta = container.querySelector(".request-identity-meta");
  expect(
    [...meta.children].map((el) => el.textContent.replace(/\s+/g, " ").trim()),
  ).toEqual(["Request # TEST-0001", "Public", "Intake Channel: API", "Open"]);
  expect(container.querySelector(".request-management")).not.toHaveTextContent(
    "Intake Channel:",
  );
  expect(repository.detail).toHaveBeenCalledTimes(1);
});

test("F058.2B absent Intake Channel leaves the metadata row unchanged", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({ ...row(), intakeChannel: null });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Fictional street repair" });
  expect(
    container.querySelector(".request-identity-meta .request-channel"),
  ).toBeNull();
  expect(container.querySelector(".request-identity-meta")).toHaveTextContent(
    "TEST-0001",
  );
});

test("F058.2B left column stacks independently of the Actions column", async () => {
  const { container } = show(repo());
  await screen.findByText("No attachments");
  const controls = container.querySelector(".request-column-controls");
  const content = container.querySelector(".request-column-content");
  expect([...controls.children].map((el) => el.className)).toEqual([
    "ui-card request-management",
    "ui-card request-history",
  ]);
  expect([...content.children].map((el) => el.className)).toEqual([
    "ui-card submitted-information",
    "ui-card request-evidence",
    "ui-card request-collaboration",
  ]);
  expect(controls.contains(content)).toBe(false);
  expect(content.contains(controls)).toBe(false);
  expect(controls.querySelector(".request-details")).toBeNull();
  expect(content.querySelector(".request-details")).toBeNull();
  // No card may be height-coupled to the opposite column.
  for (const card of [...controls.children, ...content.children])
    expect(card.style.height).toBe("");
});

test("F058.2B Additional Information stays an explicit protected read", async () => {
  const repository = repo();
  repository.readAnswers.mockResolvedValue({
    answers: [
      {
        questionId: "fictional",
        label: "Fictional prompt",
        displayValue: "Fictional protected answer",
      },
    ],
  });
  const { container } = show(repository);
  const card = await screen.findByRole("region", {
    name: "Additional Information",
  });
  expect(
    within(card).getByRole("heading", { name: "Additional Information" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Submitted Information")).toBeNull();
  expect(repository.readAnswers).not.toHaveBeenCalled();
  fireEvent.click(
    within(card).getByRole("button", { name: "View Additional Information" }),
  );
  await within(card).findByText("Fictional protected answer");
  expect(repository.readAnswers).toHaveBeenCalledTimes(1);
  expect(
    within(card).getByRole("button", {
      name: "Refresh additional information",
    }),
  ).toBeInTheDocument();
  expect(container.querySelector(".request-details")).not.toContainElement(
    card,
  );
});

test.each([
  [1, 25, 1],
  [2, 25, 26],
  [3, 50, 101],
  [2, 100, 101],
])(
  "row positions use response page %s / size %s (starting at %s), never request identity",
  async (responsePage, pageSize, first) => {
    const repository = repo();
    repository.list.mockResolvedValue({
      ...page,
      page: responsePage,
      pageSize,
      total: 250,
      items: [
        row(),
        {
          ...row(),
          serviceRequestId: other,
          issueName: "Fictional second request",
        },
      ],
    });
    // Deliberately different from the normalized response: the URL is not the numbering authority.
    show(repository, "/staff/requests?page=4&pageSize=25");
    const issue = await screen.findByRole("link", {
      name: "Fictional street repair",
    });
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent(
      "#",
    );
    expect(
      [...table.querySelectorAll("tbody .request-row-number")].map(
        (el) => el.textContent,
      ),
    ).toEqual([String(first), String(first + 1)]);
    const result = issue.closest("tr");
    expect(within(result).getByText("TEST-0001")).toBeInTheDocument();
    expect(
      within(result).getByText("Fictional test location"),
    ).toBeInTheDocument();
    expect(issue).toHaveAttribute(
      "href",
      `/staff/requests/${id}?page=4&pageSize=25`,
    );
    expect(
      within(result).getByRole("link", { name: /Manage Request:/ }),
    ).toHaveAttribute("href", issue.getAttribute("href"));
    expect(repository.detail).not.toHaveBeenCalled();
    expect(repository.list).toHaveBeenCalledTimes(1);
  },
);

test.each(["public", "internal"])(
  "%s Overview uses existing category and truthful audience guidance; Details has no Issue context",
  async (audience) => {
    const repository = repo(audience);
    const { container } = show(repository);
    await screen.findByText("No attachments");
    const overview = container.querySelector(".request-overview");
    expect(
      [...overview.querySelectorAll("dt")].map((el) => el.textContent),
    ).toEqual([
      "Department / Division",
      "Service Category",
      "Assigned to",
      "Reported",
    ]);
    for (const value of [
      "Roads & Streets",
      "Public Works",
      "Streets",
      "Unassigned",
    ])
      expect(overview).toHaveTextContent(value);
    const notice = overview.querySelector(".request-audience-notice");
    expect(notice).toHaveTextContent(
      audience === "public" ? "Public Request" : "Internal Request",
    );
    expect(notice).toHaveTextContent(
      audience === "public"
        ? "This request is part of the public service request workflow."
        : "Visible only to authorized staff.",
    );
    expect(notice).not.toHaveTextContent(
      /publicly visible|visible to the requester|sent to the requester/i,
    );
    const details = container.querySelector(".request-details");
    expect(details).not.toHaveTextContent(/Issue context|Service Category/);
    expect(details).toHaveTextContent("Service Location");
    expect(repository.detail).toHaveBeenCalledTimes(1);
    expect(repository.readAnswers).not.toHaveBeenCalled();
    expect(repository.contact).not.toHaveBeenCalled();
  },
);

test("F058.2B single-column DOM keeps a logical mobile and keyboard reading order", async () => {
  const repository = repo();
  repository.detail.mockResolvedValue({
    ...row(),
    capabilities: {
      ...row().capabilities,
      canAssign: true,
      canRoute: true,
      workflowActions: ["start_work", "close"],
    },
  });
  const { container } = show(repository);
  await screen.findByText("No attachments");
  const layout = container.querySelector(".request-workspace-layout");
  const landmarks = [
    ".request-overview",
    ".request-details",
    ".request-actions",
    ".request-management",
    ".request-history",
    ".submitted-information",
    ".request-evidence",
    ".request-collaboration",
  ].map((selector) => layout.querySelector(selector));
  expect(landmarks.every(Boolean)).toBe(true);
  for (let index = 1; index < landmarks.length; index += 1)
    expect(
      landmarks[index - 1].compareDocumentPosition(landmarks[index]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  const focusable = [
    ...layout.querySelectorAll("button, a[href], [tabindex]"),
  ].filter((el) => !el.disabled);
  const at = (selector) =>
    focusable.findIndex((el) => el.closest(selector) !== null);
  expect(at(".request-issue-title")).toBe(0);
  expect(at(".request-actions")).toBeLessThan(at(".request-management"));
  expect(at(".request-management")).toBeLessThan(at(".request-history"));
  expect(at(".request-history")).toBeLessThan(at(".submitted-information"));
  expect(at(".submitted-information")).toBeLessThan(
    at(".request-collaboration"),
  );
});

test("F058.2B desktop results use the approved column order and a dedicated Request #", async () => {
  const repository = repo();
  repository.list.mockResolvedValue({
    ...page,
    items: [row()],
    total: 60,
    page: 2,
    pageSize: 25,
  });
  show(repository, "/staff/requests");
  const table = await screen.findByRole("table");
  expect(
    [...table.querySelectorAll("thead th")].map((el) =>
      el.textContent.replace(/[\u2191\u2193\u2195]/g, "").trim(),
    ),
  ).toEqual([
    "#",
    "Issue",
    "Request #",
    "Audience",
    "Status",
    "Department / Division",
    "Assigned to",
    "Reported",
    "Action",
  ]);
  const cells = [...table.querySelectorAll("tbody tr:first-child > *")];
  expect(cells[0]).toHaveClass("request-row-number");
  expect(cells[0]).toHaveTextContent("26");
  const issue = within(cells[1]).getByRole("link", {
    name: "Fictional street repair",
  });
  expect(issue).toHaveAttribute("href", `/staff/requests/${id}`);
  expect(
    within(cells[1]).getByText("Fictional test location"),
  ).toBeInTheDocument();
  // The reference is not duplicated inside the Issue column.
  expect(cells[1].querySelector(".ui-reference")).toBeNull();
  expect(cells[2]).toHaveClass("request-reference-cell");
  expect(within(cells[2]).getByText("TEST-0001")).toBeInTheDocument();
  expect(
    within(cells[8]).getByRole("link", { name: /Manage Request:/ }),
  ).toHaveAttribute("href", issue.getAttribute("href"));
  expect(repository.detail).not.toHaveBeenCalled();
  expect(repository.list).toHaveBeenCalledTimes(1);
});

test("F058.2B row numbering stays presentation-only across pagination", async () => {
  const repository = repo();
  repository.list.mockResolvedValue({
    ...page,
    items: [row(), { ...row(), serviceRequestId: other, issueName: "Second" }],
    total: 400,
    page: 4,
    pageSize: 50,
  });
  show(repository, "/staff/requests?page=1&pageSize=25");
  await screen.findByRole("table");
  const numbers = [
    ...document.querySelectorAll("tbody .request-row-number"),
  ].map((el) => el.textContent);
  expect(numbers).toEqual(["151", "152"]);
  for (const link of screen.getAllByRole("link", { name: /Manage Request:/ }))
    expect(link.getAttribute("href")).not.toContain("151");
});

test("F058.2B list cards carry the human position and every established field", async () => {
  const previous = window.matchMedia;
  const queries = [];
  window.matchMedia = (query) => {
    queries.push(query);
    return {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  };
  try {
    const repository = repo();
    repository.list.mockResolvedValue({
      ...page,
      items: [row()],
      total: 400,
      page: 3,
      pageSize: 25,
    });
    show(repository, "/staff/requests");
    const card = await screen.findByRole("article");
    expect(queries).toContain("(max-width: 1199.98px)");
    expect(card.querySelector(".request-card-position")).toHaveTextContent(
      "51",
    );
    expect(
      within(card).getByRole("link", { name: "Fictional street repair" }),
    ).toBeInTheDocument();
    expect(within(card).getByText("TEST-0001")).toBeInTheDocument();
    expect(
      within(card).getByText("Fictional test location"),
    ).toBeInTheDocument();
    expect(within(card).getByText("Public")).toBeInTheDocument();
    expect(within(card).getByText("Open")).toBeInTheDocument();
    expect(
      [...card.querySelectorAll("dt")].map((el) => el.textContent),
    ).toEqual(["Department / Division", "Assigned to", "Reported"]);
    expect(
      within(card).getByRole("link", { name: /Manage Request:/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(repository.detail).not.toHaveBeenCalled();
  } finally {
    window.matchMedia = previous;
  }
});

test("F058.2B search stays primary while filters, sort and refresh are preserved", async () => {
  const repository = repo();
  show(repository, "/staff/requests");
  await screen.findByRole("table");
  const search = screen.getByLabelText(/Search Requests/);
  expect(search).toHaveAttribute(
    "placeholder",
    "Search by request #, issue, or service location",
  );
  expect(screen.getByText("Results update as you type.")).toBeInTheDocument();
  const toolbar = screen.getByRole("group", { name: "Request list controls" });
  expect(toolbar).toContainElement(search);
  for (const name of ["Sort By", "Direction"])
    expect(toolbar).toContainElement(screen.getByLabelText(name));
  expect(toolbar).toContainElement(
    screen.getByRole("button", { name: "Refresh", exact: true }),
  );
  const filters = screen.getByRole("form", { name: "Request filters" });
  expect(filters).not.toContainElement(search);
  for (const name of [
    "Audience",
    "Request View",
    "Assignment",
    "Status",
    "Department",
    "Division",
  ])
    expect(filters).toContainElement(screen.getByLabelText(name));
  for (const name of ["Clear search and filters", "Apply Filters"])
    expect(filters).toContainElement(
      screen.getByRole("button", { name, exact: true }),
    );
  expect(repository.list).toHaveBeenCalledTimes(1);
  expect(repository.options).toHaveBeenCalledTimes(1);
});

test("F058.2B list rows use the projected Issue icon, category accent and safe fallback", async () => {
  const repository = repo();
  repository.list.mockResolvedValue({
    ...page,
    total: 3,
    pageSize: 25,
    items: [
      { ...row(), issueIcon: "lightbulb", categoryId: "lighting" },
      {
        ...row(),
        serviceRequestId: other,
        issueName: "Fictional sign repair",
        issueIcon: "signpost-split",
        categoryId: "roads",
      },
      {
        ...row(),
        serviceRequestId: "10000000-0000-4000-8000-000000000003",
        issueName: "Fictional unmapped request",
        issueIcon: "<svg onload=alert(1)>",
        categoryId: "waste",
      },
    ],
  });
  const { container } = show(repository, "/staff/requests");
  await screen.findByRole("table");
  const icons = [...container.querySelectorAll("tbody .ui-issue-icon")];
  expect(
    icons.map((el) =>
      [...el.querySelector("i").classList].find((name) =>
        name.startsWith("bi-"),
      ),
    ),
  ).toEqual(["bi-lightbulb", "bi-signpost-split", "bi-file-earmark-text"]);
  expect(
    icons.map((el) =>
      [...el.classList].find((name) => name.startsWith("category-accent-")),
    ),
  ).toEqual([
    "category-accent-amber",
    "category-accent-blue",
    "category-accent-green",
  ]);
  for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector("svg")).toBeNull();
  expect(repository.detail).not.toHaveBeenCalled();
});

test.each([
  ["signpost-split", "bi-signpost-split"],
  ["cone-striped", "bi-cone-striped"],
  [null, "bi-file-earmark-text"],
])(
  "F058.2B Overview renders projected icon %s",
  async (issueIcon, expected) => {
    const repository = repo();
    repository.detail.mockResolvedValue({
      ...row(),
      issueIcon,
      categoryId: "roads",
    });
    const { container } = show(repository);
    await screen.findByRole("heading", { name: "Fictional street repair" });
    const icon = container.querySelector(".request-identity .ui-issue-icon");
    expect(icon.querySelector("i")).toHaveClass(expected);
    expect(icon).toHaveClass("ui-issue-icon--large");
    expect(icon).toHaveClass("category-accent-blue");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  },
);

test("F058.2B Recent Activity presents projected events and never manufactures a status", async () => {
  const repository = repo();
  repository.activity.mockResolvedValue({
    ...page,
    total: 2,
    items: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        type: "request_reopened",
        occurredAt: "2026-09-26T09:05:00Z",
        actorDisplay: "Staff member",
        fromStatus: "closed",
        toStatus: "open",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        type: "request_routed",
        occurredAt: "2026-09-22T08:14:00Z",
        actorDisplay: "Staff member",
        toDepartment: "Public Works",
        toDivision: "Streets",
      },
    ],
  });
  const { container } = show(repository);
  await screen.findByRole("heading", { name: "Recent Activity" });
  const timeline = container.querySelector(
    ".request-column-controls .request-history .request-activity-list",
  );
  const items = [...timeline.querySelectorAll(".activity-item")];
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveClass("tone-open");
  expect(items[0].querySelector(".activity-marker i")).toHaveClass(
    "bi-arrow-counterclockwise",
  );
  expect(
    within(items[0]).getByRole("heading", { name: "Request reopened" }),
  ).toBeInTheDocument();
  expect(items[0]).toHaveTextContent("Staff member");
  expect(items[0].querySelector("time")).toHaveAttribute(
    "dateTime",
    "2026-09-26T09:05:00Z",
  );
  expect(items[0].querySelector(".ui-status")).toHaveTextContent("Open");
  expect(items[1]).toHaveClass("tone-routing");
  expect(items[1].querySelector(".activity-marker i")).toHaveClass(
    "bi-signpost-split",
  );
  expect(items[1]).toHaveTextContent("To Public Works / Streets");
  // No projected transition, so no badge is invented for the event.
  expect(items[1].querySelector(".ui-status")).toBeNull();
  expect(
    within(container.querySelector(".request-history")).getByRole("button", {
      name: "View full activity",
    }),
  ).toBeInTheDocument();
  expect(repository.activity).toHaveBeenCalledTimes(1);
  expect(repository.activity).toHaveBeenCalledWith(
    id,
    1,
    expect.any(AbortSignal),
    5,
  );
});
