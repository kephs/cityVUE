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
    const sections = [
      ...container.querySelector(".request-workspace-layout").children,
    ];
    expect(
      sections.map((el) => el.querySelector("h3")?.textContent.trim()),
    ).toEqual([
      "Overview",
      "Request Details",
      "Work",
      "Requester",
      "Submitted Information",
      "Request Evidence",
      "Collaboration",
      "Recent Activity",
    ]);
    expect(sections[5]).toContainElement(
      screen.getByRole("heading", { name: "Request Evidence" }),
    );
    expect(sections[4]).toContainElement(
      screen.getByRole("button", { name: "View Submitted Information" }),
    );
    expect(sections[3]).toContainElement(
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
        screen.getByRole("button", { name: "View Submitted Information" }),
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
        expect(
          reference.compareDocumentPosition(location) &
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

test("review correction: Work groups status/actions, assignment, routing and watchers before Requester", async () => {
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
  const work = container.querySelector(".request-work");
  expect(
    work.compareDocumentPosition(
      container.querySelector(".request-requester"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(start.closest(".request-work-lifecycle")).toHaveTextContent("Open");
  expect(
    within(work)
      .getByRole("button", { name: "Change Assignment" })
      .closest(".request-management-row"),
  ).toHaveTextContent("Unassigned");
  expect(
    within(work)
      .getByRole("button", { name: "Change Routing" })
      .closest(".request-management-row"),
  ).toHaveTextContent("Public Works");
  expect(
    within(work)
      .getByRole("button", { name: "Manage watchers" })
      .closest(".request-management-row"),
  ).toHaveTextContent("Watchers");
  expect(
    container.querySelector(".request-details .submitted-information"),
  ).toBeNull();
  expect(container.querySelector(".submitted-information")).toHaveClass(
    "ui-card",
  );
  expect(repository.readAnswers).not.toHaveBeenCalled();
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
      "Service Category",
      "Department / Division",
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
