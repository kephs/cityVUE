import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import RequesterTrackingPage from "../src/tracking/RequesterTrackingPage.jsx";
import { createTrackingSession } from "../src/tracking/trackingSession.js";
import {
  lastResidentUpdateAt,
  requestLifecycle,
  residentStatusSummary,
} from "../src/tracking/residentTracking.js";

const secret = "A".repeat(43);

const update = (suffix, body, createdAt) => ({
  id: `10000000-0000-4000-8000-00000000000${suffix}`,
  body,
  createdAt,
  sender: { displayName: "Service team" },
});

const projection = (overrides = {}) => ({
  reference: "SYNTHETIC-67",
  issue: { name: "Streetlight out", icon: "lightbulb" },
  status: "in_progress",
  submittedAt: "2026-09-21T00:00:00Z",
  serviceLocation: "100 Fictional Street",
  description: "The light has been dark for a week.",
  updates: [
    update(2, "Crew scheduled for Thursday.", "2026-09-24T00:00:00Z"),
    update(1, "Request received.", "2026-09-22T00:00:00Z"),
  ],
  ...overrides,
});

/** A session stub: the page never sees a raw credential, only the projection. */
function stubSession(result) {
  return {
    retain: () => () => {},
    subscribe: () => () => {},
    load: vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
  };
}

const clipboard = (writeText) => ({ navigator: { clipboard: { writeText } } });

async function renderPage(result, browser = clipboard(vi.fn())) {
  const session = stubSession(result);
  render(
    <StrictMode>
      <RequesterTrackingPage
        session={session}
        baseUrl="/api/v1"
        browser={browser}
      />
    </StrictMode>,
  );
  return session;
}

// --- Scenario 6: status mapping and lifecycle grouping (pure) ---

test("F067 every resident-visible status maps to a lifecycle, wording and description", () => {
  expect(requestLifecycle("open")).toBe("active");
  expect(requestLifecycle("in_progress")).toBe("active");
  expect(requestLifecycle("closed")).toBe("completed");
  expect(requestLifecycle("cancelled")).toBe("cancelled");
  // Anything the projection did not promise is unknown, never silently active.
  for (const value of ["unavailable", "on_hold", "", null, undefined, 7])
    expect(requestLifecycle(value)).toBe("unknown");
  for (const status of [
    "open",
    "in_progress",
    "closed",
    "cancelled",
    "unavailable",
  ]) {
    const summary = residentStatusSummary(status);
    expect(summary.label).toMatch(/\S/);
    expect(summary.icon).toMatch(/\S/);
    expect(summary.description).toMatch(/\S/);
  }
  // An unmapped status falls back to the unavailable wording, not to a blank.
  expect(residentStatusSummary("fictional").description).toBe(
    residentStatusSummary("unavailable").description,
  );
});

test("F067 active, completed and cancelled requests are described distinctly", () => {
  const described = ["open", "in_progress", "closed", "cancelled"].map(
    (status) => residentStatusSummary(status).description,
  );
  expect(new Set(described).size).toBe(4);
  expect(residentStatusSummary("closed").label).not.toBe(
    residentStatusSummary("cancelled").label,
  );
  expect(residentStatusSummary("open").label).toBe(
    residentStatusSummary("in_progress").label,
  );
});

// --- Last-update derivation ---

test("F067 last update is the newest resident-visible update regardless of order", () => {
  expect(
    lastResidentUpdateAt([
      update(1, "older", "2026-09-22T00:00:00Z"),
      update(2, "newer", "2026-09-24T00:00:00Z"),
    ]),
  ).toBe("2026-09-24T00:00:00Z");
  expect(lastResidentUpdateAt([])).toBeNull();
  expect(lastResidentUpdateAt(undefined)).toBeNull();
  // A malformed timestamp is skipped rather than poisoning the maximum.
  expect(
    lastResidentUpdateAt([
      { createdAt: "not-a-date" },
      update(1, "real", "2026-09-23T00:00:00Z"),
    ]),
  ).toBe("2026-09-23T00:00:00Z");
  expect(lastResidentUpdateAt([{ createdAt: "not-a-date" }])).toBeNull();
});

// --- Scenario 1: a valid credential renders the resident view ---

test("F067 a resolved request shows reference, status meaning and last update", async () => {
  await renderPage(projection());
  expect(await screen.findByText("SYNTHETIC-67")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Streetlight out",
  );
  expect(screen.getByText("In Progress")).toBeTruthy();
  expect(screen.getByText("Active request")).toBeTruthy();
  expect(
    screen.getByText("The service team is working on this request."),
  ).toBeTruthy();
  const submitted = screen.getByText("Submitted").parentElement;
  expect(within(submitted).getByText(/2026/)).toBeTruthy();
  const last = screen.getByText("Last update").parentElement;
  expect(
    within(last).getByRole("time").getAttribute("datetime"),
  ).toBe("2026-09-24T00:00:00Z");
});

