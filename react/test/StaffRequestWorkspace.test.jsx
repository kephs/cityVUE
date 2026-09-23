import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { StrictMode } from "react";
import InternalRequestWorkspace from "../src/staff/requests/InternalRequestWorkspace.jsx";
import StaffRequestsPage from "../src/staff/requests/StaffRequestsPage.jsx";
import { useAuth } from "../src/auth/AuthContext.jsx";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn() }));
vi.mock(
  "../src/staff/requests/requestRepository.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    createStaffRequestRepository: vi.fn(),
  }),
);
async function manage(name) {
  fireEvent.click(
    await screen.findByRole("button", { name: "Manage " + name.toLowerCase() }),
  );
  return screen.findByRole("dialog", { name });
}
function closeDialog() {
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Close",
      exact: true,
    }),
  );
}
async function selectCommunication() {
  fireEvent.click(
    await screen.findByRole("tab", { name: "Requester Communication" }),
  );
}
async function fullActivity() {
  fireEvent.click(
    await screen.findByRole("button", { name: "View full activity" }),
  );
  return screen.findByRole("dialog", { name: "Full Request Activity" });
}
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  dept = "20000000-0000-4000-8000-000000000001",
  target = "20000000-0000-4000-8000-000000000002",
  division = "30000000-0000-4000-8000-000000000001";

test.each([
  [true, false],
  [false, true],
  [true, true],
  [false, false],
])(
  "F042 PUBLIC correspondence read=%s and Notes read=%s remain independent in detail",
  async (communicationRead, noteRead) => {
    repository.detail.mockResolvedValue({
      ...row,
      audience: "public",
      capabilities: {
        ...row.capabilities,
        canReadCommunications: communicationRead,
        canCreateCommunication: communicationRead,
        canReadNotes: noteRead,
        canCreateNotes: false,
      },
    });
    show(`/staff/requests/${id}`);
    await selectCommunication();
    if (communicationRead)
      await screen.findByText("F042 fictional correspondence");
    else expect(repository.communications).not.toHaveBeenCalled();
    if (noteRead) await screen.findByText("F041 fictional collaboration");
    else expect(repository.notes).not.toHaveBeenCalled();
    expect(Boolean(screen.queryByText("F042 fictional correspondence"))).toBe(
      communicationRead,
    );
    expect(Boolean(screen.queryByText("F041 fictional collaboration"))).toBe(
      noteRead,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View requester contact" }),
    );
    expect(
      screen.getByText(
        "You don't have permission to view requester contact information.",
      ),
    ).toBeInTheDocument();
    expect(repository.contact).not.toHaveBeenCalled();
  },
);

test("F042 INTERNAL detail never fetches history or offers a composer even with inconsistent client hints", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    capabilities: {
      ...row.capabilities,
      canReadCommunications: true,
      canCreateCommunication: true,
    },
  });
  show(`/staff/requests/${id}`);
  await screen.findByText("Internal request");
  expect(
    screen.queryByRole("heading", { name: "Requester Communication" }),
  ).not.toBeInTheDocument();
  expect(repository.communications).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Add Message" }),
  ).not.toBeInTheDocument();
});

test("F042 PUBLIC to INTERNAL navigation immediately clears correspondence and aborts its stream", async () => {
  repository.detail
    .mockResolvedValueOnce({
      ...row,
      audience: "public",
      capabilities: {
        ...row.capabilities,
        canReadCommunications: true,
        canCreateCommunication: true,
      },
    })
    .mockResolvedValue({ ...row, serviceRequestId: other });
  render(
    <MemoryRouter initialEntries={[`/staff/requests/${id}`]}>
      <Jump />
      <Routes>
        <Route
          path="/staff/requests/:requestId"
          element={<InternalRequestWorkspace repository={repository} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  const signal = repository.communications.mock.calls[0][2];
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Fictional unsent draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Other request" }));
  expect(
    screen.queryByText("F042 fictional correspondence"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByDisplayValue("Fictional unsent draft"),
  ).not.toBeInTheDocument();
  await screen.findByText("Internal request");
  expect(signal.aborted).toBe(true);
  expect(repository.communications).toHaveBeenCalledTimes(1);
});

test("F042 communication read revocation refreshes capabilities without hiding independently authorized Notes or parent", async () => {
  repository.detail
    .mockResolvedValueOnce({
      ...row,
      audience: "public",
      capabilities: {
        ...row.capabilities,
        canReadNotes: true,
        canReadCommunications: true,
        canCreateCommunication: true,
      },
    })
    .mockResolvedValue({
      ...row,
      audience: "public",
      capabilities: {
        ...row.capabilities,
        canReadNotes: true,
        canReadCommunications: false,
        canCreateCommunication: false,
      },
    });
  show(`/staff/requests/${id}`);
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  await screen.findByText("F041 fictional collaboration");
  repository.communications.mockRejectedValue({ status: 403 });
  fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await screen.findByText("You don't have permission to view messages.");
  expect(
    screen.queryByText("F042 fictional correspondence"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("F041 fictional collaboration")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: row.issueName }),
  ).toBeInTheDocument();
});
const row = {
  audience: "internal",
  intakeChannel: "staff",
  capabilities: {
    workflowActions: ["start_work", "hold", "resume", "close", "reopen"],
    canRoute: true,
    canAssign: true,
    canManageWatchers: true,
    canWatchSelf: true,
    canReadContact: false,
  },
  serviceRequestId: id,
  referenceNumber: "CASE-00000001",
  status: "open",
  issueName: "Fictional Facilities",
  departmentId: dept,
  departmentName: "Facilities",
  divisionId: null,
  divisionName: null,
  createdAt: "2026-09-19T12:00:00Z",
  updatedAt: "2026-09-19T12:00:00Z",
  revision: 1,
  description: "<script>alert('x')</script>\nFictional protected description",
};
let repository;
beforeEach(() => {
  vi.clearAllMocks();
  repository = {
    communications: vi.fn().mockResolvedValue({
      items: [
        {
          id: other,
          body: "F042 fictional correspondence",
          author: { displayName: "Fictional sender" },
          createdAt: "2026-09-21T12:00:00Z",
          direction: "outbound",
          channel: "portal",
          deliveryState: "recorded",
        },
      ],
      nextCursor: null,
    }),
    createCommunication: vi.fn(),
    notes: vi.fn().mockResolvedValue({
      items: [
        {
          id: other,
          body: "F041 fictional collaboration",
          author: { displayName: "Fictional note author" },
          createdAt: "2026-09-20T12:00:00Z",
        },
      ],
      nextCursor: null,
    }),
    createNote: vi.fn(),
    contact: vi
      .fn()
      .mockResolvedValue({ name: "Alex Example", email: "alex@example.com" }),
    watchers: vi.fn().mockResolvedValue({ items: [], watchingSelf: false }),
    targets: vi.fn().mockResolvedValue({ items: [] }),
    assign: vi.fn().mockResolvedValue({}),
    unassign: vi.fn().mockResolvedValue({}),
    addWatcher: vi.fn().mockResolvedValue({}),
    removeWatcher: vi.fn().mockResolvedValue({}),
    watchSelf: vi.fn().mockResolvedValue({}),
    unwatchSelf: vi.fn().mockResolvedValue({}),
    activity: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    }),
    list: vi.fn().mockResolvedValue({
      items: [row],
      total: 1,
      page: 1,
      pageSize: 25,
      hasPreviousPage: false,
      hasNextPage: false,
    }),
    detail: vi.fn().mockResolvedValue(row),
    options: vi.fn().mockResolvedValue({
      canUpdate: true,
      departments: [
        { id: dept, name: "Facilities" },
        { id: target, name: "Operations" },
      ],
      divisions: [{ id: division, departmentId: target, name: "Maintenance" }],
    }),
    workflow: vi.fn().mockResolvedValue({}),
    route: vi.fn().mockResolvedValue({}),
  };
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    account: { homeAccountId: "fictional" },
    signIn: vi.fn(),
  });
  createStaffRequestRepository.mockReturnValue(repository);
});
function Jump() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/staff/requests/${other}`)}>
      Other request
    </button>
  );
}

test.each(["public", "internal"])(
  "F041 shared Notes appears on %s detail without mixing Activity or contact",
  async (audience) => {
    repository.detail.mockResolvedValue({
      ...row,
      audience,
      capabilities: {
        ...row.capabilities,
        canReadNotes: true,
        canCreateNotes: true,
      },
    });
    const { container } = show(`/staff/requests/${id}`);
    await screen.findByText("F041 fictional collaboration");
    expect(
      screen.getByRole("tab", { name: "Internal Notes" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".request-activity")).not.toHaveTextContent(
      "F041 fictional collaboration",
    );
    expect(
      container.querySelector(".request-management"),
    ).not.toHaveTextContent("F041 fictional collaboration");
    fireEvent.click(
      screen.getByRole("button", { name: "View requester contact" }),
    );
    expect(
      screen.getByText(
        "You don't have permission to view requester contact information.",
      ),
    ).toBeInTheDocument();
    expect(repository.contact).not.toHaveBeenCalled();
  },
);

test("F041 Notes permission denial refreshes capabilities while preserving parent and loaded contact", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    canReadContact: true,
    capabilities: {
      ...row.capabilities,
      canReadNotes: true,
      canCreateNotes: true,
    },
  });
  show(`/staff/requests/${id}`);
  await screen.findByText("F041 fictional collaboration");
  fireEvent.click(
    screen.getByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("alex@example.com");
  closeDialog();
  repository.notes.mockRejectedValue({ status: 403 });
  repository.detail.mockResolvedValue({
    ...row,
    canReadContact: true,
    capabilities: {
      ...row.capabilities,
      canReadNotes: false,
      canCreateNotes: false,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh notes" }));
  await screen.findByText("You don't have permission to view internal notes.");
  expect(
    screen.getByRole("heading", { name: row.issueName }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("alex@example.com");
  expect(screen.getByText("alex@example.com")).toBeInTheDocument();
  expect(
    screen.queryByText("F041 fictional collaboration"),
  ).not.toBeInTheDocument();
});

test.each([401, 404])(
  "F041 Notes response %i clears the inaccessible parent/contact/Notes",
  async (status) => {
    repository.detail.mockResolvedValue({
      ...row,
      canReadContact: true,
      capabilities: { ...row.capabilities, canReadNotes: true },
    });
    show(`/staff/requests/${id}`);
    await screen.findByText("F041 fictional collaboration");
    fireEvent.click(
      screen.getByRole("button", { name: "View requester contact" }),
    );
    await screen.findByText("alex@example.com");
    closeDialog();
    repository.notes.mockRejectedValue({ status });
    fireEvent.click(screen.getByRole("button", { name: "Refresh notes" }));
    await waitFor(() =>
      expect(
        screen.queryByText("F041 fictional collaboration"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: row.issueName }),
    ).not.toBeInTheDocument();
  },
);

test("F041 sign-out removes Notes and in-memory draft from the real workspace", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    capabilities: {
      ...row.capabilities,
      canReadNotes: true,
      canCreateNotes: true,
    },
  });
  const view = show(`/staff/requests/${id}`, true);
  await screen.findByText("F041 fictional collaboration");
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Fictional draft removed on sign-out" },
  });
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: false,
    signIn: vi.fn(),
  });
  view.rerender(
    <MemoryRouter>
      <StaffRequestsPage />
    </MemoryRouter>,
  );
  expect(
    screen.queryByText("F041 fictional collaboration"),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("F039 protected detail never fetches or hides contact values in DOM", async () => {
  show(`/staff/requests/${id}`);
  fireEvent.click(
    await screen.findByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText(
    "You don't have permission to view requester contact information.",
  );
  expect(repository.contact).not.toHaveBeenCalled();
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", {
      name: "View requester contact",
    }),
  ).not.toBeInTheDocument();
});

test("F039 explicit view is single-flight in Strict Mode and workflow refresh does not re-audit contact", async () => {
  repository.detail.mockResolvedValue({ ...row, canReadContact: true });
  let resolve;
  repository.contact.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/staff/requests/${id}`]}>
        <Routes>
          <Route
            path="/staff/requests/:requestId"
            element={<InternalRequestWorkspace repository={repository} />}
          />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
  const view = await screen.findByRole("button", {
    name: "View requester contact",
  });
  expect(repository.contact).not.toHaveBeenCalled();
  fireEvent.click(view);
  fireEvent.click(view);
  expect(repository.contact).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Loading requester contact…")).toBeInTheDocument();
  await act(async () =>
    resolve({ name: "Alex Example", email: "alex@example.com" }),
  );
  expect(screen.getByText("alex@example.com")).toBeInTheDocument();
  closeDialog();
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start Work" }));
  await screen.findByText("Request moved to Open.");
  expect(repository.contact).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
});

