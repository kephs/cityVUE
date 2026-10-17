import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MyInternalRequests } from "../src/requester/MyInternalRequestsPage.jsx";
import RequesterRouteGuard from "../src/requester/RequesterRouteGuard.jsx";
import { createMyRequestsRepository } from "../src/requester/myRequestsRepository.js";

const id = "10000000-0000-4000-8000-000000000055";
const other = "10000000-0000-4000-8000-000000000057";
const summary = {
  id,
  reference: "SYNTHETIC-64",
  issue: { name: "Fictional internal service", icon: "wrench" },
  status: "in_progress",
  submittedAt: "2026-09-24T00:00:00Z",
  lastUpdateAt: "2026-09-24T01:00:00Z",
  serviceLocation: "Fictional landmark",
};
const detail = {
  ...summary,
  description: "Fictional\n<script>text only</script>",
  updates: [
    {
      id: "b",
      body: "Second update\n<script>alert(1)</script>",
      createdAt: "2026-09-24T02:00:00Z",
      sender: { displayName: "Service team" },
    },
    {
      id: "a",
      body: "First update",
      createdAt: "2026-09-24T01:00:00Z",
      sender: { displayName: "Service team" },
    },
  ],
};

function repository(overrides = {}) {
  return {
    list: vi
      .fn()
      .mockResolvedValue({ items: [summary], page: 1, hasMore: false }),
    detail: vi.fn().mockResolvedValue(detail),
    ...overrides,
  };
}

test("F064.1 the dashboard lists the requester's own requests and opens one on request", async () => {
  const user = userEvent.setup();
  const repo = repository();
  const view = render(<MyInternalRequests repository={repo} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  // The page keeps its heading across the loading transition, so wait for the
  // loaded list rather than capturing a heading node that gets replaced.
  const list = await screen.findByRole("list", {
    name: "My internal requests, newest first",
  });
  expect(
    screen.getByRole("heading", { level: 1, name: "My Internal Requests" }),
  ).toBeInTheDocument();
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("SYNTHETIC-64")).toBeInTheDocument();
  expect(screen.getByText("In Progress")).toBeInTheDocument();
  expect(view.container.querySelector("time")).toHaveAttribute(
    "datetime",
    summary.submittedAt,
  );
  await user.click(
    screen.getByRole("button", { name: "Open request SYNTHETIC-64" }),
  );
  expect(
    await screen.findByRole("heading", {
      level: 2,
      name: "Updates from the Service Team",
    }),
  ).toBeInTheDocument();
  expect(repo.detail).toHaveBeenCalledWith(id, expect.anything());
  const updates = screen.getByRole("list", {
    name: "Updates from the service team, newest first",
  });
  const entries = within(updates).getAllByRole("listitem");
  expect(entries).toHaveLength(2);
  expect(entries[0].querySelector(".my-request-update-body").textContent).toBe(
    "Second update\n<script>alert(1)</script>",
  );
  expect(entries[1].textContent).toContain("First update");
  expect(within(updates).getAllByText("Service team")).toHaveLength(2);
  // Script-looking content is text, never markup.
  expect(view.container.querySelector("img,script,svg")).toBeNull();
  expect(
    view.container.querySelector(".my-request-description").textContent,
  ).toBe(detail.description);
  await user.click(screen.getByRole("button", { name: "Back to my requests" }));
  expect(await screen.findByText("SYNTHETIC-64")).toBeInTheDocument();
});

test("F064.1 a request with no updates still renders, with a clear empty state", async () => {
  const repo = repository({
    detail: vi.fn().mockResolvedValue({ ...detail, updates: [] }),
  });
  render(<MyInternalRequests repository={repo} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Open request SYNTHETIC-64" }),
  );
  expect(
    await screen.findByText(/There are no updates yet/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("list", {
      name: "Updates from the service team, newest first",
    }),
  ).toBeNull();
  expect(screen.getByText("SYNTHETIC-64")).toBeInTheDocument();
});

test("F064.1 an empty dashboard explains itself instead of rendering an empty list", async () => {
  const repo = repository({
    list: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }),
  });
  render(<MyInternalRequests repository={repo} />);
  expect(
    await screen.findByText(/You have not submitted any internal requests yet/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("list")).toBeNull();
});

test("F064.1 pagination is bounded and only advances when the API says there is more", async () => {
  const user = userEvent.setup();
  const repo = repository({
    list: vi
      .fn()
      .mockResolvedValueOnce({ items: [summary], page: 1, hasMore: true })
      .mockResolvedValue({
        items: [{ ...summary, id: other, reference: "SYNTHETIC-65" }],
        page: 2,
        hasMore: false,
      }),
  });
  render(<MyInternalRequests repository={repo} />);
  await screen.findByText("SYNTHETIC-64");
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("SYNTHETIC-65")).toBeInTheDocument();
  expect(repo.list).toHaveBeenLastCalledWith(2, expect.anything());
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});

