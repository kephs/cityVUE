import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import CollaborationPanel from "../src/staff/requests/CollaborationPanel.jsx";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";

const page = { items: [], nextCursor: null };
const repository = () => ({
  notes: vi.fn().mockResolvedValue(page),
  communications: vi.fn().mockResolvedValue(page),
});
const all = {
  canReadNotes: true,
  canCreateNotes: true,
  canReadCommunications: true,
  canCreateCommunication: true,
};
const props = (repo, audience = "internal", capabilities = all) => ({
  repository: repo,
  id: "fictional-request",
  audience,
  capabilities,
});

test.each([
  ["internal", "Internal notes, newest first", "Internal Note"],
  ["public", "Messages, newest first", "Recorded in Reqro"],
])(
  "F058.2 %s history associates author, time, long body and attachments in one consistent entry",
  async (audience, listName, context) => {
    const body = "Fictional long content\n" + "x".repeat(3900);
    const author = "Fictional Author ".repeat(12);
    const filename = "fictional-" + "long-".repeat(18) + ".png";
    const item = {
      id: "fictional-entry",
      body,
      author: { displayName: author },
      createdAt: "2026-09-26T12:00:00Z",
      attachments: [
        {
          id: "fictional-image",
          filename,
          mediaType: "image/png",
          byteSize: 2048,
          state: "CLEAN",
        },
      ],
    };
    const repo = repository();
    repo.notes.mockResolvedValue({ items: [item], nextCursor: null });
    repo.communications.mockResolvedValue({ items: [item], nextCursor: null });
    repo.attachments = {
      download: vi.fn(),
      policy: vi.fn().mockResolvedValue({ enabled: false }),
    };
    const view = render(<CollaborationPanel {...props(repo, audience)} />);
    await screen.findByText(author.trim());
    const entry = screen.getByRole("list", {
      name: listName,
    }).firstElementChild;
    expect(entry).toHaveClass("collaboration-entry");
    expect(entry.querySelector("strong")).toHaveTextContent(author.trim());
    expect(entry.querySelector("time")).toHaveAttribute(
      "datetime",
      item.createdAt,
    );
    expect(entry.querySelector("time")).toHaveTextContent(
      new Date(item.createdAt).toLocaleString(),
    );
    expect(
      entry.querySelector(
        audience === "public" ? ".request-message-body" : ".request-note-body",
      ).textContent,
    ).toBe(body);
    expect(within(entry).getByText(context)).toBeInTheDocument();
    expect(within(entry).getByText(filename)).toBeInTheDocument();
    expect(
      within(entry).getByRole("button", { name: `Preview ${filename}` }),
    ).toBeInTheDocument();
    expect(
      within(entry).queryByText(/^(Sent|Delivered|Read)$/),
    ).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  },
);

test("F058.2 real repository projection carries inactive eligibility into Collaboration", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const client = {
    get: vi
      .fn()
      .mockResolvedValueOnce({
        serviceRequestId: id,
        audience: "internal",
        status: "open",
        referenceNumber: "TEST-0001",
        issueName: "Fictional issue",
        departmentName: "Fictional department",
        description: "Fictional request",
        revision: 1,
        capabilities: {
          canReadCommunications: true,
          canCreateCommunication: false,
          communicationCreationUnavailableReason: "requester_inactive",
        },
      })
      .mockResolvedValue({ items: [], nextCursor: null }),
  };
  const repo = createStaffRequestRepository({ client });
  const detail = await repo.detail(id);
  render(
    <CollaborationPanel
      repository={repo}
      id={id}
      audience={detail.audience}
      capabilities={detail.capabilities}
    />,
  );
  await screen.findByText(/requester is no longer active/);
  expect(
    screen.queryByRole("button", { name: "Add Message" }),
  ).not.toBeInTheDocument();
});