test.each([403, 401, 404, 500])(
  "F039 contact response %s clears old values with safe independent errors",
  async (status) => {
    repository.detail.mockResolvedValue({ ...row, canReadContact: true });
    show(`/staff/requests/${id}`);
    fireEvent.click(
      await screen.findByRole("button", { name: "View requester contact" }),
    );
    await screen.findByText("alex@example.com");
    repository.contact.mockRejectedValue({
      status,
      message: "alex@example.com private error",
    });
    if (status === 403)
      repository.detail.mockResolvedValue({ ...row, canReadContact: false });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh requester contact" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument(),
    );
    if (status === 403) {
      await screen.findByText(
        "You don't have permission to view requester contact information.",
      );
      expect(
        screen.getByRole("heading", { name: row.issueName }),
      ).toBeInTheDocument();
    } else if (status === 500) {
      await screen.findByText(
        "Requester contact could not be loaded. Please try again.",
      );
      expect(
        screen.getByRole("heading", { name: row.issueName }),
      ).toBeInTheDocument();
    } else
      await waitFor(() =>
        expect(
          screen.queryByRole("heading", { name: row.issueName }),
        ).not.toBeInTheDocument(),
      );
    expect(screen.queryByText(/private error/)).not.toBeInTheDocument();
  },
);

test("F039 contact denial plus parent denial clears whole protected request", async () => {
  repository.detail.mockResolvedValue({ ...row, canReadContact: true });
  show(`/staff/requests/${id}`);
  fireEvent.click(
    await screen.findByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("alex@example.com");
  repository.detail.mockRejectedValue({ status: 403 });
  repository.contact.mockRejectedValue({ status: 403 });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh requester contact" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: row.issueName }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
});

test("F039 navigation aborts late contact and clears request A before B resolves", async () => {
  repository.detail
    .mockResolvedValueOnce({ ...row, canReadContact: true })
    .mockReturnValue(new Promise(() => {}));
  let resolve;
  repository.contact.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  show(`/staff/requests/${id}`);
  fireEvent.click(
    await screen.findByRole("button", { name: "View requester contact" }),
  );
  const signal = repository.contact.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: "Other request" }));
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve({ name: "Alex Example", email: "alex@example.com" }),
  );
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
  expect(screen.getByText("Loading request…")).toBeInTheDocument();
});

test("F039 sign-out removes populated contact from DOM", async () => {
  repository.detail.mockResolvedValue({ ...row, canReadContact: true });
  const view = show(`/staff/requests/${id}`, true);
  fireEvent.click(
    await screen.findByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("alex@example.com");
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: false,
    signIn: vi.fn(),
  });
  view.rerender(
    <MemoryRouter>
      <StaffRequestsPage />
    </MemoryRouter>,
  );
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
});

test.each(["public", "internal"])(
  "detail metadata groups %s audience and long reference below the Issue",
  async (audience) => {
    const reference = `SYNTHETIC-${"REFERENCE".repeat(16)}`;
    repository.detail.mockResolvedValue({
      ...row,
      audience,
      referenceNumber: reference,
    });
    const { container } = show(`/staff/requests/${id}`);
    const value = await screen.findByText(reference);
    const metadata = container.querySelector(".request-identity-meta");
    expect(metadata).toContainElement(value);
    expect(
      within(metadata).getByText(
        audience === "public" ? "Public request" : "Internal request",
      ),
    ).toHaveClass("ui-audience");
    expect(within(metadata).getByText("Request #")).toBeInTheDocument();
    expect(metadata.parentElement).toHaveClass("request-identity-copy");
    expect(
      container.querySelector(".request-current-status"),
    ).not.toContainElement(value);
    expect(
      screen
        .getByRole("heading", { name: row.issueName, level: 2 })
        .compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
);

test.each(["public", "internal"])(
  "list %s audience/reference spacing and paginated row positions",
  async (audience) => {
    repository.list.mockResolvedValue({
      items: [{ ...row, audience }],
      total: 40,
      page: 2,
      pageSize: 25,
      hasPreviousPage: true,
      hasNextPage: false,
    });
    const { container } = show(
      "/staff/requests?page=2&sort=issue&direction=asc&assignment=unassigned",
    );
    expect(await screen.findByLabelText("Row position 26")).toHaveTextContent(
      "26",
    );
    const metadata = container.querySelector(
      ".staff-request-table .request-identity-meta",
    );
    expect(
      within(metadata).getByText(
        audience === "public" ? "Public request" : "Internal request",
      ),
    ).toBeInTheDocument();
    expect(within(metadata).getByText(row.referenceNumber)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() =>
      expect(repository.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          sort: "issue",
          direction: "asc",
          assignment: "unassigned",
        }),
        expect.any(AbortSignal),
      ),
    );
  },
);

test("list defaults, keyboard sort toggles, assignment composition and Reset", async () => {
  show("/staff/requests");
  expect(await screen.findByLabelText("Row position 1")).toHaveTextContent("1");
  expect(repository.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      audience: "all",
      view: "all",
      assignment: "all",
      sort: "created",
      direction: "desc",
      page: 1,
      pageSize: 25,
    }),
    expect.any(AbortSignal),
  );
  const user = userEvent.setup();
  const issue = screen.getByRole("button", {
    name: "Sort by Issue / Reference; not currently sorted",
  });
  issue.focus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "issue", direction: "asc", page: 1 }),
      expect.any(AbortSignal),
    ),
  );
  const ascending = await screen.findByRole("button", {
    name: "Sort by Issue / Reference; ascending",
  });
  expect(ascending.closest("th")).toHaveAttribute("aria-sort", "ascending");
  await user.click(ascending);
  await screen.findByRole("button", {
    name: "Sort by Issue / Reference; descending",
  });
  await user.selectOptions(screen.getByLabelText("Assignment"), "unassigned");
  await user.selectOptions(screen.getByLabelText("Status"), "open");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assignment: "unassigned",
        status: "open",
        sort: "issue",
        direction: "desc",
      }),
      expect.any(AbortSignal),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() =>
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assignment: "all",
        status: "",
        sort: "created",
        direction: "desc",
        page: 1,
      }),
      expect.any(AbortSignal),
    ),
  );
});