test("F067 a completed request is distinguished from a cancelled one", async () => {
  await renderPage(projection({ status: "closed" }));
  expect(await screen.findByText("Completed request")).toBeTruthy();
  expect(
    screen.getByText(
      "Work on this request is finished. No further action is planned for it.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Cancelled request")).toBeNull();
});

// --- Scenario 7: chronological timeline ---

test("F067 the timeline keeps server order, is an ordered list and is counted", async () => {
  await renderPage(projection());
  const list = await screen.findByRole("list", {
    name: "Updates from the service team, newest first",
  });
  expect(list.tagName).toBe("OL");
  const items = within(list).getAllByRole("listitem");
  expect(items.map((item) => item.querySelector("time").dateTime)).toEqual([
    "2026-09-24T00:00:00Z",
    "2026-09-22T00:00:00Z",
  ]);
  expect(screen.getByText("2 updates, newest first.")).toBeTruthy();
  // Each timestamp is machine-readable, not only a formatted string.
  for (const item of items)
    expect(item.querySelector("time").getAttribute("datetime")).toMatch(
      /^2026-/,
    );
});

test("F067 a single update is counted in the singular", async () => {
  await renderPage(
    projection({ updates: [update(1, "Only one.", "2026-09-22T00:00:00Z")] }),
  );
  expect(await screen.findByText("1 update, newest first.")).toBeTruthy();
});

// --- Scenario 10: empty and loading states ---

test("F067 an empty timeline explains itself and reports no last update", async () => {
  await renderPage(projection({ updates: [] }));
  expect(
    await screen.findByText(
      /There are no updates yet\. Any updates the service team adds/,
    ),
  ).toBeTruthy();
  const last = screen.getByText("Last update").parentElement;
  expect(within(last).getByText("No updates yet")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});

test("F067 a pending read announces loading to assistive technology", async () => {
  const session = {
    retain: () => () => {},
    subscribe: () => () => {},
    load: () => new Promise(() => {}),
  };
  render(
    <RequesterTrackingPage
      session={session}
      baseUrl="/api/v1"
      browser={clipboard(vi.fn())}
    />,
  );
  const loading = screen.getByRole("status");
  expect(loading.textContent).toMatch(/Loading request/);
});

// --- Scenarios 2 and 3: expired, revoked and invalid links are uniform ---

test("F067 expired, revoked and invalid links give one message that discloses nothing", async () => {
  await renderPage(new Error("unavailable"));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This tracking link is unavailable.");
  const page = screen.getByRole("main");
  // The guidance must not name which of the three causes applied, and must
  // not leak any request information.
  expect(page.textContent).not.toMatch(
    /expired on|was revoked|revoked by|does not exist|no such request/i,
  );
  expect(page.textContent).not.toMatch(/SYNTHETIC|Streetlight/);
  expect(page.textContent).toMatch(/contact the service team/i);
  expect(
    screen.getByRole("link", { name: "Go to the Reqro home page" })
      .getAttribute("href"),
  ).toBe("/");
  // An unavailable link offers no retry: retrying cannot change the outcome.
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("F067 a temporary failure is retryable and distinct from an unavailable link", async () => {
  const session = {
    retain: () => () => {},
    subscribe: () => () => {},
    load: vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(projection()),
  };
  render(
    <RequesterTrackingPage
      session={session}
      baseUrl="/api/v1"
      browser={clipboard(vi.fn())}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /couldn.t load this request right now/,
  );
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("SYNTHETIC-67")).toBeTruthy();
  expect(session.load).toHaveBeenCalledTimes(2);
});

// --- Scenario 11: accessibility and keyboard navigation ---

test("F067 the resident view is reachable and operable by keyboard alone", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  await renderPage(projection(), clipboard(writeText));
  const copy = await screen.findByRole("button", {
    name: "Copy request reference",
  });
  await userEvent.tab();
  // The copy control is the first interactive element in the article.
  expect(document.activeElement).toBe(copy);
  await userEvent.keyboard("{Enter}");
  expect(writeText).toHaveBeenCalledWith("SYNTHETIC-67");
  await waitFor(() =>
    expect(screen.getByText("Request reference copied.")).toBeTruthy(),
  );
  await userEvent.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("link", { name: "Report another request" }),
  );
});

