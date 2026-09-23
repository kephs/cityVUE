import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import RequestManagement from "../src/staff/requests/RequestManagement.jsx";
import RequesterHistory from "../src/staff/requests/RequesterHistory.jsx";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const history = {
  total: 2,
  page: 1,
  pageSize: 25,
  hasPreviousPage: false,
  hasNextPage: false,
  categories: [{ name: "Fictional Roads", count: 2 }],
  items: [
    {
      serviceRequestId: id,
      referenceNumber: "TEST-1",
      issueName: "Fictional Issue",
      status: "open",
      createdAt: "2026-09-23T12:00:00Z",
      current: true,
    },
    {
      serviceRequestId: other,
      referenceNumber: "TEST-2",
      issueName: "Other Issue",
      status: "closed",
      createdAt: "2026-09-22T12:00:00Z",
      current: false,
    },
  ],
};
function setup(overrides = {}) {
  const repository = {
    watchers: vi.fn().mockResolvedValue({ items: [] }),
    requesterHistory: vi.fn().mockResolvedValue(history),
  };
  const props = {
    id,
    repository,
    row: {
      audience: "public",
      requesterIdentity: "identified",
      canReadRequesterHistory: true,
      canReadContact: false,
      revision: 1,
    },
    onAccessFailure: vi.fn(),
    onMutate: vi.fn(),
    loadContact: vi.fn(),
    clearContact: vi.fn(),
    ...overrides,
  };
  const view = render(
    <MemoryRouter>
      <RequestManagement {...props} />
    </MemoryRouter>,
  );
  return { ...view, props, repository };
}
test("F050 history is lazy, Contact independent, factual and closes/restores focus; reopen retrieves afresh", async () => {
  const user = userEvent.setup();
  const { props, repository } = setup();
  const trigger = screen.getByRole("button", { name: "View Request History" });
  trigger.focus();
  await user.hover(trigger);
  expect(repository.requesterHistory).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("2 accessible requests")).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Requester History" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Current request")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Other Issue — TEST-2" }),
  ).toHaveAttribute("href", `/staff/requests/${other}`);
  expect(screen.getByText("Fictional Roads — 2")).toBeInTheDocument();
  expect(
    within(
      screen.getByText("Requester Contact").closest(".request-management-row"),
    ).getByText("Protected"),
  ).toBeInTheDocument();
  expect(props.loadContact).not.toHaveBeenCalled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(trigger).toHaveFocus();
  expect(screen.queryByText("2 accessible requests")).not.toBeInTheDocument();
  await user.click(trigger);
  await screen.findByText("2 accessible requests");
  expect(repository.requesterHistory).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Close", exact: true }));
  expect(trigger).toHaveFocus();
});
test.each([
  {
    audience: "public",
    requesterIdentity: "identified",
    canReadRequesterHistory: false,
  },
  {
    audience: "public",
    requesterIdentity: "anonymous",
    canReadRequesterHistory: true,
  },
  {
    audience: "internal",
    requesterIdentity: "identified",
    canReadRequesterHistory: true,
  },
])(
  "F050 unlinked/anonymous/INTERNAL have no history action or count",
  async (row) => {
    const { repository } = setup({ row });
    await screen.findByText("No watchers are following this request");
    expect(
      screen.queryByRole("button", { name: "View Request History" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/0 accessible|No history/),
    ).not.toBeInTheDocument();
    expect(repository.requesterHistory).not.toHaveBeenCalled();
  },
);
test("F050 pagination clears old rows, handles safe error/retry and ignores stale responses", async () => {
  const user = userEvent.setup();
  let finish;
  const repository = {
    requesterHistory: vi
      .fn()
      .mockResolvedValueOnce({ ...history, hasNextPage: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("sensitive provider details"))
      .mockResolvedValueOnce({ ...history, items: [] }),
  };
  const failure = vi.fn();
  const view = render(
    <MemoryRouter>
      <RequesterHistory
        repository={repository}
        id={id}
        onAccessFailure={failure}
      />
    </MemoryRouter>,
  );
  await screen.findByText("2 accessible requests");
  await user.click(screen.getByRole("button", { name: "Next history page" }));
  expect(screen.queryByText("Current request")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  view.rerender(
    <MemoryRouter>
      <RequesterHistory
        repository={repository}
        id={other}
        onAccessFailure={failure}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  await act(async () => finish(history));
  expect(screen.queryByText("Current request")).not.toBeInTheDocument();
  expect(screen.queryByText(/sensitive provider/)).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Retry requester history" }),
  );
  await screen.findByText("No accessible requests on this page.");
});
test("F050 history navigation uses the existing same-tab request route and closes the dialog", async () => {
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "View Request History" }),
  );
  const link = await screen.findByRole("link", {
    name: "Other Issue — TEST-2",
  });
  expect(link).not.toHaveAttribute("target");
  await userEvent.click(link);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("F050 client history projection drops protected extras and rejects malformed responses/pages", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      ...history,
      subject: "private",
      contact: "private",
      items: history.items.map((row) => ({
        ...row,
        notes: "private",
        email: "private",
      })),
    }),
  };
  const repo = createStaffRequestRepository({ client });
  expect(await repo.requesterHistory(id, 1)).toEqual(history);
  expect(client.get).toHaveBeenCalledWith(
    `/staff/service-requests/${id}/requester-history?page=1&pageSize=25`,
    expect.objectContaining({ authenticated: true }),
  );
  for (const page of [0, -1, 1.2, 1000001])
    await expect(repo.requesterHistory(id, page)).rejects.toThrow();
  client.get.mockResolvedValue({ ...history, total: -1 });
  await expect(repo.requesterHistory(id, 1)).rejects.toThrow();
  client.get.mockResolvedValue({
    ...history,
    items: [{ ...history.items[0], status: "unknown" }],
  });
  await expect(repo.requesterHistory(id, 1)).rejects.toThrow();
});