test.each([
  ["authentication-required", /session has expired/, false],
  ["access-denied", /not able to view internal requests/, false],
  ["network", /couldn't load your requests/, true],
])(
  "F064.1 %s failures are explained safely and retry is only offered when it helps",
  async (code, message, retryable) => {
    const failure = Object.assign(new Error("failed"), { code });
    const repo = repository({ list: vi.fn().mockRejectedValue(failure) });
    render(<MyInternalRequests repository={repo} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(!!screen.queryByRole("button", { name: "Try again" })).toBe(
      retryable,
    );
  },
);

test("F064.1 no staff-only field or restricted value reaches a requester component", async () => {
  const repo = repository({
    detail: vi.fn().mockResolvedValue({
      ...detail,
      notes: [{ body: "INTERNAL_NOTE_BODY" }],
      assignment: { staff: "Fictional employee" },
      permissions: ["service_request.internal.read"],
      routedDepartmentId: "FICTIONAL_DEPARTMENT",
      updates: [
        ...detail.updates,
        {
          id: "c",
          body: "Dropped",
          createdAt: "not-a-date",
          sender: { displayName: "Service team" },
        },
      ],
    }),
  });
  const view = render(<MyInternalRequests repository={repo} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Open request SYNTHETIC-64" }),
  );
  await screen.findByRole("heading", { name: "Updates from the Service Team" });
  for (const forbidden of [
    "INTERNAL_NOTE_BODY",
    "Fictional employee",
    "service_request.internal.read",
    "FICTIONAL_DEPARTMENT",
  ])
    expect(view.container.textContent).not.toContain(forbidden);
  for (const label of [
    "Internal Notes",
    "Assignment",
    "Watchers",
    "Request Activity",
    "Requester Contact",
  ])
    expect(screen.queryByText(label)).not.toBeInTheDocument();
});

test("F064.1 the repository whitelists response fields and drops malformed updates", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      ...detail,
      authorDisplayName: "Fictional employee",
      permissions: ["service_request.internal.read"],
      updates: [
        {
          ...detail.updates[0],
          sender: {
            displayName: "Service team",
            email: "staff@example.invalid",
          },
          authorStaffIdentityId: "FICTIONAL_IDENTITY",
        },
        {
          id: "no-body",
          createdAt: detail.submittedAt,
          sender: { displayName: "x" },
        },
        null,
      ],
    }),
  };
  const repo = createMyRequestsRepository({ client });
  const result = await repo.detail(id);
  expect(Object.keys(result).sort()).toEqual([
    "description",
    "id",
    "issue",
    "lastUpdateAt",
    "reference",
    "serviceLocation",
    "status",
    "submittedAt",
    "updates",
  ]);
  expect(result.updates).toHaveLength(1);
  expect(Object.keys(result.updates[0]).sort()).toEqual([
    "body",
    "createdAt",
    "id",
    "sender",
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "Fictional employee",
    "staff@example.invalid",
    "FICTIONAL_IDENTITY",
    "service_request.internal.read",
  ])
    expect(serialized).not.toContain(forbidden);
  expect(client.get.mock.calls[0][1]).toMatchObject({ authenticated: true });
});

test("F064.1 the requester route guard asks for sign-in without claiming staff access", async () => {
  vi.resetModules();
  const auth = await import("../src/auth/AuthContext.jsx");
  const useAuth = vi.spyOn(auth, "useAuth");
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: false,
    signIn: vi.fn(),
    error: null,
  });
  const { default: Guard } =
    await import("../src/requester/RequesterRouteGuard.jsx");
  render(
    <Guard>
      <p>PROTECTED_CONTENT</p>
    </Guard>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Sign in to see your requests" }),
    ).toBeInTheDocument(),
  );
  expect(screen.queryByText("PROTECTED_CONTENT")).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByText(/staff/i)).toBeNull();
  useAuth.mockRestore();
});

test("F064.1 the guard reports an unconfigured deployment without offering sign-in", async () => {
  const auth = await import("../src/auth/AuthContext.jsx");
  const useAuth = vi.spyOn(auth, "useAuth");
  useAuth.mockReturnValue({
    enabled: false,
    isAuthenticated: false,
    signIn: vi.fn(),
    error: null,
  });
  render(
    <RequesterRouteGuard>
      <p>PROTECTED_CONTENT</p>
    </RequesterRouteGuard>,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Employee sign-in is not configured",
  );
  expect(screen.queryByText("PROTECTED_CONTENT")).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  useAuth.mockRestore();
});
