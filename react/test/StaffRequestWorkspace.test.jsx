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
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  dept = "20000000-0000-4000-8000-000000000001",
  target = "20000000-0000-4000-8000-000000000002",
  division = "30000000-0000-4000-8000-000000000001";
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

test("F039 protected detail never fetches or hides contact values in DOM", async () => {
  show(`/staff/requests/${id}`);
  await screen.findByText("Protected");
  expect(repository.contact).not.toHaveBeenCalled();
  expect(screen.queryByText("alex@example.com")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "View requester contact" }),
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
  fireEvent.click(screen.getByRole("button", { name: "Start Work" }));
  await screen.findByText("Request moved to Open.");
  expect(repository.contact).toHaveBeenCalledTimes(1);
  expect(screen.getByText("alex@example.com")).toBeInTheDocument();
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
      await screen.findByText("Protected");
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
    "Request Activity",
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
  expect(
    screen.getByRole("heading", { name: "Request Activity" }),
  ).toHaveFocus();
  expect(repository.activity).toHaveBeenLastCalledWith(
    id,
    2,
    expect.any(AbortSignal),
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
    expect(repository.activity).toHaveBeenCalledTimes(2);
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
    show(`/staff/requests/${id}`);
    await screen.findByRole("alert");
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
  expect(screen.getByText("Protected")).toBeInTheDocument();
});