test("consolidated controls follow search, clear, sort, direction and Refresh keyboard order", async () => {
  show("/staff/requests?q=street");
  await screen.findByLabelText("Row position 1");
  const toolbar = screen.getByRole("group", { name: "Request list controls" });
  const search = within(toolbar).getByRole("searchbox", {
    name: "Search requests",
  });
  const clear = within(toolbar).getByRole("button", { name: "Clear search" });
  const sort = within(toolbar).getByLabelText("Sort by");
  const direction = within(toolbar).getByLabelText("Direction");
  const refresh = within(toolbar).getByRole("button", { name: "Refresh" });
  expect([...toolbar.querySelectorAll("input,select,button")]).toEqual([
    search,
    clear,
    sort,
    direction,
    refresh,
  ]);
  expect(screen.getByText("1 requests · Page 1")).toBeInTheDocument();
  const user = userEvent.setup();
  search.focus();
  await user.tab();
  expect(clear).toHaveFocus();
  await user.tab();
  expect(sort).toHaveFocus();
  await user.tab();
  expect(direction).toHaveFocus();
  await user.tab();
  expect(refresh).toHaveFocus();
  const calls = repository.list.mock.calls.length;
  const filters = repository.list.mock.calls.at(-1)[0];
  await user.keyboard("{Enter}");
  await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(calls + 1));
  expect(repository.list).toHaveBeenLastCalledWith(
    filters,
    expect.any(AbortSignal),
  );
  await screen.findByLabelText("Row position 1");
  expect(
    screen
      .getByRole("button", { name: "Sort by Created; descending" })
      .closest("th"),
  ).toHaveAttribute("aria-sort", "descending");
});