test("F067 headings and landmarks describe each region for a screen reader", async () => {
  await renderPage(projection());
  await screen.findByText("SYNTHETIC-67");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  for (const name of [
    "Current status",
    "Service Location",
    "Description",
    "Updates from the Service Team",
  ])
    expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
  // The status region is named even though its heading is visually hidden.
  expect(
    screen.getByRole("heading", { level: 2, name: "Current status" }).className,
  ).toMatch(/visually-hidden/);
  // Status meaning never rests on color: the badge and the lifecycle both
  // carry text, and the icons are hidden from assistive technology.
  const status = screen
    .getByRole("heading", { level: 2, name: "Current status" })
    .closest("section");
  expect(status.textContent).toMatch(/In Progress/);
  expect(status.textContent).toMatch(/Active request/);
  for (const icon of status.querySelectorAll("i"))
    expect(icon.getAttribute("aria-hidden")).toBe("true");
});

test("F067 a failed copy tells the resident what to do instead", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  await renderPage(projection(), clipboard(writeText));
  await userEvent.click(
    await screen.findByRole("button", { name: "Copy request reference" }),
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        "Copy is unavailable. Select and copy the reference above.",
      ),
    ).toBeTruthy(),
  );
});

// --- Scenario 12: mobile-friendly presentation ---

test("F067 the new regions collapse on a narrow viewport", () => {
  const css = readFileSync(
    resolve(process.cwd(), "react/src/tracking/tracking.css"),
    "utf8",
  );
  const narrow = css.slice(css.lastIndexOf("@media (max-width: 480px)"));
  expect(narrow).toMatch(/\.tracking-reference\s*\{[^}]*flex-direction:\s*column/);
  expect(narrow).toMatch(/\.tracking-dates\s*\{[^}]*flex-direction:\s*column/);
  // Long references and bodies must wrap rather than overflow a phone.
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
});

// --- Scenarios 13, 14 and 15: credential confidentiality is preserved ---

test("F067 the page renders no credential and persists nothing", async () => {
  window.history.replaceState(null, "", `/track#${secret}`);
  const session = createTrackingSession();
  const release = session.retain();
  // The fragment is scrubbed before anything can render it.
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("");
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => projection(),
  });
  const data = await session.load("/api/v1", undefined, fetcher);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("/api/v1/requester-tracking");
  expect(url).not.toContain(secret);
  expect(init.headers["X-Requester-Tracking"]).toBe(secret);
  expect(JSON.stringify(data)).not.toContain(secret);
  render(
    <RequesterTrackingPage
      session={{ ...session, load: async () => data }}
      baseUrl="/api/v1"
      browser={clipboard(vi.fn())}
    />,
  );
  await screen.findByText("SYNTHETIC-67");
  expect(document.body.innerHTML).not.toContain(secret);
  expect(document.title).not.toContain(secret);
  expect(window.location.href).not.toContain(secret);
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
  release();
  window.history.replaceState(null, "", "/");
});

test("F067 copying the reference never reaches for the credential", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  await renderPage(projection(), clipboard(writeText));
  await userEvent.click(
    await screen.findByRole("button", { name: "Copy request reference" }),
  );
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toBe("SYNTHETIC-67");
  expect(writeText.mock.calls[0][0]).not.toContain(secret);
});

// --- Scenario 9: nothing beyond the resident-visible fields is rendered ---

test("F067 staff-only and internal fields in a response cannot reach the page", async () => {
  const session = createTrackingSession();
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ...projection(),
      assignedTo: "F067 Fictional Staff",
      internalNotes: ["do not disclose"],
      updates: [
        {
          ...update(1, "Visible update.", "2026-09-22T00:00:00Z"),
          direction: "outbound",
          internalOnly: "must not survive",
          sender: { displayName: "Service team", email: "staff@example.test" },
        },
      ],
    }),
  });
  window.history.replaceState(null, "", `/track#${secret}`);
  const release = session.retain();
  const data = await session.load("/api/v1", undefined, fetcher);
  // The session re-whitelists, so the extra fields never enter UI state.
  expect(Object.keys(data.updates[0])).toEqual([
    "id",
    "body",
    "createdAt",
    "sender",
  ]);
  expect(Object.keys(data.updates[0].sender)).toEqual(["displayName"]);
  expect(data.assignedTo).toBeUndefined();
  expect(data.internalNotes).toBeUndefined();
  render(
    <RequesterTrackingPage
      session={{ ...session, load: async () => data }}
      baseUrl="/api/v1"
      browser={clipboard(vi.fn())}
    />,
  );
  await screen.findByText("SYNTHETIC-67");
  const page = screen.getByRole("main").textContent;
  expect(page).not.toMatch(/Fictional Staff|do not disclose|must not survive/);
  expect(page).not.toContain("staff@example.test");
  release();
  window.history.replaceState(null, "", "/");
});
