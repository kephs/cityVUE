import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import RequestManagement from "../src/staff/requests/RequestManagement.jsx";

function setup({
  count = 0,
  status = "not_issued",
  allowed = true,
  watchers,
} = {}) {
  const repository = {
    watchers:
      watchers ||
      vi.fn().mockResolvedValue({
        items: Array.from({ length: count }, () => ({
          displayName: "Hidden watcher identity",
        })),
      }),
    trackingState: vi.fn().mockResolvedValue({
      status,
      version: "synthetic-version",
      credential: "FORBIDDEN_CREDENTIAL",
      digest: "FORBIDDEN_DIGEST",
      history: ["FORBIDDEN_HISTORY"],
    }),
    changeTracking: vi.fn(),
  };
  const props = {
    repository,
    id: "fictional-request",
    row: {
      audience: "public",
      revision: 1,
      capabilities: { canManageRequesterTracking: allowed },
    },
    onAccessFailure: vi.fn(),
    onMutate: vi.fn(),
    loadContact: vi.fn(),
    clearContact: vi.fn(),
  };
  return { ...render(<RequestManagement {...props} />), props, repository };
}

test.each([
  [0, "No watchers are following this request"],
  [1, "1 watcher following this request"],
  [12, "12 watchers following this request"],
])(
  "authorized watcher count %s has meaningful grammar without identities",
  async (count, copy) => {
    const { container, repository } = setup({ count });
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(repository.watchers).toHaveBeenCalledWith(
      "fictional-request",
      expect.any(AbortSignal),
    );
    expect(container.textContent).not.toContain("Hidden watcher identity");
    expect(repository.changeTracking).not.toHaveBeenCalled();
  },
);

test.each([
  ["not_issued", "Not issued"],
  ["active", "Active"],
  ["revoked", "Revoked"],
])(
  "tracking %s uses only safe state in the ordered compact summary",
  async (status, label) => {
    const { container } = setup({ status });
    expect(
      await screen.findByText(`${label} · Secure requester access`),
    ).toBeInTheDocument();
    expect(
      [...container.querySelectorAll(".request-management-row h4")].map(
        (el) => el.textContent,
      ),
    ).toEqual([
      "Assignment",
      "Watchers",
      "Requester Tracking",
      "Requester Contact",
    ]);
    expect(container.textContent).not.toMatch(/FORBIDDEN|synthetic-version/);
  },
);

test("tracking help opens from keyboard and pointer, dismisses with Escape and restores focus", async () => {
  setup();
  await screen.findByText("Not issued · Secure requester access");
  const user = userEvent.setup();
  const help = screen.getByRole("button", { name: "About Requester Tracking" });
  help.focus();
  await user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog", {
    name: "About Requester Tracking",
  });
  expect(
    within(dialog).getByText(
      "Requester Tracking lets you create, rotate, or revoke the secure link a requester can use to track this Service Request.",
    ),
  ).toBeInTheDocument();
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(help).toHaveFocus();
  await user.click(help);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(help).toHaveFocus();
});

test.each([401, 403, 404])(
  "watcher denial %s exposes no count and uses the existing access-failure path",
  async (status) => {
    const { props } = setup({
      watchers: vi.fn().mockRejectedValue({ status }),
    });
    expect(
      await screen.findByText("Watcher count unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No watchers are following this request"),
    ).toBeNull();
    expect(props.onAccessFailure).toHaveBeenCalledWith({ status });
  },
);

test("tracking permission is required for status, help and management, and loss clears them", async () => {
  const { repository, props, rerender } = setup({ allowed: false });
  await screen.findByText("No watchers are following this request");
  expect(repository.trackingState).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /requester tracking/i }),
  ).toBeNull();
  rerender(
    <RequestManagement
      {...props}
      row={{ ...props.row, capabilities: { canManageRequesterTracking: true } }}
    />,
  );
  await screen.findByText("Not issued · Secure requester access");
  await userEvent.click(
    screen.getByRole("button", { name: "About Requester Tracking" }),
  );
  rerender(<RequestManagement {...props} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(/Secure requester access/)).toBeNull();
});

test("watcher revision refresh discards stale results and never presents loading as zero", async () => {
  let resolveOld;
  const watchers = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue({ items: [{}, {}] });
  const { props, rerender } = setup({ watchers });
  expect(screen.getByText("Loading watcher count…")).toBeInTheDocument();
  rerender(
    <RequestManagement {...props} row={{ ...props.row, revision: 2 }} />,
  );
  await screen.findByText("2 watchers following this request");
  await act(async () => resolveOld({ items: [] }));
  expect(
    screen.getByText("2 watchers following this request"),
  ).toBeInTheDocument();
});

test("tracking denial clears the safe summary through the existing failure path", async () => {
  const { repository, props, rerender } = setup();
  await screen.findByText("Not issued · Secure requester access");
  repository.trackingState.mockRejectedValue({ status: 403 });
  rerender(<RequestManagement {...props} id="other-fictional-request" />);
  await screen.findByText("Status unavailable · Secure requester access");
  expect(props.onAccessFailure).toHaveBeenCalledWith({ status: 403 });
  expect(screen.queryByText("Not issued · Secure requester access")).toBeNull();
});

test("opening tracking management ignores a stale initial summary response", async () => {
  const { repository, props, rerender } = setup({ allowed: false });
  let resolveOld;
  repository.trackingState
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue({ status: "revoked", version: "fictional-version" });
  rerender(
    <RequestManagement
      {...props}
      row={{ ...props.row, capabilities: { canManageRequesterTracking: true } }}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Manage requester tracking" }),
  );
  await screen.findByRole("button", { name: "Create new tracking link" });
  await userEvent.click(
    screen.getByRole("button", { name: "Close", exact: true }),
  );
  await act(async () => resolveOld({ status: "active" }));
  expect(
    screen.getByText("Revoked · Secure requester access"),
  ).toBeInTheDocument();
  expect(repository.changeTracking).not.toHaveBeenCalled();
});
