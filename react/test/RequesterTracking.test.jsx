import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import RequesterTracking from "../src/staff/requests/RequesterTracking.jsx";
import RequesterTrackingPage from "../src/tracking/RequesterTrackingPage.jsx";
import { createTrackingSession } from "../src/tracking/trackingSession.js";

const id = "10000000-0000-4000-8000-000000000001";
const secret = "A".repeat(43);
const longDate = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
const safe = {
  reference: "SYNTHETIC-44",
  issue: { name: "<img src=x onerror=alert(1)>", icon: "<svg>" },
  status: "in_progress",
  submittedAt: "2026-09-21T00:00:00Z",
  serviceLocation: "<script>fictional</script>",
  description: "Synthetic\n<script>text only</script>",
  updates: [
    {
      id: "10000000-0000-4000-8000-000000000009",
      body: "Crew scheduled\n<script>text only</script>",
      createdAt: "2026-09-22T00:00:00Z",
      sender: { displayName: "Service team" },
    },
  ],
};
test("F044 consumes a link arriving between bootstrap and page mount", async () => {
  window.history.replaceState(null, "", "/track");
  const session = createTrackingSession();
  // A same-document navigation can finish while the lazy page is still loading.
  window.history.replaceState(null, "", `/track#${secret}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  const release = session.retain();
  expect(window.location.hash).toBe("");
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => safe });
  await expect(session.load("/api/v1", undefined, fetcher)).resolves.toEqual(
    safe,
  );
  expect(fetcher.mock.calls[0][1].headers["X-Requester-Tracking"]).toBe(secret);
  release();
  await Promise.resolve();
  window.history.replaceState(null, "", "/");
});
test("F044 replacement link in the same tab is scrubbed and an old denial cannot clear it", async () => {
  window.history.replaceState(null, "", `/track#${secret}`);
  const session = createTrackingSession();
  const release = session.retain();
  const changed = vi.fn();
  const unsubscribe = session.subscribe(changed);
  let denyOld;
  const oldRequest = session.load(
    "/api/v1",
    undefined,
    () =>
      new Promise((resolve) => {
        denyOld = resolve;
      }),
  );
  const replacement = "B".repeat(43);
  window.history.replaceState(null, "", `/track#${replacement}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(window.location.hash).toBe("");
  expect(changed).toHaveBeenCalledTimes(1);
  denyOld({ ok: false, status: 404 });
  await expect(oldRequest).rejects.toThrow("unavailable");
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => safe });
  await session.load("/api/v1", undefined, fetcher);
  expect(fetcher.mock.calls[0][1].headers["X-Requester-Tracking"]).toBe(
    replacement,
  );
  unsubscribe();
  release();
  await Promise.resolve();
  window.history.replaceState(null, "", "/");
});
test("F044 fragment is scrubbed; only dedicated header transports credential; release discards it", async () => {
  window.history.replaceState(null, "", `/track#${secret}`);
  const session = createTrackingSession();
  const release = session.retain();
  expect(window.location.href).not.toContain(secret);
  expect(document.title).not.toContain(secret);
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...safe, staffIdentity: "forbidden" }),
  });
  expect(await session.load("/api/v1", undefined, fetcher)).toEqual(safe);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/requester-tracking",
    expect.objectContaining({
      headers: { Accept: "application/json", "X-Requester-Tracking": secret },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    }),
  );
  release();
  await Promise.resolve();
  await expect(session.load("/api/v1", undefined, fetcher)).rejects.toThrow(
    "unavailable",
  );
  expect(localStorage.getItem("tracking")).toBeNull();
  expect(sessionStorage.getItem("tracking")).toBeNull();
  window.history.replaceState(null, "", "/");
});
test("F044 requester page renders only explicit safe fields as text without staff navigation", async () => {
  const session = {
    retain: vi.fn(() => vi.fn()),
    load: vi.fn().mockResolvedValue({
      ...safe,
      credential: secret,
      notes: [{ body: "PRIVATE_NOTE" }],
      revision: 44,
    }),
  };
  const view = render(
    <RequesterTrackingPage session={session} baseUrl="/api/v1" />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
    safe.issue.name,
  );
  expect(screen.getByText("SYNTHETIC-44")).toBeInTheDocument();
  expect(screen.getByText("In Progress")).toBeInTheDocument();
  expect(view.container.querySelector("img,script,svg")).toBeNull();
  expect(view.container.textContent).not.toContain(secret);
  expect(view.container.textContent).not.toContain("PRIVATE_NOTE");
  for (const text of [
    "Assignment",
    "Watchers",
    "Internal Notes",
    "Request Activity",
    "Requester Contact",
    "Requester Communication",
    "Dashboard",
    "Staff Service Requests",
  ])
    expect(screen.queryByText(text)).not.toBeInTheDocument();
});
test("F063.1 service team updates render as text, newest first, beside existing tracking details", async () => {
  const session = {
    retain: vi.fn(() => vi.fn()),
    load: vi.fn().mockResolvedValue({
      ...safe,
      updates: [
        {
          id: "b",
          body: "Second\n<script>alert(1)</script>",
          createdAt: "2026-09-23T00:00:00Z",
          sender: { displayName: "Service team" },
        },
        {
          id: "a",
          body: "First update",
          createdAt: "2026-09-22T00:00:00Z",
          sender: { displayName: "Service team" },
        },
      ],
    }),
  };
  const view = render(
    <RequesterTrackingPage session={session} baseUrl="/api/v1" />,
  );
  expect(
    await screen.findByRole("heading", {
      level: 2,
      name: "Updates from the Service Team",
    }),
  ).toBeInTheDocument();
  const list = screen.getByRole("list", {
    name: "Updates from the service team, newest first",
  });
  const entries = list.querySelectorAll("li");
  expect(entries).toHaveLength(2);
  expect(entries[0].querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-09-23T00:00:00Z",
  );
  expect(entries[0].querySelector(".tracking-update-body").textContent).toBe(
    "Second\n<script>alert(1)</script>",
  );
  expect(entries[1].textContent).toContain("First update");
  expect(list.querySelectorAll("strong")[0]).toHaveTextContent("Service team");
  // Script-looking content is text, never markup, and existing details remain.
  expect(view.container.querySelector("img,script,svg")).toBeNull();
  expect(screen.getByText("SYNTHETIC-44")).toBeInTheDocument();
  expect(screen.getByText("In Progress")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Description" })).toBeVisible();
  expect(view.container.textContent).not.toContain(secret);
});
test.each([[], undefined])(
  "F063.1 an empty or absent update collection shows a clear empty state",
  async (updates) => {
    const session = {
      retain: vi.fn(() => vi.fn()),
      load: vi.fn().mockResolvedValue({ ...safe, updates }),
    };
    render(<RequesterTrackingPage session={session} baseUrl="/api/v1" />);
    expect(
      await screen.findByText(/There are no updates yet/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("SYNTHETIC-44")).toBeInTheDocument();
  },
);
test("F063.1 the session whitelists update fields, drops malformed entries and caps the page", async () => {
  window.history.replaceState(null, "", `/track#${secret}`);
  const session = createTrackingSession();
  const release = session.retain();
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ...safe,
      updates: [
        {
          id: "keep",
          body: "Kept",
          createdAt: "2026-09-22T00:00:00Z",
          sender: {
            displayName: "Service team",
            email: "staff@example.invalid",
          },
          authorDisplayName: "Fictional employee",
          direction: "outbound",
        },
        {
          id: "no-body",
          createdAt: "2026-09-22T00:00:00Z",
          sender: { displayName: "x" },
        },
        {
          id: "bad-date",
          body: "x",
          createdAt: "not-a-date",
          sender: { displayName: "x" },
        },
        { id: "no-sender", body: "x", createdAt: "2026-09-22T00:00:00Z" },
        null,
        ...Array.from({ length: 30 }, (_value, index) => ({
          id: `extra-${index}`,
          body: "Extra",
          createdAt: "2026-09-21T00:00:00Z",
          sender: { displayName: "Service team" },
        })),
      ],
    }),
  });
  const data = await session.load("/api/v1", undefined, fetcher);
  expect(data.updates).toHaveLength(25);
  expect(data.updates[0]).toEqual({
    id: "keep",
    body: "Kept",
    createdAt: "2026-09-22T00:00:00Z",
    sender: { displayName: "Service team" },
  });
  expect(data.updates.map((update) => update.id)).not.toContain("no-body");
  expect(JSON.stringify(data)).not.toContain("Fictional employee");
  expect(JSON.stringify(data)).not.toContain("staff@example.invalid");
  expect(JSON.stringify(data)).not.toContain(secret);
  release();
  await Promise.resolve();
  window.history.replaceState(null, "", "/");
});
test("F063.1 a non-array update collection cannot break the tracking read", async () => {
  window.history.replaceState(null, "", `/track#${secret}`);
  const session = createTrackingSession();
  const release = session.retain();
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...safe, updates: "x" }),
  });
  await expect(
    session.load("/api/v1", undefined, fetcher),
  ).resolves.toMatchObject({ reference: "SYNTHETIC-44", updates: [] });
  release();
  await Promise.resolve();
  window.history.replaceState(null, "", "/");
});
test.each(["unavailable", "temporary"])(
  "F044 tracking %s is safe and retry only offered for temporary failure",
  async (error) => {
    const session = {
      retain: () => () => {},
      load: vi.fn().mockRejectedValue(new Error(error)),
    };
    render(<RequesterTrackingPage session={session} baseUrl="/api/v1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      error === "unavailable"
        ? "This tracking link is unavailable."
        : "We couldn't load this request right now.",
    );
    expect(!!screen.queryByRole("button", { name: "Try again" })).toBe(
      error === "temporary",
    );
  },
);
test("F044 StrictMode lifecycle preserves an active session but navigation clears it", async () => {
  window.history.replaceState(null, "", `/track#${secret}`);
  const session = createTrackingSession();
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, json: async () => safe });
  const view = render(
    <StrictMode>
      <RequesterTrackingPage session={session} baseUrl="/api/v1" />
    </StrictMode>,
  );
  await screen.findByText("SYNTHETIC-44");
  view.unmount();
  await Promise.resolve();
  await expect(session.load("/api/v1")).rejects.toThrow("unavailable");
  fetcher.mockRestore();
  window.history.replaceState(null, "", "/");
});
test("F044 no management permission causes no fetch or control", () => {
  const repository = { trackingState: vi.fn() };
  render(<RequesterTracking repository={repository} id={id} allowed={false} />);
  expect(screen.getByText("Protected")).toBeInTheDocument();
  expect(repository.trackingState).not.toHaveBeenCalled();
  expect(screen.queryByRole("button")).toBeNull();
});
test("F044 issue shows link once; close clears it; rotation/revocation require confirmation", async () => {
  const user = userEvent.setup();
  let current = { status: "not_issued", version: null };
  const repository = {
    trackingState: vi.fn(async () => current),
    changeTracking: vi.fn(async (_id, op) => {
      current = { status: op === "revoke" ? "revoked" : "active", version: id };
      return { ...current, ...(op !== "revoke" ? { credential: secret } : {}) };
    }),
  };
  render(<RequesterTracking repository={repository} id={id} allowed />);
  const trigger = screen.getByRole("button", {
    name: "Manage request tracker",
  });
  await user.click(trigger);
  await user.click(
    await screen.findByRole("button", { name: "Create tracking link" }),
  );
  expect(await screen.findByLabelText("New tracking link")).toHaveValue(
    `${window.location.origin}/track#${secret}`,
  );
  await user.click(screen.getByRole("button", { name: "Copy tracking link" }));
  expect(await screen.findByText("Tracking link copied.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close", exact: true }));
  expect(screen.queryByLabelText("New tracking link")).toBeNull();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(
    await screen.findByRole("button", { name: "Rotate tracking link" }),
  );
  expect(repository.changeTracking).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/invalidate the current link/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm rotation" }));
  await screen.findByLabelText("New tracking link");
  await user.click(
    screen.getByRole("button", { name: "Revoke tracking link" }),
  );
  expect(repository.changeTracking).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Confirm revocation" }));
  await screen.findByRole("button", { name: "Create new tracking link" });
  expect(screen.queryByLabelText("New tracking link")).toBeNull();
});
test("F065 management distinguishes expired from active and names the automatic issuer", async () => {
  const user = userEvent.setup();
  // Stored as active, because expiry is a predicate rather than a status.
  const current = {
    status: "active",
    version: id,
    expired: true,
    expiresAt: "2026-10-01T00:00:00.000Z",
    issuerType: "requester_intake",
  };
  const repository = {
    trackingState: vi.fn(async () => current),
    changeTracking: vi.fn(),
  };
  render(<RequesterTracking repository={repository} id={id} allowed />);
  // The summary must not call a dead link Active.
  expect(await screen.findByText(/Expired/)).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Manage request tracker" }),
  );
  expect(await screen.findByText("Expired")).toBeInTheDocument();
  // Formatted for the viewer's locale and zone, so the expectation is derived
  // rather than hard-coded to one calendar date.
  expect(screen.getByText(`Expired ${longDate(current.expiresAt)}`)).toBeInTheDocument();
  expect(
    screen.getByText(/Issued automatically when the requester submitted/),
  ).toBeInTheDocument();
  expect(screen.getByText(/no longer works/)).toBeInTheDocument();
  // Rotation remains the action, because one active credential already exists.
  expect(
    screen.getByRole("button", { name: "Rotate tracking link" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create tracking link" }),
  ).toBeNull();
  expect(repository.changeTracking).not.toHaveBeenCalled();
});
test("F065 a live credential reports its expiry without claiming it has expired", async () => {
  const user = userEvent.setup();
  const current = {
    status: "active",
    version: id,
    expired: false,
    expiresAt: "2027-04-14T00:00:00.000Z",
    issuerType: "staff",
  };
  const repository = {
    trackingState: vi.fn(async () => current),
    changeTracking: vi.fn(),
  };
  render(<RequesterTracking repository={repository} id={id} allowed />);
  await user.click(
    screen.getByRole("button", { name: "Manage request tracker" }),
  );
  expect(await screen.findByText("Active")).toBeInTheDocument();
  expect(screen.getByText(`Expires ${longDate(current.expiresAt)}`)).toBeInTheDocument();
  expect(screen.queryByText(/no longer works/)).toBeNull();
  expect(
    screen.queryByText(/Issued automatically when the requester submitted/),
  ).toBeNull();
});
test("F044 duplicate activation sends one mutation and denied result clears controls", async () => {
  let reject;
  const repository = {
    trackingState: vi
      .fn()
      .mockResolvedValue({ status: "not_issued", version: null }),
    changeTracking: vi.fn(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    ),
  };
  const failure = vi.fn();
  render(
    <RequesterTracking
      repository={repository}
      id={id}
      allowed
      onAccessFailure={failure}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Manage request tracker" }),
  );
  const create = await screen.findByRole("button", {
    name: "Create tracking link",
  });
  fireEvent.click(create);
  fireEvent.click(create);
  expect(repository.changeTracking).toHaveBeenCalledTimes(1);
  expect(create).toBeDisabled();
  reject({ status: 403 });
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("New tracking link")).toBeNull();
  expect(failure).toHaveBeenCalled();
});
test("F044 management permission loss removes live one-time link", async () => {
  const repository = {
    trackingState: vi
      .fn()
      .mockResolvedValue({ status: "not_issued", version: null }),
    changeTracking: vi
      .fn()
      .mockResolvedValue({ status: "active", version: id, credential: secret }),
  };
  const view = render(
    <RequesterTracking repository={repository} id={id} allowed />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Manage request tracker" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Create tracking link" }),
  );
  await screen.findByLabelText("New tracking link");
  view.rerender(
    <RequesterTracking repository={repository} id={id} allowed={false} />,
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Protected")).toBeInTheDocument();
});