test("F038 detail is Issue-first with configured icon and authorized location", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    issueIcon: "signpost-split",
    categoryName: "Fictional Services",
    serviceLocation: "123 Fictional Service Lane",
  });
  const { container } = show(`/staff/requests/${id}`);
  const heading = await screen.findByRole("heading", {
    name: row.issueName,
    level: 2,
  });
  const reference = screen.getByText(row.referenceNumber);
  expect(
    heading.compareDocumentPosition(reference) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    container.querySelector(".request-identity .bi-signpost-split"),
  ).toBeInTheDocument();
  expect(screen.getByText("123 Fictional Service Lane")).toBeInTheDocument();
  for (const title of [
    "Description",
    "Assignment",
    "Watchers",
    "Issue Details",
    "Actions",
    "Recent Activity",
  ])
    expect(
      await screen.findByRole("heading", { name: title }),
    ).toBeInTheDocument();
  expect(
    screen.getByText(
      "This is an internal request. Requester contact requires separate permission.",
    ),
  ).toBeInTheDocument();
});
test("F038 absent location stays absent and unsafe icon falls back without contact substitution", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    issueIcon: "<svg onload=alert(1)>",
    contact: { address: "Never display contact address" },
  });
  const { container } = show(`/staff/requests/${id}`);
  await screen.findByRole("heading", { name: row.issueName });
  expect(container.querySelector(".ui-location")).toBeNull();
  expect(
    container.querySelector(".request-identity .bi-file-earmark-text"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Never display contact address"),
  ).not.toBeInTheDocument();
  expect(container.querySelector("svg")).toBeNull();
});
function show(path = "/staff/requests", secured = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Jump />
      <Routes>
        <Route
          path="/staff/requests"
          element={
            secured ? (
              <StaffRequestsPage />
            ) : (
              <InternalRequestWorkspace repository={repository} />
            )
          }
        />
        <Route
          path="/staff/requests/:requestId"
          element={
            secured ? (
              <StaffRequestsPage />
            ) : (
              <InternalRequestWorkspace repository={repository} />
            )
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

test.each(["public", "internal"])(
  "F046 %s evidence follows Description and precedes Collaboration",
  async (audience) => {
    repository.detail.mockResolvedValue({ ...row, audience });
    repository.attachments = {
      policy: vi.fn().mockResolvedValue({ enabled: true }),
      evidence: vi.fn().mockResolvedValue([]),
    };
    show("/staff/requests/" + id);
    await screen.findByText("No attachments");
    const description = screen
      .getByRole("heading", { name: "Description" })
      .closest("section");
    const evidence = screen
      .getByRole("heading", { name: "Request Evidence" })
      .closest("section");
    const collaboration = screen.getByRole("heading", {
      name: "Collaboration",
    });
    expect(description.parentElement.nextElementSibling.firstElementChild).toBe(
      evidence,
    );
    expect(description.contains(evidence)).toBe(false);
    expect(
      evidence.compareDocumentPosition(collaboration) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(repository.attachments.evidence).toHaveBeenCalledWith(
      id,
      expect.any(AbortSignal),
    );
  },
);

test.each(["public", "internal"])(
  "final F046 %s notice stays distinct from Description with PUBLIC-only spacing",
  async (audience) => {
    repository.detail.mockResolvedValue({ ...row, audience });
    show("/staff/requests/" + id);
    const description = (
      await screen.findByRole("heading", { name: "Description" })
    ).closest("section");
    const notice = description.previousElementSibling;
    expect(notice.tagName).toBe("ASIDE");
    expect(notice).toHaveClass("request-internal-notice");
    expect(notice.classList.contains("request-public-notice")).toBe(
      audience === "public",
    );
    expect(
      within(notice).getByText(
        audience === "public" ? "Public Request" : "Internal Request",
        { exact: true },
      ),
    ).toBeInTheDocument();
    expect(notice.contains(description)).toBe(false);
    expect(description.parentElement).toHaveClass("request-detail");
    expect(description.querySelector("p").textContent).toBe(row.description);
    if (audience === "internal")
      expect(
        screen.queryByText("Public Request", { exact: true }),
      ).not.toBeInTheDocument();
  },
);

test("final F046 DOM groups preserve primary flow and management-before-Activity without extra reads", async () => {
  repository.attachments = {
    policy: vi.fn().mockResolvedValue({ enabled: true }),
    evidence: vi.fn().mockResolvedValue([]),
  };
  const { container } = show("/staff/requests/" + id);
  await screen.findByText("No attachments");
  await screen.findByText("No activity has been recorded for this request.");
  const grid = container.querySelector(".request-detail-grid");
  const [primary, sidebar] = grid.children;
  expect(primary).toHaveClass("request-primary-content");
  expect(sidebar).toHaveClass("request-sidebar");
  expect(primary.firstElementChild).toHaveClass("request-detail");
  expect(
    [...primary.lastElementChild.children].map((element) => element.className),
  ).toEqual([
    expect.stringContaining("request-evidence"),
    expect.stringContaining("request-collaboration"),
    expect.stringContaining("request-issue-details"),
  ]);
  expect(
    [...sidebar.firstElementChild.children].map((element) => element.className),
  ).toEqual([
    expect.stringContaining("request-actions"),
    expect.stringContaining("request-management"),
  ]);
  expect(sidebar.lastElementChild).toHaveClass("request-history");
  expect(
    sidebar
      .querySelector(".request-management")
      .contains(sidebar.lastElementChild),
  ).toBe(false);
  expect(repository.activity).toHaveBeenCalledTimes(1);
  expect(repository.activity).toHaveBeenCalledWith(
    id,
    1,
    expect.any(AbortSignal),
    5,
  );
  fireEvent(window, new Event("resize"));
  expect(repository.activity).toHaveBeenCalledTimes(1);
  const dialog = await fullActivity();
  await within(dialog).findByText(
    "No activity has been recorded for this request.",
  );
  expect(repository.activity).toHaveBeenCalledTimes(2);
  expect(repository.activity).toHaveBeenLastCalledWith(
    id,
    1,
    expect.any(AbortSignal),
    25,
  );
  closeDialog();
  expect(
    screen.getByRole("heading", { name: "Recent Activity" }),
  ).toBeInTheDocument();
  expect(repository.activity).toHaveBeenCalledTimes(2);
});

test.each([401, 403, 404])(
  "F046 parent denial %s never loads evidence or leaks its count",
  async (status) => {
    repository.detail.mockRejectedValue({ status });
    repository.attachments = { policy: vi.fn(), evidence: vi.fn() };
    show("/staff/requests/" + id);
    await waitFor(() => expect(repository.detail).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Loading request…")).not.toBeInTheDocument(),
    );
    expect(repository.attachments.policy).not.toHaveBeenCalled();
    expect(repository.attachments.evidence).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Request Evidence" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No attachments")).not.toBeInTheDocument();
  },
);

test("F046 counted Note and Communication attachments remain inside their collaboration parents", async () => {
  const attachment = {
    id,
    filename: "synthetic.png",
    mediaType: "image/png",
    byteSize: 32,
    state: "CLEAN",
  };
  repository.detail.mockResolvedValue({
    ...row,
    audience: "public",
    capabilities: {
      ...row.capabilities,
      canReadNotes: true,
      canReadCommunications: true,
    },
  });
  repository.attachments = {
    policy: vi.fn().mockResolvedValue({ enabled: true }),
    evidence: vi.fn().mockResolvedValue([]),
  };
  repository.notes.mockResolvedValue({
    items: [
      {
        id,
        body: "Fictional note with evidence",
        author: { displayName: "Staff" },
        createdAt: row.createdAt,
        attachments: [attachment],
      },
    ],
    nextCursor: null,
  });
  repository.communications.mockResolvedValue({
    items: [
      {
        id: other,
        body: "Fictional recorded message",
        author: { displayName: "Staff" },
        createdAt: row.createdAt,
        direction: "outbound",
        channel: "portal",
        deliveryState: "recorded",
        attachments: [
          attachment,
          { ...attachment, id: other, filename: "second.png" },
        ],
      },
    ],
    nextCursor: null,
  });
  show("/staff/requests/" + id);
  const note = (
    await screen.findByText("Fictional note with evidence")
  ).closest("li");
  expect(
    within(note).getByRole("heading", { name: "1 attachment" }),
  ).toBeInTheDocument();
  expect(within(note).getByText("1.")).toBeInTheDocument();
  expect(note.closest(".request-collaboration")).not.toBeNull();
  await selectCommunication();
  const message = (
    await screen.findByText("Fictional recorded message")
  ).closest("li");
  expect(
    within(message).getByRole("heading", { name: "2 attachments" }),
  ).toBeInTheDocument();
  expect(within(message).getByText("2.")).toBeInTheDocument();
  expect(message.closest(".request-collaboration")).not.toBeNull();
  expect(
    within(message).getByText("Outbound · Portal · Recorded"),
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole("heading", { name: "Request Evidence" }),
  ).toHaveLength(1);
  expect(screen.getByText("No attachments")).toBeInTheDocument();
});
test("list has loading, semantic references/status/department/date and no UUID primary display", async () => {
  show();
  expect(screen.getByText("Loading requests…")).toBeInTheDocument();
  await screen.findByRole("link", { name: row.issueName });
  expect(screen.getByRole("table")).toHaveAccessibleName(
    /Service Requests available to you/,
  );
  expect(
    screen.getByText("Open", { selector: ".request-status" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(id)).not.toBeInTheDocument();
  expect(screen.queryByText(row.description)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});
test.each([
  "SR-202609-000002",
  "REQ-2026-000123",
  "CASE-00000001",
  "311-2026-00000001",
  "LONGPREFIX122026091234567890123456789",
])("opaque reference %s appears unparsed", async (reference) => {
  repository.detail.mockResolvedValue({ ...row, referenceNumber: reference });
  show(`/staff/requests/${id}`);
  expect(await screen.findByText(reference)).toBeInTheDocument();
});
test("detail deep link displays plain text without contact or interpreted markup", async () => {
  const view = show(`/staff/requests/${id}`);
  await screen.findByRole("heading", { name: row.issueName });
  expect(screen.getByText(/<script>/)).toBeInTheDocument();
  expect(view.container.querySelector("script")).toBeNull();
  expect(repository.detail).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  expect(screen.queryByText(/email|phone/i)).not.toBeInTheDocument();
  expect(document.title).toBe("Service Requests | CityVUE");
});
test("long description is available through semantic disclosure", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    description: "Fictional text ".repeat(200),
  });
  show(`/staff/requests/${id}`);
  await screen.findByText("Read full description");
  expect(
    screen.getByText("Read full description").closest("details"),
  ).toBeInTheDocument();
});
test("search and status apply only on submit, reset and preserve link filter state", async () => {
  show();
  await screen.findByRole("link", { name: row.issueName });
  fireEvent.change(screen.getByLabelText("Reference"), {
    target: { value: "CASE" },
  });
  fireEvent.change(screen.getByLabelText("Status"), {
    target: { value: "open" },
  });
  expect(repository.list).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "CASE", status: "open", page: 1 }),
      expect.any(AbortSignal),
    ),
  );
  const link = await screen.findByRole("link", { name: row.issueName });
  expect(link.getAttribute("href")).toContain("search=CASE");
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() =>
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "", status: "", page: 1 }),
      expect.any(AbortSignal),
    ),
  );
});
test("server pagination changes page without loading all records", async () => {
  repository.list.mockResolvedValue({
    items: [row],
    total: 26,
    page: 1,
    pageSize: 25,
    hasNextPage: true,
  });
  show();
  await screen.findByRole("link", { name: row.issueName });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.any(AbortSignal),
    ),
  );
});
test.each([
  ["", "No requests to display."],
  ["?status=open", "No requests match your current filters."],
])("empty state %s is clear", async (query, label) => {
  repository.list.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  show(`/staff/requests${query}`);
  expect(await screen.findByText(label)).toBeInTheDocument();
});
test.each([401, 403, 404, 500])(
  "detail denial %s hides protected data and sanitizes backend message",
  async (status) => {
    repository.detail.mockRejectedValue({
      status,
      message: "SQL_PRIVATE_SECRET",
    });
    show(`/staff/requests/${id}`);
    await screen.findByRole("alert");
    expect(
      screen.queryByText(/SQL_PRIVATE_SECRET|Fictional protected description/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start Work" }),
    ).not.toBeInTheDocument();
  },
);
test("list failure has safe retry and no protected rows", async () => {
  repository.list.mockRejectedValue({ status: 500, message: "SECRET" });
  show();
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("link", { name: row.issueName }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
test.each([
  ["open", "Start Work"],
  ["on_hold", "Resume Work"],
  ["in_progress", null],
  ["closed", null],
  ["cancelled", null],
])("complete F035 workflow controls for %s", async (status, action) => {
  repository.detail.mockResolvedValue({ ...row, status });
  show(`/staff/requests/${id}`);
  await screen.findByRole("heading", { name: row.issueName });
  if (action)
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  else
    expect(
      screen.queryByRole("button", { name: /Start Work|Resume Work/ }),
    ).not.toBeInTheDocument();
  const expected = {
    open: ["Close Request"],
    in_progress: ["Place On Hold", "Close Request"],
    on_hold: ["Close Request"],
    closed: ["Reopen Request"],
    cancelled: [],
  }[status];
  for (const label of ["Place On Hold", "Close Request", "Reopen Request"]) {
    if (expected.includes(label))
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    else
      expect(
        screen.queryByRole("button", { name: label }),
      ).not.toBeInTheDocument();
  }
});
test("read-only capability does not infer mutation rights", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    capabilities: {
      ...row.capabilities,
      workflowActions: [],
      canRoute: false,
      canAssign: false,
      canManageWatchers: false,
    },
  });
  repository.options.mockResolvedValue({
    canUpdate: false,
    departments: [],
    divisions: [],
  });
  show(`/staff/requests/${id}`);
  await screen.findByText("You have read-only access to this request.");
  expect(
    screen.queryByRole("button", { name: /Start Work|Route Request/ }),
  ).not.toBeInTheDocument();
});
test("mutation is revision guarded, prevents duplicate clicks and refetches authoritative state", async () => {
  let finish;
  repository.workflow.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  repository.detail
    .mockResolvedValueOnce(row)
    .mockResolvedValue({ ...row, status: "in_progress", revision: 2 });
  show(`/staff/requests/${id}`);
  const button = await screen.findByRole("button", { name: "Start Work" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(repository.workflow).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(repository.workflow).toHaveBeenCalledWith(
    id,
    { action: "start_work", expectedRevision: 1 },
    expect.any(AbortSignal),
  );
  await act(async () => finish({}));
  await screen.findByText("Request moved to In Progress.");
  expect(repository.detail).toHaveBeenCalledTimes(2);
});
test("conflict reloads latest state instead of resubmitting", async () => {
  repository.workflow.mockRejectedValue({ status: 409 });
  repository.detail
    .mockResolvedValueOnce(row)
    .mockResolvedValue({ ...row, status: "on_hold", revision: 2 });
  show(`/staff/requests/${id}`);
  fireEvent.click(await screen.findByRole("button", { name: "Start Work" }));
  await screen.findByText(/latest information has been loaded/);
  expect(
    screen.getByRole("button", { name: "Resume Work" }),
  ).toBeInTheDocument();
  expect(repository.workflow).toHaveBeenCalledTimes(1);
});
test("revoked update permission clears stale protected detail", async () => {
  repository.workflow.mockRejectedValue({ status: 403 });
  show(`/staff/requests/${id}`);
  fireEvent.click(await screen.findByRole("button", { name: "Start Work" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByText(/Fictional protected description/),
  ).not.toBeInTheDocument();
});
test("routing uses server options, keyboard focus and current revision then refreshes", async () => {
  repository.detail.mockResolvedValueOnce(row).mockResolvedValue({
    ...row,
    departmentId: target,
    departmentName: "Operations",
    divisionId: division,
    divisionName: "Maintenance",
    revision: 2,
  });
  show(`/staff/requests/${id}`);
  fireEvent.click(await screen.findByRole("button", { name: "Route Request" }));
  expect(screen.getByLabelText("Department")).toHaveFocus();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Department"), target);
  await user.selectOptions(screen.getByLabelText("Division"), division);
  fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
  await screen.findByText("Request routed successfully.");
  expect(repository.route).toHaveBeenCalledWith(
    id,
    { departmentId: target, divisionId: division, expectedRevision: 1 },
    expect.any(AbortSignal),
  );
  expect(screen.getByText("Maintenance")).toBeInTheDocument();
});
test("switching UUID clears prior request while inaccessible detail loads", async () => {
  repository.detail
    .mockResolvedValueOnce(row)
    .mockImplementation(() => new Promise(() => {}));
  show(`/staff/requests/${id}`);
  await screen.findByRole("heading", { name: row.issueName });
  fireEvent.click(screen.getByRole("button", { name: "Other request" }));
  expect(
    screen.queryByText(/Fictional protected description/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Loading request…")).toBeInTheDocument();
});
test("authentication is required, and sign-out removes protected content", async () => {
  const view = show(`/staff/requests/${id}`, true);
  await screen.findByRole("heading", { name: row.issueName });
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: false,
    signIn: vi.fn(),
  });
  view.rerender(
    <MemoryRouter initialEntries={[`/staff/requests/${id}`]}>
      <StaffRequestsPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Staff sign-in required" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Fictional protected description/),
  ).not.toBeInTheDocument();
});
test("disabled Entra cannot use a legacy fallback", () => {
  useAuth.mockReturnValue({ enabled: false, isAuthenticated: false });
  show("/staff/requests", true);
  expect(
    screen.getByText("Staff request access is not configured."),
  ).toBeInTheDocument();
  expect(repository.list).not.toHaveBeenCalled();
});

test.each([400, 403, 409])(
  "routing failure %s is reconciled without a second mutation",
  async (status) => {
    repository.route.mockRejectedValue({ status });
    show(`/staff/requests/${id}`);
    fireEvent.click(
      await screen.findByRole("button", { name: "Route Request" }),
    );
    fireEvent.change(screen.getByLabelText("Department"), {
      target: { value: target },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm routing" }));
    if (status === 409) {
      await screen.findByText(/latest information has been loaded/);
      expect(repository.detail).toHaveBeenCalledTimes(2);
    } else {
      await screen.findByRole("alert");
      expect(
        screen.queryByText(/Fictional protected description/),
      ).not.toBeInTheDocument();
    }
    expect(repository.route).toHaveBeenCalledTimes(1);
  },
);

test("expired API session uses established sign-in action and hides detail", async () => {
  const signIn = vi.fn();
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    account: { homeAccountId: "fictional" },
    signIn,
  });
  repository.detail.mockRejectedValue({ status: 401 });
  show(`/staff/requests/${id}`, true);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in again" }));
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByText(/Fictional protected description/),
  ).not.toBeInTheDocument();
});

const event = (type = "request_created", narrative = null) => ({
  id: other,
  type,
  narrative,
  occurredAt: row.createdAt,
  actorDisplay: "Staff member",
  fromStatus: null,
  toStatus: null,
  intakeChannel: "staff",
});
test("activity loading, plain-text narrative, safe actor, routing and older pages", async () => {
  let resolve;
  repository.activity.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  show(`/staff/requests/${id}`);
  await screen.findByText("Loading activity…");
  await act(async () =>
    resolve({
      items: [
        {
          ...event(
            "placed_on_hold",
            "<script>alert('x')</script>\nFictional Unicode café",
          ),
          fromStatus: "in_progress",
          toStatus: "on_hold",
        },
      ],
      page: 1,
      hasNextPage: true,
    }),
  );
  expect(screen.getByText("Placed on hold")).toBeInTheDocument();
  expect(
    screen.getByText("Staff member", { exact: false }),
  ).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  repository.activity.mockResolvedValue({
    items: [event("placed_on_hold", "<script>alert(1)</script>")],
    page: 1,
    hasNextPage: true,
  });
  await fullActivity();
  await screen.findByText("<script>alert(1)</script>");
  repository.activity.mockResolvedValue({
    items: [
      {
        ...event("request_routed"),
        fromDepartment: "Fictional Old",
        toDepartment: "Fictional New",
        toDivision: "District A",
      },
    ],
    page: 2,
    hasPreviousPage: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Older activity" }));
  await screen.findByText("Fictional New / District A");
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Request Activity" }),
    ).toHaveFocus(),
  );
  expect(repository.activity).toHaveBeenLastCalledWith(
    id,
    2,
    expect.any(AbortSignal),
    25,
  );
});
test("activity-specific failure preserves detail and retry, authorization loss clears it", async () => {
  repository.activity
    .mockRejectedValueOnce({ status: 500 })
    .mockRejectedValue({ status: 403 });
  show(`/staff/requests/${id}`);
  await screen.findByText("Activity could not be loaded.");
  expect(
    screen.getByRole("heading", { name: row.issueName }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  await screen.findByText(/do not have permission/);
  expect(
    screen.queryByRole("heading", { name: row.issueName }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Request Activity" }),
  ).not.toBeInTheDocument();
});
test("empty history and long narrative disclosure are safe", async () => {
  repository.detail
    .mockResolvedValueOnce(row)
    .mockResolvedValue({ ...row, status: "in_progress", revision: 2 });
  repository.activity
    .mockResolvedValueOnce({ items: [], page: 1 })
    .mockResolvedValue({
      items: [event("request_closed", "Fictional resolution ".repeat(70))],
      page: 1,
    });
  show(`/staff/requests/${id}`);
  await screen.findByText("No activity has been recorded for this request.");
  fireEvent.click(screen.getByRole("button", { name: "Start Work" }));
  await screen.findByText("Request moved to In Progress.");
  await fullActivity();
  await screen.findByText("Read narrative");
  expect(document.querySelector(".activity-narrative")).toHaveTextContent(
    "Fictional resolution",
  );
});
test.each([
  [
    "in_progress",
    "hold",
    "Place On Hold",
    "Hold reason",
    "on_hold",
    "placed_on_hold",
  ],
  ["open", "close", "Close Request", "Resolution", "closed", "request_closed"],
  [
    "closed",
    "reopen",
    "Reopen Request",
    "Reopen reason",
    "open",
    "request_reopened",
  ],
])(
  "narrative action %s validates and refreshes authoritative activity",
  async (status, action, label, field, next, type) => {
    repository.detail
      .mockResolvedValueOnce({ ...row, status })
      .mockResolvedValue({ ...row, status: next, revision: 2 });
    repository.activity
      .mockResolvedValueOnce({
        items: [event("request_closed", "Prior resolution")],
        page: 1,
      })
      .mockResolvedValue({
        items: [
          event(type, "Fictional new narrative"),
          { ...event("request_closed", "Prior resolution"), id: dept },
        ],
        page: 1,
      });
    show(`/staff/requests/${id}`);
    fireEvent.click(await screen.findByRole("button", { name: label }));
    const form = screen.getByRole("form", { name: label });
    const input = within(form).getByRole("textbox", {
      name: `${field} (required)`,
    });
    expect(input).toHaveFocus();
    expect(input).toBeRequired();
    expect(input).toHaveAttribute(
      "maxlength",
      action === "close" ? "2000" : "500",
    );
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form);
    expect(repository.workflow).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "Enter meaningful text",
    );
    fireEvent.change(input, { target: { value: "Fictional new narrative" } });
    fireEvent.submit(form);
    await screen.findByText(
      `Request moved to ${next === "on_hold" ? "On Hold" : next === "closed" ? "Closed" : "Open"}.`,
    );
    await fullActivity();
    await screen.findByText("Fictional new narrative", {
      selector: ".activity-narrative",
    });
    expect(screen.getByText("Prior resolution")).toBeInTheDocument();
    expect(repository.workflow).toHaveBeenCalledWith(
      id,
      {
        action,
        expectedRevision: 1,
        [action === "close" ? "resolutionSummary" : "reason"]:
          "Fictional new narrative",
      },
      expect.any(AbortSignal),
    );
    expect(repository.activity).toHaveBeenCalledTimes(3);
  },
);
test("narrative cancel and Escape restore focus without mutation", async () => {
  show(`/staff/requests/${id}`);
  const trigger = await screen.findByRole("button", { name: "Close Request" });
  fireEvent.click(trigger);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Unsubmitted fictional text" } });
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(repository.workflow).not.toHaveBeenCalled();
});
test.each([400, 500])(
  "recoverable narrative error %s preserves draft and no fake timeline entry",
  async (status) => {
    repository.workflow.mockRejectedValue({ status });
    show(`/staff/requests/${id}`);
    fireEvent.click(
      await screen.findByRole("button", { name: "Close Request" }),
    );
    const form = screen.getByRole("form", { name: "Close Request" });
    fireEvent.change(within(form).getByRole("textbox"), {
      target: { value: "Fictional retry text" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(within(form).getByRole("alert")).not.toBeEmptyDOMElement(),
    );
    expect(within(form).getByRole("textbox")).toHaveValue(
      "Fictional retry text",
    );
    expect(repository.detail).toHaveBeenCalledTimes(1);
    expect(repository.activity).toHaveBeenCalledTimes(1);
  },
);
test.each([401, 403, 409])(
  "narrative failure %s clears draft and never automatically replays",
  async (status) => {
    repository.workflow.mockRejectedValue({ status });
    show(`/staff/requests/${id}`);
    fireEvent.click(
      await screen.findByRole("button", { name: "Close Request" }),
    );
    const form = screen.getByRole("form", { name: "Close Request" });
    fireEvent.change(within(form).getByRole("textbox"), {
      target: { value: "Fictional private draft" },
    });
    fireEvent.submit(form);
    if (status === 409)
      await screen.findByText(/latest information has been loaded/);
    else await screen.findByRole("alert");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(repository.workflow).toHaveBeenCalledTimes(1);
  },
);
test("narrative pending prevents duplicate submissions and waits for server confirmation", async () => {
  let finish;
  repository.workflow.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  show(`/staff/requests/${id}`);
  fireEvent.click(await screen.findByRole("button", { name: "Close Request" }));
  const form = screen.getByRole("form", { name: "Close Request" });
  fireEvent.change(within(form).getByRole("textbox"), {
    target: { value: "Fictional resolution" },
  });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(repository.workflow).toHaveBeenCalledTimes(1);
  expect(within(form).getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(
    screen.getByText("Open", { selector: ".request-status" }),
  ).toBeInTheDocument();
  await act(async () => finish({}));
});

test("completed narrative command with failed detail refresh shows retry without replaying draft", async () => {
  repository.detail
    .mockResolvedValueOnce(row)
    .mockRejectedValue({ status: 500 });
  show(`/staff/requests/${id}`);
  fireEvent.click(await screen.findByRole("button", { name: "Close Request" }));
  const form = screen.getByRole("form", { name: "Close Request" });
  fireEvent.change(within(form).getByRole("textbox"), {
    target: { value: "Fictional completed resolution" },
  });
  fireEvent.submit(form);
  await screen.findByText(/temporarily unavailable/);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(repository.workflow).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Loading request…")).not.toBeInTheDocument();
});

test.each(["staff", "role", "group"])(
  "F037 shows %s assignment and watcher as escaped text",
  async (type) => {
    const targetValue = {
      type,
      id: other,
      displayName: "Fictional <script>target</script>",
      active: true,
    };
    repository.detail.mockResolvedValue({ ...row, assignment: targetValue });
    repository.watchers.mockResolvedValue({
      items: [targetValue],
      watchingSelf: false,
    });
    show(`/staff/requests/${id}`);
    expect(
      await screen.findByRole("heading", { name: "Assignment" }),
    ).toBeInTheDocument();
    await manage("Watchers");
    expect(
      await screen.findByRole("button", {
        name: "Remove watcher: Fictional <script>target</script>",
      }),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByText(/@example/)).not.toBeInTheDocument();
  },
);

test.each(["staff", "role", "group"])(
  "F037 assigns eligible %s with revision and authoritative refresh",
  async (type) => {
    const user = userEvent.setup();
    const targetValue = {
      type,
      id: other,
      displayName: "Fictional selected target",
      active: true,
    };
    repository.targets.mockResolvedValue({ items: [targetValue] });
    show(`/staff/requests/${id}`);
    await manage("Assignment");
    await user.click(
      await screen.findByRole("button", { name: "Assign Request" }),
    );
    await user.selectOptions(screen.getByLabelText("Target type"), type);
    await user.selectOptions(
      await screen.findByLabelText("Eligible target"),
      other,
    );
    repository.detail.mockResolvedValue({
      ...row,
      revision: 2,
      assignment: targetValue,
    });
    await user.click(
      screen.getByRole("button", { name: "Confirm assignment" }),
    );
    await waitFor(() =>
      expect(repository.assign).toHaveBeenCalledWith(
        id,
        { targetType: type, targetId: other, expectedRevision: 1 },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Assignment updated.")).toBeInTheDocument();
    expect(repository.detail).toHaveBeenCalledTimes(2);
    expect(repository.activity).toHaveBeenCalledTimes(2);
  },
);

test("F037 picker search, no-results, errors, keyboard cancel and focus return", async () => {
  const user = userEvent.setup();
  show(`/staff/requests/${id}`);
  await manage("Assignment");
  const trigger = await screen.findByRole("button", { name: "Assign Request" });
  await user.click(trigger);
  expect(screen.getByLabelText("Target type")).toHaveFocus();
  expect(
    await screen.findByText("No eligible targets found."),
  ).toBeInTheDocument();
  await user.type(screen.getByLabelText("Search eligible targets"), "reviewer");
  await user.click(screen.getByRole("button", { name: "Search targets" }));
  await waitFor(() =>
    expect(repository.targets).toHaveBeenLastCalledWith(
      id,
      "staff",
      "reviewer",
      expect.anything(),
      "assignment",
    ),
  );
  repository.targets.mockRejectedValue({ status: 500 });
  await user.click(screen.getByRole("button", { name: "Search targets" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Targets could not be loaded",
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(
    screen.queryByRole("form", { name: "Choose assignment" }),
  ).not.toBeInTheDocument();
});

test("F037 read-only users can self-watch but cannot manage other targets", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    capabilities: {
      ...row.capabilities,
      workflowActions: [],
      canRoute: false,
      canAssign: false,
      canManageWatchers: false,
    },
  });
  repository.options.mockResolvedValue({
    canUpdate: false,
    departments: [],
    divisions: [],
  });
  const user = userEvent.setup();
  show(`/staff/requests/${id}`);
  await manage("Watchers");
  const watch = await screen.findByRole("button", {
    name: "Watch this request",
  });
  expect(
    screen.queryByRole("button", { name: "Assign Request" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add Watcher" }),
  ).not.toBeInTheDocument();
  repository.watchers.mockResolvedValue({
    items: [{ type: "staff", id: other, displayName: "Fictional staff" }],
    watchingSelf: true,
  });
  repository.detail.mockResolvedValue({ ...row, revision: 2 });
  await user.click(watch);
  await waitFor(() =>
    expect(repository.watchSelf).toHaveBeenCalledWith(
      id,
      { expectedRevision: 1 },
      expect.anything(),
    ),
  );
  await user.click(
    await screen.findByRole("button", { name: "Stop watching" }),
  );
  await waitFor(() =>
    expect(repository.unwatchSelf).toHaveBeenCalledWith(
      id,
      { expectedRevision: 2 },
      expect.anything(),
    ),
  );
});

test("F037 add/remove watchers refreshes from API and preserves separate assignment", async () => {
  const user = userEvent.setup(),
    targetValue = {
      type: "role",
      id: other,
      displayName: "Fictional reviewer",
    };
  repository.targets.mockResolvedValue({ items: [targetValue] });
  show(`/staff/requests/${id}`);
  await manage("Watchers");
  await user.click(await screen.findByRole("button", { name: "Add Watcher" }));
  await user.selectOptions(screen.getByLabelText("Target type"), "role");
  await user.selectOptions(
    await screen.findByLabelText("Eligible target"),
    other,
  );
  repository.watchers.mockResolvedValue({
    items: [targetValue],
    watchingSelf: false,
  });
  repository.detail.mockResolvedValue({ ...row, revision: 2 });
  await user.click(screen.getByRole("button", { name: "Confirm watcher" }));
  await waitFor(() =>
    expect(repository.addWatcher).toHaveBeenCalledWith(
      id,
      { targetType: "role", targetId: other, expectedRevision: 1 },
      expect.anything(),
    ),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Remove watcher: Fictional reviewer",
    }),
  );
  await waitFor(() =>
    expect(repository.removeWatcher).toHaveBeenCalledWith(
      id,
      { targetType: "role", targetId: other, expectedRevision: 2 },
      expect.anything(),
    ),
  );
  expect(repository.assign).not.toHaveBeenCalled();
});

test("F037 unassign and duplicate watcher conflict reload authoritative state", async () => {
  const user = userEvent.setup();
  repository.detail.mockResolvedValue({
    ...row,
    assignment: { type: "group", id: other, displayName: "Fictional team" },
  });
  show(`/staff/requests/${id}`);
  await manage("Assignment");
  await user.click(
    await screen.findByRole("button", { name: "Unassign Request" }),
  );
  await waitFor(() =>
    expect(repository.unassign).toHaveBeenCalledWith(
      id,
      { expectedRevision: 1 },
      expect.anything(),
    ),
  );
  await screen.findByText("Request unassigned.");
  closeDialog();
  await manage("Watchers");
  repository.watchSelf.mockRejectedValue({ status: 409 });
  await user.click(
    await screen.findByRole("button", { name: "Watch this request" }),
  );
  expect(
    await screen.findByText(/latest information has been loaded/),
  ).toBeInTheDocument();
  expect(repository.detail).toHaveBeenCalledTimes(3);
});

test("F037 pending mutation prevents rapid duplicate commands", async () => {
  let finish;
  repository.watchSelf.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show(`/staff/requests/${id}`);
  await manage("Watchers");
  const button = await screen.findByRole("button", {
    name: "Watch this request",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(repository.watchSelf).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(async () => finish({}));
});

test.each([401, 403, 404])(
  "F037 watcher authorization failure %s clears protected detail",
  async (status) => {
    repository.watchers.mockRejectedValue({ status });
    if (status === 403)
      repository.detail
        .mockResolvedValueOnce(row)
        .mockRejectedValue({ status });
    show(`/staff/requests/${id}`);
    await waitFor(() => expect(repository.watchers).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText(row.description)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(row.description)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Assignment" }),
    ).not.toBeInTheDocument();
  },
);

test.each(["mine", "team", "watching"])(
  "F037 %s view composes and resets page",
  async (view) => {
    const user = userEvent.setup();
    show("/staff/requests?status=open&page=3&search=CASE-00000001");
    await screen.findByRole("link", { name: row.issueName });
    await user.selectOptions(screen.getByLabelText("Request view"), view);
    await waitFor(() =>
      expect(repository.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          view,
          status: "open",
          page: 1,
          search: "CASE-00000001",
        }),
        expect.anything(),
      ),
    );
    const link = await screen.findByRole("link", { name: row.issueName });
    expect(link.getAttribute("href")).toContain(`view=${view}`);
  },
);

test("F040 mixed list exposes readable audience labels, secondary references and no contact", async () => {
  repository.list.mockResolvedValue({
    items: [
      row,
      {
        ...row,
        serviceRequestId: other,
        audience: "public",
        referenceNumber: "PUBLIC-OPAQUE-0001",
        issueName: "Fictional street sign",
        contact: { email: "never-in-list@example.com" },
      },
    ],
    total: 2,
    page: 1,
    pageSize: 25,
  });
  show();
  await screen.findByText("Public request");
  expect(screen.getByText("Internal request")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Fictional street sign" }),
  ).toHaveAttribute(
    "href",
    expect.stringContaining(`/staff/requests/${other}`),
  );
  expect(screen.getByText("PUBLIC-OPAQUE-0001")).toBeInTheDocument();
  expect(
    screen.queryByText("never-in-list@example.com"),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Audience")).toHaveValue("all");
});

test.each(["public", "internal", "all"])(
  "F040 %s audience selection narrows existing filters and resets global pagination",
  async (audience) => {
    const user = userEvent.setup();
    show(
      "/staff/requests?audience=public&view=watching&status=open&search=OPAQUE&page=4",
    );
    await screen.findByRole("link", { name: row.issueName });
    await user.selectOptions(screen.getByLabelText("Audience"), audience);
    await waitFor(() =>
      expect(repository.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          audience,
          view: "watching",
          status: "open",
          search: "OPAQUE",
          page: 1,
        }),
        expect.anything(),
      ),
    );
    expect(
      (await screen.findByRole("link", { name: row.issueName })).getAttribute(
        "href",
      ),
    ).toContain(`audience=${audience}`);
  },
);

test.each(["public", "internal"])(
  "F040 empty %s audience does not imply Organization-wide absence",
  async (audience) => {
    repository.list.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    show(`/staff/requests?audience=${audience}`);
    expect(
      await screen.findByRole("heading", {
        name: `No ${audience === "public" ? "Public" : "Internal"} requests match your filters.`,
      }),
    ).toBeInTheDocument();
  },
);

test("F040 PUBLIC detail uses shared hierarchy and on-demand PUBLIC contact; per-action capabilities remain independent", async () => {
  repository.detail.mockResolvedValue({
    ...row,
    audience: "public",
    intakeChannel: "phone",
    canReadContact: true,
    capabilities: {
      ...row.capabilities,
      workflowActions: ["close"],
      canRoute: false,
      canAssign: true,
      canManageWatchers: false,
    },
  });
  const user = userEvent.setup();
  show(`/staff/requests/${id}`);
  expect(await screen.findByText("Public request")).toBeInTheDocument();
  expect(screen.getByText("Phone")).toBeInTheDocument();
  expect(screen.queryByText("Internal Request")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: row.issueName }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Close Request" }),
  ).toBeInTheDocument();
  await manage("Assignment");
  expect(
    screen.getByRole("button", { name: "Assign Request" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add Watcher" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Start Work" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Route Request" }),
  ).not.toBeInTheDocument();
  expect(repository.contact).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("alex@example.com");
  expect(repository.contact).toHaveBeenCalledWith(
    id,
    expect.anything(),
    "public",
  );
});

test("F040 PUBLIC-to-INTERNAL navigation clears contact, ownership and history before the next detail resolves", async () => {
  const first = {
    ...row,
    audience: "public",
    canReadContact: true,
    assignment: { type: "role", id, displayName: "Fictional first owner" },
  };
  let resolveNext;
  repository.detail.mockResolvedValueOnce(first).mockReturnValue(
    new Promise((resolve) => {
      resolveNext = resolve;
    }),
  );
  render(
    <MemoryRouter initialEntries={[`/staff/requests/${id}`]}>
      <Jump />
      <Routes>
        <Route
          path="/staff/requests/:requestId"
          element={<InternalRequestWorkspace repository={repository} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("alex@example.com");
  await user.click(screen.getByRole("button", { name: "Other request" }));
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
  expect(screen.queryByText(/Fictional first owner/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Request Activity" }),
  ).not.toBeInTheDocument();
  await act(async () => resolveNext({ ...row, serviceRequestId: other }));
  await screen.findByText("Internal request");
  fireEvent.click(
    screen.getByRole("button", { name: "View requester contact" }),
  );
  expect(
    screen.getByText(
      "You don't have permission to view requester contact information.",
    ),
  ).toBeInTheDocument();
});

const f043Row = () => ({
  ...row,
  audience: "public",
  canReadContact: true,
  capabilities: {
    ...row.capabilities,
    canReadNotes: true,
    canCreateNotes: true,
    canReadCommunications: true,
    canCreateCommunication: true,
  },
});
async function f043Show() {
  repository.detail.mockResolvedValue(f043Row());
  const view = show(`/staff/requests/${id}`);
  await screen.findByText("F041 fictional collaboration");
  return view;
}

test("F043 initial detail reads authorized watcher count; management actions and other history stay lazy", async () => {
  await f043Show();
  expect(repository.notes).toHaveBeenCalledTimes(1);
  expect(repository.activity).toHaveBeenCalledWith(
    id,
    1,
    expect.any(AbortSignal),
    5,
  );
  for (const key of ["contact", "communications", "targets"])
    expect(repository[key]).not.toHaveBeenCalled();
  await manage("Assignment");
  expect(repository.targets).not.toHaveBeenCalled();
  expect(repository.watchers).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Assign Request" }));
  await screen.findByText("No eligible targets found.");
  expect(repository.targets).toHaveBeenLastCalledWith(
    id,
    "staff",
    "",
    expect.any(AbortSignal),
    "assignment",
  );
  closeDialog();
  await manage("Watchers");
  await screen.findByText("No watchers");
  expect(repository.watchers).toHaveBeenCalledTimes(2);
  expect(repository.targets).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Add Watcher" }));
  await screen.findByText("No eligible targets found.");
  expect(repository.targets).toHaveBeenLastCalledWith(
    id,
    "staff",
    "",
    expect.any(AbortSignal),
    "watchers",
  );
  closeDialog();
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  expect(repository.communications).toHaveBeenCalledTimes(1);
  await fullActivity();
  await waitFor(() =>
    expect(repository.activity).toHaveBeenLastCalledWith(
      id,
      1,
      expect.any(AbortSignal),
      25,
    ),
  );
  expect(repository.activity).toHaveBeenCalledTimes(2);
});

test("F043 Contact close aborts a late response; reopening refetches once and restores focus", async () => {
  const user = userEvent.setup();
  await f043Show();
  let finish;
  repository.contact.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const trigger = screen.getByRole("button", {
    name: "View requester contact",
  });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Requester Contact" });
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  const signal = repository.contact.mock.calls[0][1];
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(signal.aborted).toBe(true);
  expect(trigger).toHaveFocus();
  await act(async () =>
    finish({ name: "Late fictional contact", email: "late@example.com" }),
  );
  expect(screen.queryByText("late@example.com")).not.toBeInTheDocument();
  await user.click(trigger);
  await screen.findByText("alex@example.com");
  expect(repository.contact).toHaveBeenCalledTimes(2);
  closeDialog();
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
  await selectCommunication();
  expect(repository.contact).toHaveBeenCalledTimes(2);
});

test("F043 Contact authorized empty state reveals presence only inside the explicit dialog", async () => {
  repository.contact.mockResolvedValue({ name: null, email: null });
  await f043Show();
  expect(
    screen.queryByText("No contact information was provided."),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "View requester contact" }),
  );
  await screen.findByText("No contact information was provided.");
  closeDialog();
  expect(
    screen.queryByText("No contact information was provided."),
  ).not.toBeInTheDocument();
});

test.each([
  "Assignment",
  "Watchers",
  "Requester Contact",
  "Full Request Activity",
])(
  "F043 %s dialog is named, closes on cancel and returns focus",
  async (name) => {
    const user = userEvent.setup();
    await f043Show();
    const trigger = screen.getByRole("button", {
      name: {
        Assignment: "Manage assignment",
        Watchers: "Manage watchers",
        "Requester Contact": "View requester contact",
        "Full Request Activity": "View full activity",
      }[name],
    });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name });
    expect(dialog).toHaveAttribute("open");
    expect(
      within(dialog).getByRole("button", { name: "Close", exact: true }),
    ).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  },
);

test("F043 tabs use keyboard selection and retain separate drafts without refetch or storage", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem");
  await f043Show();
  const notes = screen.getByRole("tab", { name: "Internal Notes" });
  const messages = screen.getByRole("tab", { name: "Requester Communication" });
  expect(notes).toHaveAttribute("aria-selected", "true");
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Fictional unsent note\nline two" },
  });
  fireEvent.keyDown(notes, { key: "ArrowRight" });
  expect(messages).toHaveFocus();
  expect(messages).toHaveAttribute("aria-selected", "true");
  expect(
    screen.queryByRole("button", { name: "Add Note" }),
  ).not.toBeInTheDocument();
  await screen.findByText("F042 fictional correspondence");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Fictional unsent message\nline two" },
  });
  fireEvent.keyDown(messages, { key: "Home" });
  expect(notes).toHaveFocus();
  expect(screen.getByLabelText("Internal Note")).toHaveValue(
    "Fictional unsent note\nline two",
  );
  expect(
    screen.queryByRole("button", { name: "Add Message" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(notes, { key: "End" });
  expect(screen.getByLabelText("Message")).toHaveValue(
    "Fictional unsent message\nline two",
  );
  fireEvent.keyDown(messages, { key: "ArrowLeft" });
  expect(notes).toHaveFocus();
  expect(repository.notes).toHaveBeenCalledTimes(1);
  expect(repository.communications).toHaveBeenCalledTimes(1);
  expect(storage).not.toHaveBeenCalled();
  expect(document.title).not.toMatch(/unsent/);
  expect(window.location.href).not.toMatch(/unsent/);
  storage.mockRestore();
});

test.each(["note", "message"])(
  "F043 successful %s creation clears only its own draft; failure retains it",
  async (kind) => {
    await f043Show();
    fireEvent.change(screen.getByLabelText("Internal Note"), {
      target: { value: "Fictional note draft" },
    });
    await selectCommunication();
    await screen.findByText("F042 fictional correspondence");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Fictional message draft" },
    });
    const isNote = kind === "note",
      method = isNote ? "createNote" : "createCommunication";
    if (isNote)
      fireEvent.click(screen.getByRole("tab", { name: "Internal Notes" }));
    repository[method]
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValue({
        id: dept,
        body: "Authoritative fictional child",
        author: { displayName: "Authoritative staff" },
        createdAt: "2026-09-22T01:00:00Z",
        direction: "outbound",
        channel: "portal",
        deliveryState: "recorded",
      });
    const label = isNote ? "Internal Note" : "Message",
      button = isNote ? "Add Note" : "Add Message";
    fireEvent.click(screen.getByRole("button", { name: button }));
    await screen.findByText(/Your draft is retained/);
    expect(screen.getByLabelText(label)).toHaveValue(`Fictional ${kind} draft`);
    fireEvent.click(screen.getByRole("button", { name: button }));
    await screen.findByText("Authoritative fictional child");
    expect(screen.getByLabelText(label)).toHaveValue("");
    fireEvent.click(
      screen.getByRole("tab", {
        name: isNote ? "Requester Communication" : "Internal Notes",
      }),
    );
    expect(
      screen.getByLabelText(isNote ? "Message" : "Internal Note"),
    ).toHaveValue(`Fictional ${isNote ? "message" : "note"} draft`);
    expect(repository.activity).toHaveBeenCalledTimes(1);
    expect(repository.detail).toHaveBeenCalledTimes(1);
  },
);

test("F043 request navigation immediately clears both visited streams and drafts and aborts both", async () => {
  await f043Show();
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Unsent note A" },
  });
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Unsent message A" },
  });
  const noteSignal = repository.notes.mock.calls[0][2],
    messageSignal = repository.communications.mock.calls[0][2];
  repository.detail.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Other request" }));
  for (const text of ["Unsent note A", "Unsent message A"])
    expect(screen.queryByDisplayValue(text)).not.toBeInTheDocument();
  for (const text of [
    "F041 fictional collaboration",
    "F042 fictional correspondence",
  ])
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  expect(noteSignal.aborted && messageSignal.aborted).toBe(true);
});

test("F043 sign-out removes selected and hidden collaboration streams and drafts", async () => {
  repository.detail.mockResolvedValue(f043Row());
  const view = show(`/staff/requests/${id}`, true);
  await screen.findByText("F041 fictional collaboration");
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Unsent hidden note" },
  });
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Unsent visible message" },
  });
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: false,
    signIn: vi.fn(),
  });
  view.rerender(
    <MemoryRouter>
      <StaffRequestsPage />
    </MemoryRouter>,
  );
  expect(
    screen.queryByText("F041 fictional collaboration"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("F042 fictional correspondence"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { hidden: true }),
  ).not.toBeInTheDocument();
});