test.each([
  ["public", "Requester Communication"],
  ["internal", "Internal Notes"],
])(
  "F058.2 %s selects %s and lazily loads only the active stream",
  async (audience, selected) => {
    const repo = repository();
    render(<CollaborationPanel {...props(repo, audience)} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(
      audience === "public"
        ? ["Requester Communication", "Internal Notes"]
        : ["Internal Notes", "Requester Communication"],
    );
    expect(screen.getByRole("tab", { name: selected })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() =>
      expect(
        audience === "public" ? repo.communications : repo.notes,
      ).toHaveBeenCalledTimes(1),
    );
    expect(
      audience === "public" ? repo.notes : repo.communications,
    ).not.toHaveBeenCalled();
  },
);

test.each([
  ["internal", "notes"],
  ["internal", "communication"],
  ["internal", "none"],
  ["public", "notes"],
  ["public", "communication"],
  ["public", "none"],
])("F058.2 %s only usable %s streams are rendered", async (audience, key) => {
  const repo = repository();
  render(
    <CollaborationPanel
      {...props(repo, audience, {
        canReadNotes: key === "notes",
        canReadCommunications: key === "communication",
      })}
    />,
  );
  if (key === "none") {
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(repo.notes).not.toHaveBeenCalled();
    expect(repo.communications).not.toHaveBeenCalled();
  } else {
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab")).toHaveAttribute("aria-selected", "true");
    await screen.findByText(
      key === "notes"
        ? "No internal notes have been added."
        : "No messages have been added.",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  }
});

test("F058.2 inactive requester history retains record-only notice with no composer or identifiers", async () => {
  const repo = repository();
  render(
    <CollaborationPanel
      {...props(repo, "internal", {
        canReadCommunications: true,
        canCreateCommunication: false,
        communicationCreationUnavailableReason: "requester_inactive",
      })}
    />,
  );
  await screen.findByText("No messages have been added.");
  expect(screen.getByText(/requester is no longer active/)).toBeInTheDocument();
  expect(
    screen.getByRole("complementary", {
      name: "About Requester Communication",
    }),
  ).toHaveTextContent("does not currently send");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Send|Add Message/ }),
  ).not.toBeInTheDocument();
});

test("F058.2 keyboard navigation retains separate drafts with safe defaults", async () => {
  const repo = repository();
  render(<CollaborationPanel {...props(repo)} />);
  await screen.findByText("No internal notes have been added.");
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Fictional unsaved note" },
  });
  const notes = screen.getByRole("tab", { name: "Internal Notes" }),
    messages = screen.getByRole("tab", { name: "Requester Communication" });
  fireEvent.keyDown(notes, { key: "End" });
  expect(messages).toHaveFocus();
  await screen.findByText("No messages have been added.");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Fictional unsaved message" },
  });
  fireEvent.keyDown(messages, { key: "ArrowLeft" });
  expect(notes).toHaveFocus();
  expect(screen.getByLabelText("Internal Note")).toHaveValue(
    "Fictional unsaved note",
  );
  fireEvent.keyDown(notes, { key: "ArrowRight" });
  expect(messages).toHaveFocus();
  expect(screen.getByLabelText("Message")).toHaveValue(
    "Fictional unsaved message",
  );
  fireEvent.keyDown(messages, { key: "Home" });
  expect(notes).toHaveFocus();
  expect(repo.notes).toHaveBeenCalledTimes(1);
  expect(repo.communications).toHaveBeenCalledTimes(1);
});

test("F058.2 capability loss removes protected stream, aborts late response and restores focus", async () => {
  const repo = repository();
  let resolve;
  repo.communications.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <>
      <h2 id="staff-requests-heading" tabIndex={-1}>
        Synthetic workspace
      </h2>
      <CollaborationPanel {...props(repo, "public")} />
    </>,
  );
  screen.getByRole("tab", { name: "Requester Communication" }).focus();
  const signal = repo.communications.mock.calls[0][2];
  view.rerender(
    <>
      <h2 id="staff-requests-heading" tabIndex={-1}>
        Synthetic workspace
      </h2>
      <CollaborationPanel {...props(repo, "public", { canReadNotes: true })} />
    </>,
  );
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("tab", { name: "Internal Notes" })).toHaveFocus();
  await act(async () =>
    resolve({
      items: [
        {
          id: "fictional-message",
          body: "Fictional denied text",
          author: { displayName: "Fictional staff" },
          createdAt: "2026-09-26T00:00:00Z",
        },
      ],
    }),
  );
  expect(screen.queryByText("Fictional denied text")).not.toBeInTheDocument();
  view.rerender(
    <>
      <h2 id="staff-requests-heading" tabIndex={-1}>
        Synthetic workspace
      </h2>
      <CollaborationPanel {...props(repo, "public", {})} />
    </>,
  );
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Synthetic workspace" }),
  ).toHaveFocus();
});
