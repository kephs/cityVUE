import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import { AdminConfiguration } from "../src/admin/AdminConfigurationPage.jsx";

const snapshot = {
  collection: { enabled: true, revision: 3 },
  issues: {
    page: 1,
    pageSize: 25,
    total: 1,
    items: [
      {
        key: "fictional-sign",
        name: "Fictional Sign Issue",
        category: "Fictional Roads",
        available: true,
        publishedVersion: 2,
        action: { revision: 1 },
        identityPolicy: { value: "ANONYMOUS_ALLOWED", revision: 4 },
        defaultAssignment: {
          revision: 5,
          state: "unavailable",
          label: "Configured target unavailable",
        },
      },
    ],
  },
  participationAreas: {
    page: 1,
    pageSize: 25,
    total: 1,
    active: 1,
    items: [
      {
        id: "fictional-area",
        name: "Fictional North",
        active: true,
        displayOrder: 0,
        revision: 4,
      },
    ],
  },
  privacy: { source: "deployment_policy", suppressionThreshold: 5 },
  health: [
    {
      resource: "Service Participation",
      severity: "OK",
      message: "Collection is enabled with 1 active Participation Areas.",
    },
    {
      resource: "Issue default assignment",
      severity: "WARNING",
      message: "Configured target unavailable.",
    },
  ],
};
function view(client, path = "/admin") {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/:section?"
            element={<AdminConfiguration client={client} />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test.each([true, false])(
  "F055 denied write rechecks read authority; retained read=%s",
  async (retainRead) => {
    const writer = {
      ...snapshot,
      capabilities: { canWriteParticipationAreas: true },
    };
    const client = {
      get: vi.fn().mockResolvedValue(writer),
      patch: vi.fn().mockRejectedValue({ status: 403 }),
    };
    view(client, "/admin/participation");
    await screen.findByText("Fictional North");
    if (retainRead)
      client.get.mockResolvedValue({
        ...snapshot,
        capabilities: { canWriteParticipationAreas: false },
      });
    else client.get.mockRejectedValue({ status: 403 });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Rename Fictional North" }),
    );
    await user.type(screen.getByRole("textbox"), " New");
    await user.click(screen.getByRole("button", { name: "Save area" }));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
    if (retainRead) await screen.findByText("Fictional North");
    else {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Administration access is not authorized",
      );
      expect(screen.queryByText("Fictional North")).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "Rename Fictional North" }),
    ).not.toBeInTheDocument();
    expect(client.patch).toHaveBeenCalledTimes(1);
  },
);

test.each([401, 403, 500])(
  "F052 %s state hides configuration and provides safe retry",
  async (status) => {
    const client = {
      get: vi
        .fn()
        .mockRejectedValue({ status, message: "private SQL diagnostic" }),
    };
    view(client);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading authorized configuration",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      status === 500
        ? "Configuration could not be loaded"
        : "Administration access is not authorized",
    );
    expect(screen.queryByText("Fictional Sign Issue")).not.toBeInTheDocument();
    expect(
      screen.queryByText("private SQL diagnostic"),
    ).not.toBeInTheDocument();
    client.get.mockResolvedValue(snapshot);
    await userEvent.click(
      screen.getByRole("button", { name: "Retry configuration" }),
    );
    expect(await screen.findByText("Issues configured")).toBeInTheDocument();
  },
);
test.each([
  ["issues", "Fictional Sign Issue"],
  ["intake", "Service Participation"],
  ["participation", "Fictional North"],
  ["privacy", "Deployment policy"],
  ["status", "Configuration Status"],
])(
  "F052 %s renders authoritative read-only values and meaningful navigation",
  async (section, text) => {
    const client = { get: vi.fn().mockResolvedValue(snapshot) };
    view(client, `/admin/${section}`);
    await screen.findByRole("button", { name: "Refresh configuration" });
    expect(
      screen.getByText(text, {
        selector: section === "status" ? "h1" : undefined,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Administration sections" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save|delete|edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "← Staff workspace" }),
    ).toHaveAttribute("href", "/staff/requests");
    expect(client.get).toHaveBeenCalledWith(
      "/admin/configuration?issuePage=1&areaPage=1",
      expect.objectContaining({
        authenticated: true,
        signal: expect.any(AbortSignal),
      }),
    );
  },
);
test("F052 refresh clears denied data, resource revisions stay stable on reads and navigation carries aria-current", async () => {
  const client = { get: vi.fn().mockResolvedValue(snapshot) };
  view(client, "/admin/participation");
  await screen.findByText("Fictional North");
  expect(screen.getByText("Area revision").nextSibling).toHaveTextContent("4");
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh configuration" }),
  );
  await screen.findByText("Fictional North");
  expect(screen.getByText("Area revision").nextSibling).toHaveTextContent("4");
  await userEvent.click(screen.getByRole("link", { name: "Intake Settings" }));
  expect(screen.getByRole("link", { name: "Intake Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  client.get.mockRejectedValue({ status: 403 });
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh configuration" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Collection revision")).not.toBeInTheDocument();
});
test("F052 an old authenticated client cannot repopulate configuration after access denial", async () => {
  let resolve;
  const client = {
    get: vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  };
  const tree = (c) => (
    <ThemeProvider>
      <MemoryRouter initialEntries={["/admin/participation"]}>
        <Routes>
          <Route
            path="/admin/:section?"
            element={<AdminConfiguration client={c} />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
  const result = render(tree(client));
  await waitFor(() => expect(client.get).toHaveBeenCalledOnce());
  const replacement = { get: vi.fn().mockRejectedValue({ status: 403 }) };
  result.rerender(tree(replacement));
  await screen.findByRole("alert");
  await act(async () => resolve(snapshot));
  expect(screen.queryByText("Fictional North")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Administration access is not authorized",
  );
});
test("F052 empty states are truthful and configuration pagination is bounded", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      ...snapshot,
      issues: { ...snapshot.issues, total: 0, items: [] },
    }),
  };
  view(client, "/admin/issues");
  await screen.findByText("No Issues are configured.");
  expect(screen.getByRole("button", { name: "Next issues" })).toBeDisabled();
});

test("F054 authorized branding clears on denied refresh; preview content stays excluded", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      ...snapshot,
      branding: {
        mode: "ORGANIZATION",
        displayName: "Example Organization",
        tagline: "Community Services",
        logoKey: "example-organization",
        revision: 2,
      },
    }),
  };
  view(client);
  expect(await screen.findByText("Example Organization")).toBeInTheDocument();
  expect(screen.queryByText("Administrator (Demo)")).not.toBeInTheDocument();
  expect(screen.queryByText("Total Issues")).not.toBeInTheDocument();
  client.get.mockRejectedValue({ status: 403 });
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh configuration" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Example Organization")).not.toBeInTheDocument();
  expect(screen.getByText("People • Requests • Progress")).toBeInTheDocument();
});
test("F054 navigation opens, Escape closes and restores focus without changing configuration", async () => {
  const client = { get: vi.fn().mockResolvedValue(snapshot) };
  view(client);
  await screen.findByRole("button", { name: "Refresh configuration" });
  const toggle = screen.getByRole("button", {
    name: "Administration sections",
  });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await userEvent.keyboard("{Escape}");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveFocus();
  expect(client.get).toHaveBeenCalledTimes(1);
});
