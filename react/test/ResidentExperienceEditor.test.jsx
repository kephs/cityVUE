import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
  within,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import ResidentExperienceEditor from "../src/admin/ResidentExperienceEditor.jsx";
import { AdminConfiguration } from "../src/admin/AdminConfigurationPage.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import { useAuth } from "../src/auth/AuthContext.jsx";
import {
  publishedSnapshotFixture,
  publishedExperienceFixture,
} from "./fixtures/residentExperience.js";
import { loadResidentExperience } from "../src/pages/home/residentExperienceRepository.js";
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn() }));
vi.mock("../src/alerts/alertsRepository.js", () => ({
  loadActiveAlerts: vi.fn(async () => []),
}));
const base = "/admin/resident-experience";
function summary(contact = true) {
  return {
    revision: 2,
    draft: publishedSnapshotFixture(),
    hasPublication: true,
    consequential: false,
    capabilities: { canWrite: true, canManageContacts: contact },
    registry: {
      assets: {
        "reqro-mark": { role: "logo" },
        "reqro-wordmark": { role: "wordmark" },
        "reqro-favicon": { role: "favicon" },
        "reqro-scenery": { role: "hero" },
      },
      actionIcons: ["report", "emergency", "water"],
      benefitIcons: ["residents", "responsive", "operations", "community"],
      themes: ["reqro"],
      routes: ["/", "/report"],
      tones: ["primary", "danger", "warning"],
    },
  };
}
function approvedReview(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    targetRevisionId: "22222222-2222-4222-8222-222222222222",
    baselineRevisionId: "33333333-3333-4333-8333-333333333333",
    draftRevisionId: "22222222-2222-4222-8222-222222222222",
    resourceRevision: 2,
    purpose: "draft",
    policyVersion: "1",
    classifierVersion: "1",
    latestRequestId: "11111111-1111-4111-8111-111111111111",
    changes: {
      changedFields: ["hero"],
      reasons: [],
      consequential: false,
    },
    decision: {
      id: "44444444-4444-4444-8444-444444444444",
      outcome: "approved",
      decidedAt: "2026-10-04T12:00:00.000Z",
      expiresAt: "2099-10-04T12:00:00.000Z",
    },
    usability: { usable: true, reason: "approved" },
    canReview: true,
    canPublish: true,
    ...overrides,
  };
}
function clientFor(value = summary()) {
  return {
    get: vi.fn(async (path) => {
      if (path.endsWith("/preview"))
        return {
          revision: value.revision,
          unpublished: true,
          presentation: publishedExperienceFixture(),
        };
      if (path.endsWith("/review-context"))
        return {
          resourceRevision: value.revision,
          draftRevisionId: value.review?.targetRevisionId || null,
          publishedRevisionId: null,
          latestRequestId: value.review?.id || null,
          canRequestReview: value.canRequestReview ?? false,
        };
      if (path.includes("/review-requests/")) return value.review;
      return value;
    }),
    post: vi.fn(async (path, body) => {
      if (path.endsWith("/review-requests")) {
        value.review = approvedReview({
          decision: null,
          usability: { usable: false, reason: "pending" },
          targetRevisionId:
            value.review?.targetRevisionId ||
            "22222222-2222-4222-8222-222222222222",
          resourceRevision: body.expectedRevision,
          changes: {
            changedFields: ["hero"],
            reasons: [],
            consequential: false,
          },
        });
        return value.review;
      }
      if (path.includes("/decision")) {
        value.review = {
          ...value.review,
          decision: {
            ...value.review.decision,
            outcome: body.outcome,
          },
          usability:
            body.outcome === "approved"
              ? { usable: true, reason: null }
              : { usable: false, reason: "rejected" },
          canPublish: false,
        };
        return value.review;
      }
      value.review = value.review
        ? { ...value.review, usability: { usable: false, reason: "consumed" } }
        : value.review;
      return {
        eventId: "55555555-5555-4555-8555-555555555555",
        targetRevisionId: value.review?.targetRevisionId,
        previousPublishedRevisionId: value.review?.baselineRevisionId,
        resourceRevision: value.revision + 1,
        publishedAt: "2026-10-04T12:00:00.000Z",
        consequential: Boolean(value.review?.changes?.consequential),
      };
    }),
    put: vi.fn(async (_path, command) => {
      value = {
        ...value,
        revision: value.revision + 1,
        draft: command.snapshot,
      };
      return { revision: value.revision, changed: true };
    }),
  };
}
function app(client) {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <ResidentExperienceEditor client={client} />
      </ThemeProvider>
    </MemoryRouter>
  );
}
beforeEach(() =>
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    account: { homeAccountId: "staff", tenantId: "tenant" },
  }),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("Branding is selected initially, only the active panel is visible, and preview excludes unsaved edits", async () => {
  const client = clientFor();
  render(app(client));
  const name = await screen.findByLabelText("Public application name");
  const navigation = screen.getByRole("tablist", {
    name: "Resident Experience sections",
  });
  const tabs = within(navigation).getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    "Branding",
    "Hero",
    "Resident Actions",
    "Contacts",
    "Benefits",
    "Footer",
  ]);
  expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  for (const tab of tabs) {
    const target = document.getElementById(tab.getAttribute("aria-controls"));
    expect(target).toHaveAttribute("aria-labelledby", tab.id);
    if (tab === tabs[0]) expect(target).toBeVisible();
    else expect(target).not.toBeVisible();
  }
  expect(screen.getByText("Saved", { exact: true })).toBeVisible();
  fireEvent.change(name, { target: { value: "Unsaved community" } });
  expect(screen.getByText("Unsaved changes", { selector: "dd" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Footer" }));
  const preview = screen.getByRole("button", { name: "Preview saved draft" });
  expect(preview).toBeEnabled();
  expect(preview).toHaveAccessibleDescription(
    "Preview shows the saved draft. Save changes to include your edits.",
  );
  fireEvent.click(preview);
  const dialog = await screen.findByRole("dialog", {
    name: "Unpublished Preview",
  });
  expect(within(dialog).queryByText("Unsaved community")).toBeNull();
  expect(client.put).not.toHaveBeenCalled();
});
test("new draft status explains unavailable preview and does not collapse validation errors", async () => {
  const client = clientFor({
    ...summary(),
    draft: null,
    hasPublication: false,
  });
  render(app(client));
  const name = await screen.findByLabelText("Public application name");
  expect(screen.getByText("Not saved yet")).toBeVisible();
  expect(screen.getByText("No publication exists")).toBeVisible();
  const preview = screen.getByRole("button", { name: "Preview saved draft" });
  expect(preview).toBeDisabled();
  expect(preview).toHaveAccessibleDescription(
    "Save a draft before preview is available.",
  );
  fireEvent.change(name, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  expect(
    await screen.findByText("Public application name is required."),
  ).toBeVisible();
  expect(screen.getByRole("tabpanel", { name: "Branding" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  expect(screen.getByText(/No contacts configured yet/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Add contact" })).toBeEnabled();
  expect(client.put).not.toHaveBeenCalled();
});
test("loads complete saved draft and saves ordinary branding without deleting restricted fields", async () => {
  const value = summary(false),
    client = clientFor(value);
  render(app(client));
  const name = await screen.findByLabelText("Public application name");
  fireEvent.change(name, { target: { value: "Changed community" } });
  fireEvent.click(screen.getByRole("tab", { name: "Contacts" }));
  expect(screen.getAllByLabelText("Display phone")[0]).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  await screen.findByText("Draft saved. Public content is unchanged.");
  const [path, command, options] = client.put.mock.calls[0];
  expect(path).toBe(base + "/draft");
  expect(command.expectedRevision).toBe(2);
  expect(command.snapshot.presentation.branding.applicationName).toBe(
    "Changed community",
  );
  expect(command.snapshot.contacts).toEqual(value.draft.contacts);
  expect(command.snapshot.actions).toEqual(value.draft.actions);
  expect(options.authenticated).toBe(true);
});
test("contact authority enables structured editing and derives dialing target from display number", async () => {
  const client = clientFor();
  render(app(client));
  fireEvent.click(await screen.findByRole("tab", { name: "Contacts" }));
  const phones = await screen.findAllByLabelText("Display phone");
  fireEvent.change(phones[1], { target: { value: "202-555-0100" } });
  expect(screen.getAllByLabelText("Dialing target")[1]).toHaveValue(
    "2025550100",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  await screen.findByText("Draft saved. Public content is unchanged.");
  expect(client.put.mock.calls[0][1].snapshot.contacts[1].phoneTarget).toBe(
    "2025550100",
  );
});
test("duplicate order and missing required text show useful validation without PUT", async () => {
  const client = clientFor();
  render(app(client));
  await screen.findByLabelText("Public application name");
  fireEvent.click(screen.getByRole("tab", { name: "Resident Actions" }));
  fireEvent.change(screen.getAllByLabelText("Order")[1], {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
  fireEvent.change(screen.getByLabelText("Public application name"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  expect(
    await screen.findByText("Actions: use unique order numbers."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Public application name is required."),
  ).toBeInTheDocument();
  expect(client.put).not.toHaveBeenCalled();
  expect(
    screen.getByRole("tab", { name: "Resident Actions" }),
  ).toHaveAccessibleDescription("Unsaved changes; 1 validation error");
  fireEvent.click(screen.getByRole("tab", { name: "Footer" }));
  expect(screen.getByText("Actions: use unique order numbers.")).toBeVisible();
  expect(
    screen.getByText("Public application name is required."),
  ).toBeVisible();
});
test("cross-tab edits persist without requests and global Save submits the complete draft", async () => {
  const client = clientFor();
  const initial = summary().draft;
  render(app(client));
  fireEvent.change(await screen.findByLabelText("Public application name"), {
    target: { value: "Edited branding" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Hero" }));
  fireEvent.change(screen.getByLabelText("Tagline word 1"), {
    target: { value: "Together" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Footer" }));
  fireEvent.change(screen.getByLabelText("Footer message"), {
    target: { value: "Edited footer" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Branding" }));
  expect(screen.getByLabelText("Public application name")).toHaveValue(
    "Edited branding",
  );
  expect(screen.getByRole("tab", { name: "Hero" })).toHaveAccessibleDescription(
    "Unsaved changes",
  );
  expect(client.get).toHaveBeenCalledTimes(2);
  expect(client.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: "Benefits" }));
  const save = screen.getByRole("button", { name: "Save complete draft" });
  expect(save.closest('[role="tabpanel"]')).toBeNull();
  fireEvent.click(save);
  await screen.findByText("Draft saved. Public content is unchanged.");
  const command = client.put.mock.calls[0][1];
  expect(command.expectedRevision).toBe(2);
  expect(command.snapshot).toEqual({
    ...initial,
    presentation: {
      ...initial.presentation,
      branding: {
        ...initial.presentation.branding,
        applicationName: "Edited branding",
      },
      hero: {
        ...initial.presentation.hero,
        taglineWords: [
          "Together",
          ...initial.presentation.hero.taglineWords.slice(1),
        ],
      },
      footer: { ...initial.presentation.footer, tagline: "Edited footer" },
    },
  });
  expect(screen.getByRole("tab", { name: "Benefits" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "Hero" })).not.toHaveAttribute(
    "aria-describedby",
  );
});
test("keyboard arrows wrap tabs, Home and End select endpoints, and Tab reaches the active panel", async () => {
  const user = userEvent.setup();
  render(app(clientFor()));
  const branding = await screen.findByRole("tab", { name: "Branding" });
  branding.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Hero" })).toHaveFocus();
  expect(screen.getByRole("tabpanel", { name: "Hero" })).toBeVisible();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Footer" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(branding).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Footer" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(branding).toHaveFocus();
  expect(
    screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0),
  ).toEqual([branding]);
  await user.tab();
  expect(screen.getByRole("tabpanel", { name: "Branding" })).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText("Public application name")).toHaveFocus();
});
test("read-only staff can switch every tab without gaining editing controls", async () => {
  const value = summary(false);
  value.capabilities.canWrite = false;
  const client = clientFor(value);
  render(app(client));
  await screen.findByRole("tab", { name: "Branding" });
  for (const tab of screen.getAllByRole("tab")) {
    fireEvent.click(tab);
    const panel = screen.getByRole("tabpanel");
    for (const field of panel.querySelectorAll(
      "input:not([readonly]), select, button",
    ))
      expect(field).toBeDisabled();
  }
  expect(
    screen.getByRole("button", { name: "Save complete draft" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Preview saved draft" }),
  ).toBeEnabled();
  expect(client.get).toHaveBeenCalledTimes(2);
  expect(client.put).not.toHaveBeenCalled();
});
test("approved review exposes distinct Publish control and exact confirmation request", async () => {
  const value = { ...summary(), review: approvedReview() };
  const client = clientFor(value);
  render(app(client));
  await screen.findByRole("button", { name: "Publish reviewed revision" });
  expect(
    screen.getByRole("button", { name: "Save complete draft" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Publish reviewed revision" }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Publish reviewed revision?",
  });
  expect(
    within(dialog).getByRole("button", { name: "Confirm publication" }),
  ).toHaveFocus();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(client.post).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Publish reviewed revision" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Confirm publication",
    }),
  );
  await screen.findByText(/published successfully/);
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(client.post.mock.calls[0][0]).toBe(base + "/publications");
  expect(client.post.mock.calls[0][1]).toEqual({
    reviewRequestId: value.review.id,
    expectedResourceRevision: 2,
  });
});
test("server-derived canPublish hides publication from the approving reviewer", async () => {
  const value = {
    ...summary(),
    review: approvedReview({ canPublish: false }),
  };
  render(app(clientFor(value)));
  await screen.findByText("Approved and usable");
  expect(
    screen.queryByRole("button", { name: "Publish reviewed revision" }),
  ).toBeNull();
});
test("server-derived capabilities expose only role-appropriate review actions", async () => {
  const staleReviewer = {
    ...summary(),
    canRequestReview: false,
    review: approvedReview({
      usability: { usable: false, reason: "stale" },
      canPublish: false,
    }),
  };
  render(app(clientFor(staleReviewer)));
  await screen.findByText("Approved but no longer usable");
  expect(
    screen.getByText(
      "A new review must be requested before this revision can continue.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Request review" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Publish reviewed revision" }),
  ).toBeNull();

  cleanup();
  const pendingPublisher = {
    ...summary(),
    canRequestReview: false,
    review: approvedReview({
      decision: null,
      usability: { usable: false, reason: "pending" },
      canReview: false,
      canPublish: false,
    }),
  };
  render(app(clientFor(pendingPublisher)));
  await screen.findByText("Pending review", { selector: "dd" });
  expect(screen.queryByRole("button", { name: "Request review" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();

  cleanup();
  const eligiblePublisher = {
    ...summary(),
    canRequestReview: false,
    review: approvedReview({ canReview: false, canPublish: true }),
  };
  render(app(clientFor(eligiblePublisher)));
  expect(
    await screen.findByRole("button", { name: "Publish reviewed revision" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Request review" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
});
test("saved draft can request review with server-derived revision context", async () => {
  const value = { ...summary(), review: undefined };
  const client = clientFor(value);
  value.review = undefined;
  client.get.mockImplementation(async (path) => {
    if (path.endsWith("/preview"))
      return {
        revision: value.revision,
        unpublished: true,
        presentation: publishedExperienceFixture(),
      };
    if (path.endsWith("/review-context"))
      return {
        resourceRevision: value.revision,
        draftRevisionId: "22222222-2222-4222-8222-222222222222",
        publishedRevisionId: null,
        latestRequestId: value.review?.id || null,
        canRequestReview: true,
      };
    if (path.includes("/review-requests/")) return value.review;
    return value;
  });
  render(app(client));
  const request = await screen.findByRole("button", { name: "Request review" });
  expect(request).toHaveClass("resident-review-request");
  expect(request.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  fireEvent.click(request);
  await screen.findByText("Pending review");
  expect(client.post).toHaveBeenCalledWith(
    base + "/review-requests",
    {
      targetRevisionId: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 2,
      purpose: "draft",
      supersedesRequestId: null,
    },
    { authenticated: true },
  );
});
test.each(["approved", "pending"])(
  "saving revision 8 refreshes capabilities and supersedes the stale %s revision 6 review",
  async (outcome) => {
    const old = approvedReview({
      resourceRevision: 6,
      canReview: false,
      canPublish: false,
      ...(outcome === "pending" ? { decision: null } : {}),
      usability: { usable: false, reason: "stale" },
    });
    let value = { ...summary(), revision: 7 };
    let context = {
      resourceRevision: 7,
      draftRevisionId: "77777777-7777-4777-8777-777777777777",
      latestRequestId: old.id,
      canRequestReview: true,
    };
    let review = old;
    const client = clientFor(value);
    client.get.mockImplementation(async (path) => {
      if (path.endsWith("/review-context")) return context;
      if (path.includes("/review-requests/")) return review;
      if (path.includes("/revisions/"))
        return { revisionId: old.targetRevisionId };
      return value;
    });
    client.put.mockImplementation(async (_path, command) => {
      value = { ...value, revision: 8, draft: command.snapshot };
      context = {
        ...context,
        resourceRevision: 8,
        draftRevisionId: "88888888-8888-4888-8888-888888888888",
      };
      return { revision: 8, changed: true };
    });
    client.post.mockImplementation(async (_path, body) => {
      review = approvedReview({
        id: "99999999-9999-4999-8999-999999999999",
        resourceRevision: 8,
        targetRevisionId: body.targetRevisionId,
        decision: null,
        canReview: false,
        canPublish: false,
        usability: { usable: false, reason: "pending" },
      });
      context = {
        ...context,
        latestRequestId: review.id,
        canRequestReview: false,
      };
      return review;
    });
    render(app(client));
    fireEvent.change(await screen.findByLabelText("Public application name"), {
      target: { value: "Saved revision eight" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save complete draft" }),
    );
    await screen.findByText("Draft saved. Public content is unchanged.");
    expect(client.post).not.toHaveBeenCalled();
    const request = await screen.findByRole("button", {
      name: "Request review",
    });
    expect(request).toHaveClass("resident-review-request");
    fireEvent.click(request);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Request review" }),
      ).toBeNull(),
    );
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith(
      base + "/review-requests",
      {
        targetRevisionId: context.draftRevisionId,
        expectedRevision: 8,
        purpose: "draft",
        supersedesRequestId: old.id,
      },
      { authenticated: true },
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Publish reviewed revision" }),
    ).toBeNull();
  },
);
test("pending review loads the exact revision and supports confirmed approve/reject decisions", async () => {
  const value = {
    ...summary(),
    review: approvedReview({
      decision: null,
      usability: { usable: false, reason: "pending" },
      changes: {
        changedFields: ["contacts"],
        reasons: ["contact_changed"],
        consequential: true,
      },
    }),
  };
  const client = clientFor(value);
  render(app(client));
  await screen.findByText("Exact immutable revision loaded for review.");
  const approve = screen.getByRole("button", { name: "Approve" });
  const reject = screen.getByRole("button", { name: "Reject" });
  expect(approve).toHaveClass("resident-review-approve");
  expect(reject).toHaveClass("resident-review-reject");
  expect(approve.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(reject.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  fireEvent.click(approve);
  const dialog = screen.getByRole("dialog", { name: "Approve this review?" });
  expect(
    within(dialog).getByText(
      /you’re approving this saved revision for publication review/i,
    ),
  ).toBeVisible();
  expect(
    within(dialog).getByText(
      /ready for a separate publisher to publish later/i,
    ),
  ).toBeVisible();
  expect(
    within(dialog).getByText(/approving does not publish it now/i),
  ).toBeVisible();
  expect(
    within(dialog).getByText(/Revision 2.*High-impact changes/i),
  ).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(client.post).not.toHaveBeenCalled();
  fireEvent.click(approve);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Confirm approval",
    }),
  );
  await screen.findByText(/Approved · Revision/);
  expect(
    screen.queryByRole("button", { name: "Publish reviewed revision" }),
  ).toBeNull();
  expect(client.post).toHaveBeenCalledWith(
    base + "/review-requests/11111111-1111-4111-8111-111111111111/decision",
    { expectedRevision: 2, outcome: "approved" },
    { authenticated: true },
  );
});
test("publication confirmation prevents duplicate submits and handles safe conflicts", async () => {
  const value = { ...summary(), review: approvedReview() };
  const client = clientFor(value);
  let resolve;
  client.post.mockImplementation(() => new Promise((done) => (resolve = done)));
  render(app(client));
  fireEvent.click(
    await screen.findByRole("button", { name: "Publish reviewed revision" }),
  );
  const confirm = screen.getByRole("button", { name: "Confirm publication" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Publishing…" })).toBeDisabled();
  await act(async () => resolve({}));
  await screen.findByText(/published successfully/);

  const conflictValue = { ...summary(), review: approvedReview() };
  const conflictClient = clientFor(conflictValue);
  conflictClient.post.mockRejectedValue({ status: 409, message: "private" });
  cleanup();
  render(app(conflictClient));
  fireEvent.click(
    await screen.findByRole("button", { name: "Publish reviewed revision" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
  expect(
    await screen.findByText(/no longer current.*fresh review/i),
  ).toBeVisible();
  expect(screen.queryByText("private")).toBeNull();
});
test.each([
  [401, /staff session is no longer available/i],
  [403, /not currently authorized to publish/i],
  [404, /no longer available/i],
])("publication status %i uses safe feedback", async (status, message) => {
  const value = { ...summary(), review: approvedReview() };
  const client = clientFor(value);
  client.post.mockRejectedValue({ status, message: "private details" });
  render(app(client));
  fireEvent.click(
    await screen.findByRole("button", { name: "Publish reviewed revision" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.queryByText("private details")).toBeNull();
});
test("409 retains edits for review, prevents retry, and explicit reload discards them", async () => {
  const client = clientFor();
  client.put.mockRejectedValue({ status: 409, message: "private error" });
  render(app(client));
  fireEvent.change(await screen.findByLabelText("Public application name"), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  await screen.findByText(/draft changed elsewhere/);
  expect(screen.getByLabelText("Public application name")).toHaveValue(
    "Unsaved",
  );
  expect(
    screen.getByRole("button", { name: "Save complete draft" }),
  ).toBeDisabled();
  expect(client.put).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /Reload saved draft/ }));
  await waitFor(() =>
    expect(screen.getByLabelText("Public application name")).toHaveValue(
      "Reqro",
    ),
  );
  expect(screen.queryByText("private error")).toBeNull();
});
test.each([401, 403])(
  "authority loss %i clears draft and preview state",
  async (status) => {
    const client = clientFor();
    client.put.mockRejectedValue({ status });
    render(app(client));
    await screen.findByLabelText("Public application name");
    fireEvent.click(
      screen.getByRole("button", { name: "Save complete draft" }),
    );
    await screen.findByText(/access is not authorized/);
    expect(screen.queryByLabelText("Public application name")).toBeNull();
  },
);
test("failed reauthorization after save clears protected content", async () => {
  const client = clientFor();
  client.get
    .mockResolvedValueOnce(summary())
    .mockRejectedValue(new Error("private"));
  render(app(client));
  await screen.findByLabelText("Public application name");
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  await screen.findByText(/access is not authorized/);
  expect(screen.queryByLabelText("Public application name")).toBeNull();
});
test("identity transition and logout discard drafts and ignore stale completions", async () => {
  const client = clientFor();
  let resolve;
  client.get.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(app(client));
  const oldSignal = client.get.mock.calls[0][1].signal;
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    account: { homeAccountId: "other", tenantId: "other" },
  });
  view.rerender(app(client));
  await screen.findByLabelText("Public application name");
  const old = summary();
  old.draft.presentation.branding.applicationName = "Previous tenant";
  await act(async () => resolve(old));
  expect(oldSignal.aborted).toBe(true);
  expect(screen.getByLabelText("Public application name")).toHaveValue("Reqro");
  useAuth.mockReturnValue({ enabled: true, isAuthenticated: false });
  view.rerender(app(client));
  expect(screen.queryByLabelText("Public application name")).toBeNull();
});
test("protected saved preview reuses frozen content and intercepts links, calls, external actions and auth buttons", async () => {
  const client = clientFor();
  const dto = publishedExperienceFixture();
  dto.configuration.actions[0].actionType = "external";
  dto.configuration.actions[0].target = "https://example.org";
  client.get.mockImplementation(async (path) =>
    path.endsWith("/preview")
      ? { revision: 2, unpublished: true, presentation: dto }
      : summary(),
  );
  render(app(client));
  await screen.findByLabelText("Public application name");
  fireEvent.click(screen.getByRole("button", { name: "Preview saved draft" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Unpublished Preview",
  });
  expect(dialog.querySelectorAll(".reqro-action-card")).toHaveLength(3);
  expect(document.title).toBe("Unpublished preview | Reqro Administration");
  expect(screen.getByRole("link", { name: "240-314-8567" })).toHaveAttribute(
    "href",
    "tel:2403148567",
  );
  for (const link of dialog.querySelectorAll("a")) {
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.contextMenu(link)).toBe(false);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
  }
  expect(
    client.get.mock.calls.find(([path]) => path.endsWith("/preview"))[1]
      .authenticated,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Public application name")).toHaveValue("Reqro");
  expect(client.put).not.toHaveBeenCalled();
});
test("preview close is keyboard actionable and uses the full resident shell", async () => {
  const user = userEvent.setup();
  const client = clientFor();
  render(app(client));
  await screen.findByLabelText("Public application name");
  await user.click(screen.getByRole("button", { name: "Preview saved draft" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Unpublished Preview",
  });
  expect(screen.getByText(/Resident actions are disabled\./)).toBeVisible();
  expect(dialog.querySelector(".resident-preview-home")).toHaveClass(
    "resident-preview-home",
  );
  expect(dialog.querySelector(".resident-preview-main")).toHaveClass(
    "resident-preview-main",
  );
  const close = screen.getByRole("button", { name: "Close preview" });
  close.focus();
  expect(close).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Preview saved draft" }),
  ).toHaveFocus();
  expect(client.put).not.toHaveBeenCalled();
});
test("Admin navigation requires successful protected configuration admission", async () => {
  const client = clientFor();
  const route = (
    <MemoryRouter initialEntries={["/admin/resident-experience"]}>
      <ThemeProvider>
        <Routes>
          <Route
            path="/admin/:section"
            element={<AdminConfiguration client={client} />}
          />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  );
  const view = render(route);
  expect(
    screen.queryByRole("link", { name: "Resident Experience" }),
  ).toBeNull();
  await screen.findByRole("link", { name: "Resident Experience" });
  view.unmount();
  client.get.mockRejectedValue({ status: 403 });
  render(route);
  await screen.findByText("Administration access is not authorized.");
  expect(
    screen.queryByRole("link", { name: "Resident Experience" }),
  ).toBeNull();
});
test("draft save never changes the frontend public endpoint or its published projection", async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => publishedExperienceFixture(),
  }));
  vi.stubGlobal("fetch", fetch);
  const config = {
    dataSource: "api",
    apiBaseUrl: "https://example.org/api/v1",
  };
  const before = await loadResidentExperience({ config });
  const client = clientFor();
  render(app(client));
  fireEvent.change(await screen.findByLabelText("Public application name"), {
    target: { value: "Unpublished name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save complete draft" }));
  await screen.findByText("Draft saved. Public content is unchanged.");
  expect(await loadResidentExperience({ config })).toEqual(before);
  expect(
    fetch.mock.calls.every(
      ([url]) => url === config.apiBaseUrl + "/resident-experience",
    ),
  ).toBe(true);
});
