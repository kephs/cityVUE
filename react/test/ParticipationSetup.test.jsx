import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import ParticipationSetup from "../src/admin/ParticipationSetup.jsx";
import { AdminConfiguration } from "../src/admin/AdminConfigurationPage.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";

const north = {
  id: "north",
  name: "North District",
  active: true,
  displayOrder: 0,
  revision: 4,
};
const initial = {
  collection: { enabled: true, revision: 3 },
  participationAreas: {
    items: [north],
    active: 1,
    total: 1,
    page: 1,
    pageSize: 25,
  },
  capabilities: {
    canWriteIntakeSettings: true,
    canWriteParticipationAreas: true,
  },
  issues: { items: [], total: 0, page: 1, pageSize: 25 },
  health: [
    { resource: "Service Participation", severity: "OK", message: "Ready" },
  ],
};
function setup(data = initial) {
  const client = {
    get: vi.fn().mockResolvedValue(data),
    patch: vi.fn(),
    post: vi.fn(),
  };
  const onRefresh = vi.fn(),
    onDenied = vi.fn();
  render(
    <ParticipationSetup
      client={client}
      initial={data}
      onRefresh={onRefresh}
      onDenied={onDenied}
    />,
  );
  return { client, onRefresh, onDenied, user: userEvent.setup() };
}
test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])("separate collection=%s and area=%s capabilities", (intake, area) => {
  setup({
    ...initial,
    capabilities: {
      canWriteIntakeSettings: intake,
      canWriteParticipationAreas: area,
    },
  });
  expect(
    screen.queryByRole("switch", {
      name: "Service Participation collection",
    }) !== null,
  ).toBe(intake);
  expect(screen.queryByRole("button", { name: "Add area" }) !== null).toBe(
    area,
  );
  expect(
    screen.queryByRole("button", {
      name: "Change order for North District",
    }) !== null,
  ).toBe(area);
  expect(screen.getByText("1 active")).toBeInTheDocument();
  expect(screen.queryByText(/write permission/)).not.toBeInTheDocument();
  expect(screen.queryByText("Configuration details")).not.toBeInTheDocument();
});
test("Space toggles only a draft; Refresh confirms discard and Cancel restores switch focus", async () => {
  const { user, client, onRefresh } = setup();
  const control = screen.getByRole("switch");
  control.focus();
  await user.keyboard(" ");
  expect(control).not.toBeChecked();
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Refresh Participation Setup" }),
  );
  expect(screen.getByRole("dialog")).toHaveAccessibleName(
    "Discard unsaved changes?",
  );
  expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(onRefresh).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel change" }));
  expect(control).toBeChecked();
  expect(control).toHaveFocus();
  await user.click(control);
  await user.click(
    screen.getByRole("button", { name: "Refresh Participation Setup" }),
  );
  await user.click(screen.getByRole("button", { name: "Discard and refresh" }));
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(client.patch).not.toHaveBeenCalled();
});
test("area save keeps collection draft and focuses the authoritative renamed area", async () => {
  const { user, client } = setup();
  await user.click(screen.getByRole("switch"));
  const area = { ...north, name: "Northern District", revision: 5 };
  client.patch.mockResolvedValue({ area, changed: true });
  client.get.mockResolvedValue({
    ...initial,
    participationAreas: { ...initial.participationAreas, items: [area] },
  });
  await user.click(
    screen.getByRole("button", { name: "Rename North District" }),
  );
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), area.name);
  await user.click(screen.getByRole("button", { name: "Save area" }));
  await waitFor(() =>
    expect(screen.getByRole("listitem", { name: area.name })).toHaveFocus(),
  );
  expect(screen.getByRole("switch")).not.toBeChecked();
  expect(screen.getByText(/Unsaved change. Currently On/)).toBeInTheDocument();
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/participation-areas/north",
    { displayName: area.name, expectedRevision: 4 },
    expect.anything(),
  );
  expect(
    within(
      screen.getByRole("region", { name: "Participation Areas" }),
    ).getByRole("status"),
  ).toHaveTextContent("Participation Area renamed.");
});
test("collection save keeps area edit and uses only F053 revision/API", async () => {
  const { user, client } = setup();
  client.patch.mockResolvedValue({
    enabled: false,
    revision: 4,
    changed: true,
  });
  await user.click(
    screen.getByRole("button", { name: "Rename North District" }),
  );
  await user.type(screen.getByRole("textbox"), " pending");
  await user.click(screen.getByRole("switch"));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await user.click(
    screen.getByRole("button", { name: "Turn off", exact: true }),
  );
  expect(screen.getByRole("textbox")).toHaveValue("North District pending");
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/intake-settings/service-participation",
    { enabled: false, expectedRevision: 3 },
    expect.anything(),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("switch")).toHaveFocus();
  expect(
    within(
      screen.getByRole("region", { name: "Service Participation" }),
    ).getByRole("status"),
  ).toHaveTextContent("Service Participation turned off.");
  expect(
    screen.getByText("Areas are kept for future use and historical records."),
  ).toBeInTheDocument();
});
test("Change order keeps raw integer semantics and focuses the same area after authoritative refresh", async () => {
  const { user, client } = setup();
  const area = { ...north, displayOrder: -2, revision: 5 };
  client.patch.mockResolvedValue({ area, changed: true });
  client.get.mockResolvedValue({
    ...initial,
    participationAreas: { ...initial.participationAreas, items: [area] },
  });
  await user.click(
    screen.getByRole("button", { name: "Change order for North District" }),
  );
  const input = screen.getByRole("spinbutton", { name: "Display order" });
  expect(input).toHaveValue(0);
  await user.clear(input);
  await user.type(input, "-2");
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Order -2")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("listitem", { name: north.name })).toHaveFocus(),
  );
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/participation-areas/north",
    { displayOrder: -2, expectedRevision: 4 },
    expect.anything(),
  );
  expect(
    screen.queryByRole("button", { name: /Move.*up/ }),
  ).not.toBeInTheDocument();
});
test("area conflict refresh keeps collection draft and explicitly discards stale area edit", async () => {
  const { user, client } = setup();
  client.patch.mockRejectedValue({ status: 409 });
  await user.click(screen.getByRole("switch"));
  await user.click(
    screen.getByRole("button", { name: "Change order for North District" }),
  );
  await user.type(screen.getByRole("spinbutton"), "2");
  await user.click(screen.getByRole("button", { name: "Save area" }));
  await screen.findByRole("alert");
  await user.click(
    screen.getByRole("button", { name: "Refresh latest areas" }),
  );
  await user.click(screen.getByRole("button", { name: "Discard and refresh" }));
  await waitFor(() =>
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("switch")).not.toBeChecked();
  expect(client.patch).toHaveBeenCalledOnce();
});
test("legacy route replaces history, canonical navigation is unique and Back/Forward recover it", async () => {
  const client = { get: vi.fn().mockResolvedValue(initial) };
  const router = createMemoryRouter(
    [
      {
        path: "/admin/:section?",
        element: (
          <ThemeProvider>
            <AdminConfiguration client={client} />
          </ThemeProvider>
        ),
      },
    ],
    { initialEntries: ["/admin", "/admin/intake"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("switch");
  expect(router.state.location.pathname).toBe("/admin/participation");
  expect(
    screen.getAllByRole("link", { name: "Participation Setup" }),
  ).toHaveLength(1);
  expect(
    screen.getByRole("link", { name: "Participation Setup" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.queryByRole("link", { name: "Intake Settings" }),
  ).not.toBeInTheDocument();
  await router.navigate(-1);
  await screen.findByText("Configuration at a glance");
  await router.navigate(1);
  await screen.findByRole("switch");
  expect(router.state.location.pathname).toBe("/admin/participation");
});
