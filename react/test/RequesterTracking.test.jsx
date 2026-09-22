import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import RequesterTracking from "../src/staff/requests/RequesterTracking.jsx";
import RequesterTrackingPage from "../src/tracking/RequesterTrackingPage.jsx";
import { createTrackingSession } from "../src/tracking/trackingSession.js";

const id = "10000000-0000-4000-8000-000000000001";
const secret = "A".repeat(43);
const safe = {
  reference: "SYNTHETIC-44",
  issue: { name: "<img src=x onerror=alert(1)>", icon: "<svg>" },
  status: "in_progress",
  submittedAt: "2026-09-21T00:00:00Z",
  serviceLocation: "<script>fictional</script>",
  description: "Synthetic\n<script>text only</script>",
};
test("F044 consumes a link arriving between bootstrap and page mount", async () => {
  window.history.replaceState(null, "", "/track");
  const session = createTrackingSession();
  // A same-document navigation can finish while the lazy page is still loading.
  window.history.replaceState(null, "", `/track#${secret}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  const release = session.retain();
  expect(window.location.hash).toBe("");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => safe });
  await expect(session.load("/api/v1", undefined, fetcher)).resolves.toEqual(safe);
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
    name: "Manage requester tracking",
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
    screen.getByRole("button", { name: "Manage requester tracking" }),
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
    screen.getByRole("button", { name: "Manage requester tracking" }),
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
