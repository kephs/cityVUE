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
function clientFor(value = summary()) {
  return {
    get: vi.fn(async (path) =>
      path.endsWith("/preview")
        ? {
            revision: value.revision,
            unpublished: true,
            presentation: publishedExperienceFixture(),
          }
        : value,
    ),
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
  expect(client.get).toHaveBeenCalledTimes(1);
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
  expect(client.get).toHaveBeenCalledTimes(1);
  expect(client.put).not.toHaveBeenCalled();
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