test("F043 authoritative revocation clears hidden Notes without refetching an inactive stream", async () => {
  await f043Show();
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Unsent protected draft" },
  });
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  repository.detail.mockResolvedValue({
    ...f043Row(),
    capabilities: {
      ...f043Row().capabilities,
      canReadNotes: false,
      canCreateNotes: false,
      canReadCommunications: false,
      canCreateCommunication: false,
    },
  });
  repository.communications.mockRejectedValue({ status: 403 });
  fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await screen.findByText("You don't have permission to view messages.");
  await waitFor(() =>
    expect(
      screen.queryByText("F041 fictional collaboration"),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByDisplayValue("Unsent protected draft"),
  ).not.toBeInTheDocument();
  expect(repository.notes).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("tab", { name: "Internal Notes" }));
  expect(
    screen.getByText("You don't have permission to view internal notes."),
  ).toBeVisible();
  expect(repository.notes).toHaveBeenCalledTimes(1);
});

test("F043 hidden stream capability change clears its draft and defers authorized reload until selected", async () => {
  await f043Show();
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Unsent draft before create revocation" },
  });
  await selectCommunication();
  await screen.findByText("F042 fictional correspondence");
  repository.detail.mockResolvedValue({
    ...f043Row(),
    capabilities: {
      ...f043Row().capabilities,
      canCreateNotes: false,
      canCreateCommunication: false,
    },
  });
  repository.createCommunication.mockRejectedValue({ status: 403 });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Fictional denied message" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Add Message" }),
    ).not.toBeInTheDocument(),
  );
  expect(repository.notes).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByDisplayValue("Unsent draft before create revocation"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Internal Notes" }));
  await screen.findByText("F041 fictional collaboration");
  expect(repository.notes).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole("button", { name: "Add Note" }),
  ).not.toBeInTheDocument();
});

