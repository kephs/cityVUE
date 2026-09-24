import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import ParticipationAreaEditor from "../src/admin/ParticipationAreaEditor.jsx";

const north = {
  id: "north",
  name: "North District",
  active: true,
  displayOrder: 0,
  revision: 4,
};
const south = {
  id: "south",
  name: "South District",
  active: false,
  displayOrder: 1,
  revision: 2,
};
function setup(overrides = {}) {
  const client = {
    post: vi.fn().mockResolvedValue({ area: north, changed: true }),
    patch: vi
      .fn()
      .mockResolvedValue({ area: { ...north, revision: 5 }, changed: true }),
  };
  const props = {
    client,
    areas: { items: [north, south], active: 1, total: 2 },
    collection: { enabled: false, revision: 3 },
    canWrite: true,
    onSaved: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  const view = render(<ParticipationAreaEditor {...props} />);
  return { ...props, ...view, user: userEvent.setup() };
}
test("F055 reader sees names/state/order and no management controls", () => {
  setup({ canWrite: false });
  expect(screen.getByRole("heading", { name: north.name })).toBeInTheDocument();
  expect(screen.getByText("Inactive")).toBeInTheDocument();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
test("F055 Add validates trims and submits once; authoritative result is passed to parent", async () => {
  const { user, client, onSaved } = setup();
  await user.click(screen.getByRole("button", { name: "Add area" }));
  const field = screen.getByRole("textbox");
  expect(field).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save area" })).toBeDisabled();
  await user.type(field, "  West District  ");
  await user.click(screen.getByRole("button", { name: "Save area" }));
  expect(client.post).toHaveBeenCalledWith(
    "/admin/participation-areas",
    { displayName: "West District" },
    expect.objectContaining({
      authenticated: true,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(onSaved).toHaveBeenCalledWith(
    { area: north, changed: true },
    "Participation Area added.",
  );
});
test("F055 rename Cancel restores trigger focus without writing; save includes expected revision", async () => {
  const { user, client } = setup();
  const trigger = screen.getByRole("button", { name: "Rename North District" });
  await user.click(trigger);
  expect(screen.getByRole("button", { name: "Save area" })).toBeDisabled();
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "Northern District");
  await user.click(screen.getByRole("button", { name: "Cancel edit" }));
  expect(trigger).toHaveFocus();
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(trigger);
  await user.type(screen.getByRole("textbox"), " New");
  await user.click(screen.getByRole("button", { name: "Save area" }));
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/participation-areas/north",
    { displayName: "North District New", expectedRevision: 4 },
    expect.anything(),
  );
});
test("F055 duplicate preserves entered name and offers reactivation guidance", async () => {
  const { user, client } = setup();
  client.post.mockRejectedValue({
    status: 400,
    code: "PARTICIPATION_AREA_DUPLICATE",
  });
  await user.click(screen.getByRole("button", { name: "Add area" }));
  await user.type(screen.getByRole("textbox"), "North District");
  await user.click(screen.getByRole("button", { name: "Save area" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A Participation Area with this name already exists",
  );
  expect(screen.getByRole("textbox")).toHaveValue("North District");
});
test("F055 deactivate confirmation starts on Cancel, Escape/cancel preserves data, confirm submits", async () => {
  const { user, client } = setup();
  const button = screen.getByRole("button", {
    name: "Deactivate North District",
  });
  await user.click(button);
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
    /historical analytics will be kept/,
  );
  expect(
    screen.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(button).toHaveFocus();
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(button);
  await user.click(
    screen.getByRole("button", { name: "Deactivate area", exact: true }),
  );
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/participation-areas/north",
    { active: false, expectedRevision: 4 },
    expect.anything(),
  );
});
test("F055 final-active UI blocks deactivation and backend validation does not falsely succeed", async () => {
  const { user, client, onSaved, rerender } = setup({
    collection: { enabled: true, revision: 3 },
  });
  expect(
    screen.getByRole("button", { name: "Deactivate North District" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Turn off Service Participation first/),
  ).toBeInTheDocument();
  rerender(
    <ParticipationAreaEditor
      client={client}
      areas={{ items: [north, south], active: 2, total: 2 }}
      collection={{ enabled: true }}
      canWrite
      onSaved={onSaved}
      onRefresh={vi.fn()}
    />,
  );
  client.patch.mockRejectedValue({
    status: 400,
    code: "PARTICIPATION_AREA_LAST_ACTIVE",
  });
  await user.click(
    screen.getByRole("button", { name: "Deactivate North District" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Deactivate area", exact: true }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Turn off Service Participation first",
  );
  expect(onSaved).not.toHaveBeenCalled();
});
test("F055 activate does not submit collection; numeric order is keyboard editable and revision protected", async () => {
  const { user, client } = setup();
  await user.click(
    screen.getByRole("button", { name: "Activate South District" }),
  );
  expect(client.patch).toHaveBeenLastCalledWith(
    "/admin/participation-areas/south",
    { active: true, expectedRevision: 2 },
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", {
      name: "Change order for North District",
    }),
  );
  const field = screen.getByRole("spinbutton");
  expect(field).toHaveFocus();
  await user.clear(field);
  await user.type(field, "-2");
  await user.keyboard("{Enter}");
  expect(client.patch).toHaveBeenLastCalledWith(
    "/admin/participation-areas/north",
    { displayOrder: -2, expectedRevision: 4 },
    expect.anything(),
  );
});
for (const type of ["Rename", "Change order for"])
  test(`F055 ${type} conflict requires Refresh without retry or false success`, async () => {
    const { user, client, onSaved, onRefresh } = setup();
    client.patch.mockRejectedValue({ status: 409 });
    await user.click(
      screen.getByRole("button", { name: `${type} North District` }),
    );
    const input = screen.getByRole(
      type === "Rename" ? "textbox" : "spinbutton",
    );
    await user.clear(input);
    await user.type(input, type === "Rename" ? "Changed" : "9");
    await user.click(screen.getByRole("button", { name: "Save area" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed since you opened/,
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save area" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Refresh latest areas" }),
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(client.patch).toHaveBeenCalledTimes(1);
  });
for (const status of [401, 403])
  test(`F055 ${status} removes mutation controls and retains safe read-only list`, async () => {
    const { user, client, onSaved } = setup();
    client.patch.mockRejectedValue({ status });
    await user.click(
      screen.getByRole("button", { name: "Activate South District" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      status === 403 ? "not authorized" : "session has expired",
    );
    expect(
      screen.queryByRole("button", { name: "Add area" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: north.name }),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
test("F055 empty disabled is valid; enabled empty warns; HTML-like names render as text", () => {
  const { rerender, client } = setup({
    areas: { items: [], active: 0, total: 0 },
  });
  expect(
    screen.getByText("No Participation Areas are configured."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  rerender(
    <ParticipationAreaEditor
      client={client}
      areas={{
        items: [{ ...north, name: '<img src=x onerror="attack()">' }],
        active: 0,
        total: 1,
      }}
      collection={{ enabled: true }}
      canWrite
      onSaved={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("no active areas");
  expect(
    screen.getByRole("heading", { name: '<img src=x onerror="attack()">' }),
  ).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull();
});
test("F055 double submit is blocked and unmount aborts/ignores pending response", async () => {
  let resolve;
  const { user, client, onSaved, unmount } = setup();
  client.post.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await user.click(screen.getByRole("button", { name: "Add area" }));
  await user.type(screen.getByRole("textbox"), "West");
  await user.dblClick(screen.getByRole("button", { name: "Save area" }));
  expect(client.post).toHaveBeenCalledTimes(1);
  const signal = client.post.mock.calls[0][2].signal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ area: north, changed: true }));
  expect(onSaved).not.toHaveBeenCalled();
});
