import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StrictMode } from "react";
import RequestCommunication from "../src/staff/requests/RequestCommunication.jsx";
import RequesterContact from "../src/staff/requests/RequesterContact.jsx";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";
import { createApiClient } from "../src/api/apiClient.js";

const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const message = {
  direction: "outbound",
  channel: "portal",
  deliveryState: "recorded",
  id,
  body: "Fictional first line\nUnicode 山",
  author: { displayName: "Fictional staff" },
  createdAt: "2026-09-20T12:00:00.123456Z",
};
const page = {
  items: [message],
  pageSize: 25,
  hasMore: false,
  nextCursor: null,
};
const repository = () => ({
  communications: vi.fn().mockResolvedValue(page),
  createCommunication: vi.fn().mockResolvedValue({
    ...message,
    id: other,
    body: "Authoritative normalized body",
  }),
});
const props = (repo) => ({
  repository: repo,
  id,
  canRead: true,
  canCreate: true,
  onAccessFailure: vi.fn(),
});

test("F042 authorized stream renders plain multiline Unicode, safe author and semantic timestamp", async () => {
  const repo = repository();
  const { container } = render(<RequestCommunication {...props(repo)} />);
  expect(screen.getByText("Loading messages…")).toBeInTheDocument();
  await screen.findByText("Fictional staff");
  expect(
    screen.getByRole("heading", { name: "Requester Communication" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Resident Communication" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/requester delivery is not enabled/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("list", { name: "Messages, newest first" }),
  ).toBeInTheDocument();
  expect(container.querySelector("time")).toHaveAttribute(
    "datetime",
    message.createdAt,
  );
  expect(container.querySelector(".request-message-body").textContent).toBe(
    message.body,
  );
  expect(screen.getByLabelText("Message")).toBeInTheDocument();
  expect(container.querySelector("textarea")).toHaveAttribute(
    "maxlength",
    "4000",
  );
  expect(
    screen.queryByRole("button", { name: /Edit|Delete|Remove/ }),
  ).not.toBeInTheDocument();
});
test("F042 read-only empty stream has no composer and still supports refresh", async () => {
  const repo = repository();
  repo.communications.mockResolvedValue({ ...page, items: [] });
  render(<RequestCommunication {...props(repo)} canCreate={false} />);
  await screen.findByText("No messages have been added.");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add Message" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await waitFor(() => expect(repo.communications).toHaveBeenCalledTimes(2));
});
test.each([false, true])(
  "F042 no-read capability prevents bodies/counts/fetch/composer even when create=%s",
  (canCreate) => {
    const repo = repository();
    render(
      <RequestCommunication
        {...props(repo)}
        canRead={false}
        canCreate={canCreate}
      />,
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(
      screen.getByText("You don't have permission to view messages."),
    ).toBeInTheDocument();
    expect(repo.communications).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
  },
);
test("F042 load older appends server order, de-duplicates boundary and focuses the first older message", async () => {
  const repo = repository();
  repo.communications
    .mockResolvedValueOnce({ ...page, hasMore: true, nextCursor: "cursor" })
    .mockResolvedValueOnce({
      ...page,
      items: [
        {
          ...message,
          id: other,
          body: "Older message",
          createdAt: "2026-09-19T12:00:00Z",
        },
      ],
    });
  render(<RequestCommunication {...props(repo)} />);
  await screen.findByText("Fictional staff");
  fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  await screen.findByText("Older message");
  expect(repo.communications.mock.calls[1][1]).toBe("cursor");
  expect(screen.getAllByRole("listitem").map((item) => item.id)).toEqual([
    `message-${id}`,
    `message-${other}`,
  ]);
  expect(screen.getAllByRole("listitem")[1]).toHaveFocus();
});
test("F042 Add Message is single-flight, returns authoritative state, clears draft and restores textarea focus", async () => {
  const repo = repository();
  let resolve;
  repo.createCommunication.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(
    <StrictMode>
      <RequestCommunication {...props(repo)} />
    </StrictMode>,
  );
  await screen.findByText("Fictional staff");
  const input = screen.getByLabelText("Message");
  fireEvent.change(input, { target: { value: "  Draft to normalize  " } });
  const add = screen.getByRole("button", { name: "Add Message" });
  fireEvent.click(add);
  fireEvent.click(add);
  expect(repo.createCommunication).toHaveBeenCalledTimes(1);
  expect(input).toBeDisabled();
  expect(add).toBeDisabled();
  expect(screen.getByText("Adding message…")).toBeInTheDocument();
  await act(async () =>
    resolve({ ...message, id: other, body: "Authoritative normalized body" }),
  );
  expect(screen.getByText("Authoritative normalized body")).toBeInTheDocument();
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  expect(screen.getByText("Message added.")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
test("F042 uncertain submission retains draft and retry key; changing the draft uses a new key", async () => {
  const repo = repository();
  repo.createCommunication
    .mockRejectedValueOnce({ status: 500 })
    .mockRejectedValueOnce({ code: "timeout" })
    .mockResolvedValue({ ...message, id: other });
  render(<RequestCommunication {...props(repo)} />);
  await screen.findByText("Fictional staff");
  const input = screen.getByLabelText("Message");
  fireEvent.change(input, { target: { value: "Fictional retry" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("Fictional retry");
  fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
  await waitFor(() =>
    expect(repo.createCommunication).toHaveBeenCalledTimes(2),
  );
  expect(repo.createCommunication.mock.calls[1][2]).toBe(
    repo.createCommunication.mock.calls[0][2],
  );
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, { target: { value: "Changed fictional retry" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
  await screen.findByText("Message added.");
  expect(repo.createCommunication.mock.calls[2][2]).not.toBe(
    repo.createCommunication.mock.calls[0][2],
  );
});
test.each(["", " \n ", "x".repeat(4001), "invalid\u0001"])(
  "F042 invalid draft is announced and never submitted (%#)",
  async (body) => {
    const repo = repository();
    render(<RequestCommunication {...props(repo)} />);
    await screen.findByText("Fictional staff");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: body },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(repo.createCommunication).not.toHaveBeenCalled();
  },
);
test("F042 multiline Enter adds a line, maximum Unicode text is accepted, and count remains associated", async () => {
  const repo = repository();
  render(<RequestCommunication {...props(repo)} />);
  await screen.findByText("Fictional staff");
  const input = screen.getByLabelText("Message");
  const user = userEvent.setup();
  await user.type(input, "First{enter}Second");
  expect(input).toHaveValue("First\nSecond");
  expect(repo.createCommunication).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "😀".repeat(2000) } });
  expect(screen.getByText("4,000 / 4,000 characters")).toBeInTheDocument();
  expect(input).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("requester-message-count"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
  await screen.findByText("Message added.");
});
test.each(["{Enter}", " "])(
  "F042 clearing a multiline draft before keyboard Add Message never submits the old draft (%s)",
  async (activation) => {
    const repo = repository();
    render(<RequestCommunication {...props(repo)} />);
    await screen.findByText("Fictional staff");
    const user = userEvent.setup();
    const input = screen.getByLabelText("Message");
    await user.type(input, "Fictional keyboard draft{Enter}");
    expect(repo.createCommunication).not.toHaveBeenCalled();
    await user.clear(input);
    await waitFor(() => {
      expect(input).toHaveValue("");
      expect(screen.getByText("0 / 4,000 characters")).toBeInTheDocument();
    });
    await user.tab();
    expect(screen.getByRole("button", { name: "Add Message" })).toHaveFocus();
    await user.keyboard(activation);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a message.",
    );
    expect(input).toHaveFocus();
    expect(repo.createCommunication).not.toHaveBeenCalled();
  },
);

test.each([
  "<script>alert('message')</script>",
  "<img src=x onerror=alert(1)>",
  "[link](javascript:alert(1))",
  "https://example.invalid @fictional",
])("F042 stored markup remains literal text: %s", async (body) => {
  const repo = repository();
  repo.communications.mockResolvedValue({
    ...page,
    items: [{ ...message, body }],
  });
  const { container } = render(<RequestCommunication {...props(repo)} />);
  await screen.findByText(body);
  expect(container.querySelectorAll("script,img,a")).toHaveLength(0);
});
test("F042 request changes immediately clear messages and draft and ignore old in-flight response", async () => {
  const repo = repository();
  const initial = props(repo);
  const { rerender } = render(<RequestCommunication {...initial} />);
  await screen.findByText("Fictional staff");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Discard on navigation" },
  });
  let resolve;
  repo.communications.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  const oldResolve = resolve;
  repo.communications.mockResolvedValue({ ...page, items: [] });
  rerender(<RequestCommunication {...initial} id={other} />);
  expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toHaveValue("");
  await act(async () => oldResolve(page));
  await screen.findByText("No messages have been added.");
  expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
});
test("F042 known permission loss clears stream/author/draft immediately and restoration reloads", async () => {
  const repo = repository();
  const initial = props(repo);
  const { rerender } = render(<RequestCommunication {...initial} />);
  await screen.findByText("Fictional staff");
  rerender(<RequestCommunication {...initial} canRead={false} />);
  expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  rerender(<RequestCommunication {...initial} />);
  await screen.findByText("Fictional staff");
  expect(repo.communications).toHaveBeenCalledTimes(2);
});
test.each([401, 403, 404])(
  "F042 communication fetch denial %i clears values and rechecks parent through callback",
  async (status) => {
    const repo = repository();
    const initial = props(repo);
    render(<RequestCommunication {...initial} />);
    await screen.findByText("Fictional staff");
    repo.communications.mockRejectedValue({ status });
    fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
    await screen.findByText("Protected");
    expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
    expect(initial.onAccessFailure).toHaveBeenCalledWith({ status });
  },
);
test("F042 create-only denial keeps readable messages, clears draft and removes composer", async () => {
  const repo = repository();
  repo.createCommunication.mockRejectedValue({ status: 403 });
  const initial = props(repo);
  render(<RequestCommunication {...initial} />);
  await screen.findByText("Fictional staff");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Fictional denied message" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add Message" }));
  await waitFor(() =>
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Fictional staff")).toBeInTheDocument();
  expect(initial.onAccessFailure).toHaveBeenCalled();
});
test("F042 safe load error permits retry without reflecting server text", async () => {
  const repo = repository();
  repo.communications.mockRejectedValueOnce(
    new Error("private fictional database error"),
  );
  render(<RequestCommunication {...props(repo)} />);
  await screen.findByRole("alert");
  expect(
    screen.queryByText("private fictional database error"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry messages" }));
  await screen.findByText("Fictional staff");
});
test.each([
  [true, false],
  [false, true],
  [true, true],
  [false, false],
])(
  "F042 Notes read=%s and contact read=%s remain independent",
  async (messages, contact) => {
    const repo = repository();
    render(
      <>
        <RequestCommunication {...props(repo)} canRead={messages} />
        <RequesterContact
          canRead={contact}
          state={{ data: { name: "Fictional requester", email: null } }}
        />
      </>,
    );
    if (messages) await screen.findByText("Fictional staff");
    else expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
    expect(Boolean(screen.queryByText("Fictional requester"))).toBe(contact);
  },
);
test("F042 messages do not refetch when unrelated operational props rerender and unmount aborts session content", async () => {
  const repo = repository();
  const initial = props(repo);
  const { rerender, unmount } = render(<RequestCommunication {...initial} />);
  await screen.findByText("Fictional staff");
  rerender(<RequestCommunication {...initial} revision={2} />);
  expect(repo.communications).toHaveBeenCalledTimes(1);
  const signal = repo.communications.mock.calls[0][2];
  unmount();
  expect(signal.aborted).toBe(true);
});
test("F042 repository projects communications explicitly and transports only body plus the retry header", async () => {
  const fetchImplementation = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    headers: { get: () => null },
    json: async () => ({
      ...message,
      organizationId: "hidden",
      author: { ...message.author, email: "hidden" },
    }),
  });
  const client = createApiClient({
    baseUrl: "http://localhost:3000/api/v1",
    fetchImplementation,
    getAccessToken: async () => "fictional-test-token",
  });
  const repo = createStaffRequestRepository({ client });
  expect(await repo.createCommunication(id, message.body, other)).toEqual(
    message,
  );
  const [url, options] = fetchImplementation.mock.calls[0];
  expect(url).not.toContain(message.body);
  expect(JSON.parse(options.body)).toEqual({ body: message.body });
  expect(options.headers["Idempotency-Key"]).toBe(other);
  const listClient = {
    get: vi.fn().mockResolvedValue({
      ...page,
      total: 50,
      items: [{ ...message, contact: "hidden" }],
    }),
  };
  expect(
    await createStaffRequestRepository({ client: listClient }).communications(
      id,
      null,
    ),
  ).toEqual({ items: [message], hasMore: false, nextCursor: null });
});