test.each(["assignment", "watchers"])(
  "F043 %s discovery failure stays local and retries without losing parent or drafts",
  async (kind) => {
    await f043Show();
    fireEvent.change(screen.getByLabelText("Internal Note"), {
      target: { value: "Fictional retained draft" },
    });
    const method = kind === "assignment" ? "targets" : "watchers";
    repository[method].mockRejectedValueOnce({ status: 500 });
    await manage(kind === "assignment" ? "Assignment" : "Watchers");
    if (kind === "assignment")
      fireEvent.click(screen.getByRole("button", { name: "Assign Request" }));
    await screen.findByRole("alert");
    expect(
      screen.getByRole("heading", { name: row.issueName }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: kind === "assignment" ? "Search targets" : "Retry watchers",
      }),
    );
    await screen.findByText(
      kind === "assignment" ? "No eligible targets found." : "No watchers",
    );
    closeDialog();
    expect(screen.getByLabelText("Internal Note")).toHaveValue(
      "Fictional retained draft",
    );
    expect(repository.notes).toHaveBeenCalledTimes(1);
  },
);

test("F043 assignment permission loss clears picker while preserving independently readable parent", async () => {
  await f043Show();
  repository.targets.mockResolvedValue({
    items: [{ id: other, type: "staff", displayName: "Fictional assignee" }],
  });
  await manage("Assignment");
  fireEvent.click(screen.getByRole("button", { name: "Assign Request" }));
  await screen.findByLabelText("Eligible target");
  fireEvent.change(screen.getByLabelText("Eligible target"), {
    target: { value: other },
  });
  repository.assign.mockRejectedValue({ status: 403 });
  repository.detail.mockResolvedValue({
    ...f043Row(),
    capabilities: { ...f043Row().capabilities, canAssign: false },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.queryByLabelText("Eligible target")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("heading", { name: row.issueName }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Assignment" }),
  ).toBeInTheDocument();
});

test.each([false, true])(
  "F043 ownership refresh (conflict=%s) preserves both collaboration drafts and does not refetch streams",
  async (conflict) => {
    await f043Show();
    fireEvent.change(screen.getByLabelText("Internal Note"), {
      target: { value: "Note draft remains" },
    });
    await selectCommunication();
    await screen.findByText("F042 fictional correspondence");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Message draft remains" },
    });
    await manage("Watchers");
    await screen.findByText("No watchers");
    repository.detail.mockResolvedValue({ ...f043Row(), revision: 2 });
    if (conflict) repository.watchSelf.mockRejectedValue({ status: 409 });
    fireEvent.click(screen.getByRole("button", { name: "Watch this request" }));
    await screen.findByText(
      conflict
        ? /latest information has been loaded/
        : "You are now watching this request.",
    );
    closeDialog();
    expect(screen.getByLabelText("Message")).toHaveValue(
      "Message draft remains",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Internal Notes" }));
    expect(screen.getByLabelText("Internal Note")).toHaveValue(
      "Note draft remains",
    );
    expect(repository.notes).toHaveBeenCalledTimes(1);
    expect(repository.communications).toHaveBeenCalledTimes(1);
    expect(repository.activity).toHaveBeenCalledTimes(2);
    expect(repository.watchSelf).toHaveBeenCalledTimes(1);
  },
);

test("F043 full Activity failure leaves preview and parent intact and can retry", async () => {
  await f043Show();
  repository.activity.mockRejectedValueOnce({ status: 500 });
  await fullActivity();
  await screen.findByText("Activity could not be loaded.");
  expect(
    screen.getByRole("heading", { name: row.issueName }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Recent Activity" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Activity could not be loaded."),
    ).not.toBeInTheDocument(),
  );
  expect(repository.activity).toHaveBeenCalledTimes(3);
});
