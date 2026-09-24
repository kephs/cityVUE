import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import IntakeCollectionEditor from "../src/admin/IntakeCollectionEditor.jsx";

function setup(options = {}) {
  const client = {
    patch: vi
      .fn()
      .mockResolvedValue({ enabled: false, revision: 8, changed: true }),
  };
  const props = {
    client,
    collection: { enabled: true, revision: 7 },
    activeAreas: 3,
    canWrite: true,
    onSaved: vi.fn(),
    onRefresh: vi.fn(),
    ...options,
  };
  const view = render(<IntakeCollectionEditor {...props} />);
  return { ...props, ...view, user: userEvent.setup() };
}
test("F053 reader sees current setting without edit control or Save", () => {
  setup({ canWrite: false });
  expect(screen.getByText("On")).toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save changes" }),
  ).not.toBeInTheDocument();
});
test("F053 dirty choice is separate from current; Cancel never writes", async () => {
  const { user, client } = setup();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(screen.getByRole("switch"));
  expect(screen.getByText(/Unsaved change/)).toBeInTheDocument();
  expect(screen.getByText(/Currently On/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel change" }));
  expect(screen.getByRole("switch")).toBeChecked();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F053 disable confirms, Cancel restores focus, success submits exact revision and uses authoritative response", async () => {
  const { user, client, onSaved } = setup();
  await user.click(screen.getByRole("switch"));
  const save = screen.getByRole("button", { name: "Save changes" });
  await user.click(save);
  expect(screen.getByRole("dialog")).toHaveAccessibleName(
    "Turn off Service Participation?",
  );
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
    /historical analytics will be kept/,
  );
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(save).toHaveFocus();
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(save);
  await user.click(screen.getByRole("button", { name: "Turn off" }));
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/intake-settings/service-participation",
    { enabled: false, expectedRevision: 7 },
    expect.objectContaining({
      authenticated: true,
      signal: expect.any(AbortSignal),
    }),
  );
  expect(onSaved).toHaveBeenCalledWith({
    enabled: false,
    revision: 8,
    changed: true,
  });
});
test.each([403, 401, 409, 400, 500])(
  "F053 %s failure has safe feedback and no false success",
  async (status) => {
    const { user, onSaved, onRefresh } = setup({
      collection: { enabled: false, revision: 5 },
      client: {
        patch: vi.fn().mockRejectedValue({ status, message: "private SQL" }),
      },
    });
    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(
      "private SQL",
    );
    expect(onSaved).not.toHaveBeenCalled();
    if (status === 403 || status === 401)
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    if (status === 409) {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Configuration changed",
      );
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled();
    }
    await user.click(
      screen.getByRole("button", { name: "Refresh latest setting" }),
    );
    expect(onRefresh).toHaveBeenCalledOnce();
  },
);
test("F053 no active areas prevents enabling but never prevents disabling", async () => {
  const { user, client } = setup({
    collection: { enabled: false, revision: 1 },
    activeAreas: 0,
  });
  await user.click(screen.getByRole("switch"));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(
    screen.getByText(/Add or reactivate at least one/),
  ).toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F053 in-flight save prevents duplicate calls and ignores completion after unmount", async () => {
  let finish;
  const client = {
    patch: vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    ),
  };
  const { user, onSaved, unmount } = setup({
    client,
    collection: { enabled: false, revision: 1 },
  });
  await user.click(screen.getByRole("switch"));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(client.patch).toHaveBeenCalledOnce();
  unmount();
  await act(async () => finish({ enabled: true, revision: 2 }));
  expect(onSaved).not.toHaveBeenCalled();
});
