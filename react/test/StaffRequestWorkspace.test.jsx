import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
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
  await screen.findByRole("link", { name: row.referenceNumber });
  expect(screen.getByRole("table")).toHaveAccessibleName(
    /Internal Service Requests/,
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
  expect(
    await screen.findByRole("heading", { name: reference }),
  ).toBeInTheDocument();
});
test("detail deep link displays plain text without contact or interpreted markup", async () => {
  const view = show(`/staff/requests/${id}`);
  await screen.findByRole("heading", { name: row.referenceNumber });
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
  await screen.findByRole("link", { name: row.referenceNumber });
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
  const link = await screen.findByRole("link", { name: row.referenceNumber });
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
  await screen.findByRole("link", { name: row.referenceNumber });
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
    screen.queryByRole("link", { name: row.referenceNumber }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
test.each([
  ["open", "Start Work"],
  ["on_hold", "Resume Work"],
  ["in_progress", null],
  ["closed", null],
  ["cancelled", null],
])("approved workflow UI subset for %s", async (status, action) => {
  repository.detail.mockResolvedValue({ ...row, status });
  show(`/staff/requests/${id}`);
  await screen.findByRole("heading", { name: row.referenceNumber });
  if (action)
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  else
    expect(
      screen.queryByRole("button", { name: /Start Work|Resume Work/ }),
    ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /Place On Hold|Close Request|Reopen Request/,
    }),
  ).not.toBeInTheDocument();
});
test("read-only capability does not infer mutation rights", async () => {
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
  await screen.findByRole("heading", { name: row.referenceNumber });
  fireEvent.click(screen.getByRole("button", { name: "Other request" }));
  expect(
    screen.queryByText(/Fictional protected description/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Loading request…")).toBeInTheDocument();
});
test("authentication is required, and sign-out removes protected content", async () => {
  const view = show(`/staff/requests/${id}`, true);
  await screen.findByRole("heading", { name: row.referenceNumber });
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
