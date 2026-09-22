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
import InternalNotes from "../src/staff/requests/InternalNotes.jsx";
import RequesterContact from "../src/staff/requests/RequesterContact.jsx";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";
import { createApiClient } from "../src/api/apiClient.js";

const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const note = {
  id,
  body: "Fictional first line\nUnicode 山",
  author: { displayName: "Fictional staff" },
  createdAt: "2026-09-20T12:00:00.123456Z",
};
const page = { items: [note], pageSize: 25, hasMore: false, nextCursor: null };
const repository = () => ({
  notes: vi.fn().mockResolvedValue(page),
  createNote: vi.fn().mockResolvedValue({
    ...note,
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

test("F041 authorized stream renders plain multiline Unicode, safe author and semantic timestamp", async () => {
  const repo = repository();
  const { container } = render(<InternalNotes {...props(repo)} />);
  expect(screen.getByText("Loading internal notes…")).toBeInTheDocument();
  await screen.findByText("Fictional staff");
  expect(
    screen.getByRole("heading", { name: "Internal Notes" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("list", { name: "Internal notes, newest first" }),
  ).toBeInTheDocument();
  expect(container.querySelector("time")).toHaveAttribute(
    "datetime",
    note.createdAt,
  );
  expect(container.querySelector(".request-note-body").textContent).toBe(
    note.body,
  );
  expect(screen.getByLabelText("Internal Note")).toBeInTheDocument();
  expect(container.querySelector("textarea")).toHaveAttribute(
    "maxlength",
    "4000",
  );
  expect(
    screen.queryByRole("button", { name: /Edit|Delete|Remove/ }),
  ).not.toBeInTheDocument();
});
test("F041 read-only empty stream has no composer and still supports refresh", async () => {
  const repo = repository();
  repo.notes.mockResolvedValue({ ...page, items: [] });
  render(<InternalNotes {...props(repo)} canCreate={false} />);
  await screen.findByText("No internal notes have been added.");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add Note" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh notes" }));
  await waitFor(() => expect(repo.notes).toHaveBeenCalledTimes(2));
});
test.each([false, true])(
  "F041 no-read capability prevents bodies/counts/fetch/composer even when create=%s",
  (canCreate) => {
    const repo = repository();
    render(
      <InternalNotes {...props(repo)} canRead={false} canCreate={canCreate} />,
    );
    expect(screen.getByText("Protected")).toBeInTheDocument();
    expect(
      screen.getByText("You don't have permission to view internal notes."),
    ).toBeInTheDocument();
    expect(repo.notes).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
  },
);
test("F041 load older appends server order, de-duplicates boundary and focuses the first older note", async () => {
  const repo = repository();
  repo.notes
    .mockResolvedValueOnce({ ...page, hasMore: true, nextCursor: "cursor" })
    .mockResolvedValueOnce({
      ...page,
      items: [
        {
          ...note,
          id: other,
          body: "Older note",
          createdAt: "2026-09-19T12:00:00Z",
        },
      ],
    });
  render(<InternalNotes {...props(repo)} />);
  await screen.findByText("Fictional staff");
  fireEvent.click(screen.getByRole("button", { name: "Load older notes" }));
  await screen.findByText("Older note");
  expect(repo.notes.mock.calls[1][1]).toBe("cursor");
  expect(screen.getAllByRole("listitem").map((item) => item.id)).toEqual([
    `note-${id}`,
    `note-${other}`,
  ]);
  await waitFor(() => expect(screen.getAllByRole("listitem")[1]).toHaveFocus());
});
test("F041 Add Note is single-flight, returns authoritative state, clears draft and restores textarea focus", async () => {
  const repo = repository();
  let resolve;
  repo.createNote.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(
    <StrictMode>
      <InternalNotes {...props(repo)} />
    </StrictMode>,
  );
  await screen.findByText("Fictional staff");
  const input = screen.getByLabelText("Internal Note");
  fireEvent.change(input, { target: { value: "  Draft to normalize  " } });
  const add = screen.getByRole("button", { name: "Add Note" });
  fireEvent.click(add);
  fireEvent.click(add);
  expect(repo.createNote).toHaveBeenCalledTimes(1);
  expect(input).toBeDisabled();
  expect(add).toBeDisabled();
  expect(screen.getByText("Adding internal note…")).toBeInTheDocument();
  await act(async () =>
    resolve({ ...note, id: other, body: "Authoritative normalized body" }),
  );
  expect(screen.getByText("Authoritative normalized body")).toBeInTheDocument();
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  expect(screen.getByText("Internal note added.")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
test("F041 uncertain submission retains draft and retry key; changing the draft uses a new key", async () => {
  const repo = repository();
  repo.createNote
    .mockRejectedValueOnce({ status: 500 })
    .mockRejectedValueOnce({ code: "timeout" })
    .mockResolvedValue({ ...note, id: other });
  render(<InternalNotes {...props(repo)} />);
  await screen.findByText("Fictional staff");
  const input = screen.getByLabelText("Internal Note");
  fireEvent.change(input, { target: { value: "Fictional retry" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("Fictional retry");
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  await waitFor(() => expect(repo.createNote).toHaveBeenCalledTimes(2));
  expect(repo.createNote.mock.calls[1][2]).toBe(
    repo.createNote.mock.calls[0][2],
  );
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, { target: { value: "Changed fictional retry" } });
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  await screen.findByText("Internal note added.");
  expect(repo.createNote.mock.calls[2][2]).not.toBe(
    repo.createNote.mock.calls[0][2],
  );
});
test.each(["", " \n ", "x".repeat(4001), "invalid\u0001"])(
  "F041 invalid draft is announced and never submitted (%#)",
  async (body) => {
    const repo = repository();
    render(<InternalNotes {...props(repo)} />);
    await screen.findByText("Fictional staff");
    fireEvent.change(screen.getByLabelText("Internal Note"), {
      target: { value: body },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(repo.createNote).not.toHaveBeenCalled();
  },
);
test("F041 multiline Enter adds a line, maximum Unicode text is accepted, and count remains associated", async () => {
  const repo = repository();
  render(<InternalNotes {...props(repo)} />);
  await screen.findByText("Fictional staff");
  const input = screen.getByLabelText("Internal Note");
  const user = userEvent.setup();
  await user.type(input, "First{enter}Second");
  expect(input).toHaveValue("First\nSecond");
  expect(repo.createNote).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "😀".repeat(2000) } });
  expect(screen.getByText("4,000 / 4,000 characters")).toBeInTheDocument();
  expect(input).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("internal-note-count"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  await screen.findByText("Internal note added.");
});
test.each([
  "<script>alert('note')</script>",
  "<img src=x onerror=alert(1)>",
  "[link](javascript:alert(1))",
  "https://example.invalid @fictional",
])("F041 stored markup remains literal text: %s", async (body) => {
  const repo = repository();
  repo.notes.mockResolvedValue({ ...page, items: [{ ...note, body }] });
  const { container } = render(<InternalNotes {...props(repo)} />);
  await screen.findByText(body);
  expect(container.querySelectorAll("script,img,a")).toHaveLength(0);
});
test("F041 request changes immediately clear Notes and draft and ignore old in-flight response", async () => {
  const repo = repository();
  const initial = props(repo);
  const { rerender } = render(<InternalNotes {...initial} />);
  await screen.findByText("Fictional staff");
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Discard on navigation" },
  });
  let resolve;
  repo.notes.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh notes" }));
  const oldResolve = resolve;
  repo.notes.mockResolvedValue({ ...page, items: [] });
  rerender(<InternalNotes {...initial} id={other} />);
  expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Internal Note")).toHaveValue("");
  await act(async () => oldResolve(page));
  await screen.findByText("No internal notes have been added.");
  expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
});
test("F041 known permission loss clears stream/author/draft immediately and restoration reloads", async () => {
  const repo = repository();
  const initial = props(repo);
  const { rerender } = render(<InternalNotes {...initial} />);
  await screen.findByText("Fictional staff");
  rerender(<InternalNotes {...initial} canRead={false} />);
  expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  rerender(<InternalNotes {...initial} />);
  await screen.findByText("Fictional staff");
  expect(repo.notes).toHaveBeenCalledTimes(2);
});
test.each([401, 403, 404])(
  "F041 Notes fetch denial %i clears values and rechecks parent through callback",
  async (status) => {
    const repo = repository();
    const initial = props(repo);
    render(<InternalNotes {...initial} />);
    await screen.findByText("Fictional staff");
    repo.notes.mockRejectedValue({ status });
    fireEvent.click(screen.getByRole("button", { name: "Refresh notes" }));
    await screen.findByText("Protected");
    expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
    expect(initial.onAccessFailure).toHaveBeenCalledWith({ status });
  },
);
test("F041 create-only denial keeps readable Notes, clears draft and removes composer", async () => {
  const repo = repository();
  repo.createNote.mockRejectedValue({ status: 403 });
  const initial = props(repo);
  render(<InternalNotes {...initial} />);
  await screen.findByText("Fictional staff");
  fireEvent.change(screen.getByLabelText("Internal Note"), {
    target: { value: "Fictional denied note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  await waitFor(() =>
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Fictional staff")).toBeInTheDocument();
  expect(initial.onAccessFailure).toHaveBeenCalled();
});
test("F041 safe load error permits retry without reflecting server text", async () => {
  const repo = repository();
  repo.notes.mockRejectedValueOnce(
    new Error("private fictional database error"),
  );
  render(<InternalNotes {...props(repo)} />);
  await screen.findByRole("alert");
  expect(
    screen.queryByText("private fictional database error"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry notes" }));
  await screen.findByText("Fictional staff");
});
test.each([
  [true, false],
  [false, true],
  [true, true],
  [false, false],
])(
  "F041 Notes read=%s and contact read=%s remain independent",
  async (notes, contact) => {
    const repo = repository();
    render(
      <>
        <InternalNotes {...props(repo)} canRead={notes} />
        <RequesterContact
          canRead={contact}
          state={{ data: { name: "Fictional resident", email: null } }}
        />
      </>,
    );
    if (notes) await screen.findByText("Fictional staff");
    else expect(screen.queryByText("Fictional staff")).not.toBeInTheDocument();
    expect(Boolean(screen.queryByText("Fictional resident"))).toBe(contact);
  },
);
test("F041 Notes do not refetch when unrelated operational props rerender and unmount aborts session content", async () => {
  const repo = repository();
  const initial = props(repo);
  const { rerender, unmount } = render(<InternalNotes {...initial} />);
  await screen.findByText("Fictional staff");
  rerender(<InternalNotes {...initial} revision={2} />);
  expect(repo.notes).toHaveBeenCalledTimes(1);
  const signal = repo.notes.mock.calls[0][2];
  unmount();
  expect(signal.aborted).toBe(true);
});
test("F041 repository projects Notes explicitly and transports only body plus the retry header", async () => {
  const fetchImplementation = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    headers: { get: () => null },
    json: async () => ({
      ...note,
      organizationId: "hidden",
      author: { ...note.author, email: "hidden" },
    }),
  });
  const client = createApiClient({
    baseUrl: "http://localhost:3000/api/v1",
    fetchImplementation,
    getAccessToken: async () => "fictional-test-token",
  });
  const repo = createStaffRequestRepository({ client });
  expect(await repo.createNote(id, note.body, other)).toEqual(note);
  const [url, options] = fetchImplementation.mock.calls[0];
  expect(url).not.toContain(note.body);
  expect(JSON.parse(options.body)).toEqual({ body: note.body });
  expect(options.headers["Idempotency-Key"]).toBe(other);
  const listClient = {
    get: vi.fn().mockResolvedValue({
      ...page,
      total: 50,
      items: [{ ...note, contact: "hidden" }],
    }),
  };
  expect(
    await createStaffRequestRepository({ client: listClient }).notes(id, null),
  ).toEqual({ items: [note], hasMore: false, nextCursor: null });
});
