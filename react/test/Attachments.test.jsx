import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import {
  AttachmentSelector,
  AttachmentList,
  RequestEvidence,
  useAttachmentDraft,
  displayFilename,
} from "../src/attachments/Attachments.jsx";
import {
  attachmentProjection,
  createAttachmentRepository,
} from "../src/attachments/attachmentRepository.js";
import CollaborationPanel from "../src/staff/requests/CollaborationPanel.jsx";
import { createApiClient } from "../src/api/apiClient.js";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const claim = { batchId: id, token: "S".repeat(43) };
const metadata = {
  id,
  filename: "synthetic.png",
  mediaType: "image/png",
  byteSize: 32,
  state: "CLEAN",
};
const fixture = (name = "synthetic.png", type = "image/png") =>
  new File(["fictional bytes"], name, { type });
function repository() {
  return {
    policy: vi.fn().mockResolvedValue({ enabled: true }),
    start: vi.fn().mockResolvedValue(claim),
    upload: vi.fn(async (_claim, id, file) => ({
      ...metadata,
      id,
      filename: displayFilename(file.name),
    })),
    remove: vi.fn().mockResolvedValue({ removed: true }),
    preview: vi
      .fn()
      .mockResolvedValue(new Blob(["processed"], { type: "image/png" })),
    download: vi
      .fn()
      .mockResolvedValue(new Blob(["processed"], { type: "image/png" })),
  };
}
function Harness({
  repo,
  binding = { issueId: id, versionId: other },
  onAccessFailure,
}) {
  const draft = useAttachmentDraft(repo, binding, onAccessFailure);
  return (
    <>
      <AttachmentSelector draft={draft} camera label="Photos & Files" />
      <button disabled={!draft.ready} onClick={draft.clear}>
        Submit parent
      </button>
    </>
  );
}
const select = (files) =>
  fireEvent.change(screen.getByLabelText("Choose attachment files"), {
    target: { files },
  });
beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValue("blob:synthetic");
  URL.revokeObjectURL = vi.fn();
});

test.each([0, 1, 3])(
  "F046 authorized evidence count %s uses only the loaded projection",
  async (count) => {
    const repo = repository();
    let finish;
    repo.evidence = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<RequestEvidence repository={repo} requestId={id} />);
    expect(screen.getByText("Loading request evidence…")).toBeInTheDocument();
    expect(screen.queryByText("No attachments")).not.toBeInTheDocument();
    await waitFor(() => expect(repo.evidence).toHaveBeenCalledTimes(1));
    const items = Array.from({ length: count }, (_, index) => ({
      ...metadata,
      id: String(index),
      filename: "synthetic-" + index + ".png",
    }));
    await act(() => finish(items));
    expect(
      screen.getByText(
        count === 0
          ? "No attachments"
          : count === 1
            ? "1 attachment"
            : "3 attachments",
      ),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(count);
    if (count) {
      expect(screen.getByRole("list").tagName).toBe("OL");
      expect(
        screen
          .getAllByRole("listitem")
          .map((item) => item.querySelector(".attachment-ordinal").textContent),
      ).toEqual(items.map((_, index) => index + 1 + "."));
    }
    expect(repo.evidence).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    expect(repo.download).not.toHaveBeenCalled();
  },
);

test.each([401, 403, 404, 500])(
  "F046 evidence failure %s cannot masquerade as zero or expose a count",
  async (status) => {
    const repo = repository(),
      denied = vi.fn();
    repo.evidence = vi.fn().mockRejectedValue({ status });
    render(
      <RequestEvidence
        repository={repo}
        requestId={id}
        onAccessFailure={denied}
      />,
    );
    await screen.findByText("Request evidence unavailable.");
    expect(screen.queryByText("No attachments")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(repo.download).not.toHaveBeenCalled();
    if (status !== 500) expect(denied).toHaveBeenCalledWith({ status });
    else expect(denied).not.toHaveBeenCalled();
  },
);

test("F046 disabled evidence does not fetch metadata or disclose a zero count", async () => {
  const repo = repository();
  repo.policy.mockResolvedValue({ enabled: false });
  repo.evidence = vi.fn();
  render(<RequestEvidence repository={repo} requestId={id} />);
  await waitFor(() =>
    expect(
      screen.queryByText("Loading request evidence…"),
    ).not.toBeInTheDocument(),
  );
  expect(repo.evidence).not.toHaveBeenCalled();
  expect(screen.queryByText("No attachments")).not.toBeInTheDocument();
});

test("F046 image modal restores each origin and reauthorizes thumbnail and download", async () => {
  const repo = repository(),
    user = userEvent.setup();
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const view = render(
    <AttachmentList
      items={[metadata]}
      repository={repo}
      requestId={id}
      parentId={other}
      context="INTERNAL_NOTE"
    />,
  );
  const preview = screen.getByRole("button", { name: "Preview synthetic.png" });
  preview.focus();
  await user.keyboard("{Enter}");
  let dialog = await screen.findByRole("dialog", { name: "Image Preview" });
  expect(
    within(dialog).getByRole("button", { name: "Close", exact: true }),
  ).toHaveFocus();
  await user.tab();
  expect(
    within(dialog).getByRole("button", { name: "Download synthetic.png" }),
  ).toHaveFocus();
  await user.keyboard(" ");
  await waitFor(() => expect(anchor).toHaveBeenCalledTimes(1));
  expect(anchor.mock.instances[0].download).toBe("synthetic.png");
  expect(anchor.mock.instances[0].href).toBe("blob:synthetic");
  expect(within(dialog).getByRole("img")).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Close", exact: true }),
  );
  expect(preview).toHaveFocus();
  const thumbnail = screen.getByRole("button", {
    name: "Enlarge synthetic.png",
  });
  thumbnail.focus();
  await user.keyboard(" ");
  dialog = await screen.findByRole("dialog", { name: "Image Preview" });
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(thumbnail).toHaveFocus();
  expect(repo.download).toHaveBeenCalledTimes(3);
  for (const call of repo.download.mock.calls) {
    expect(call).toEqual([
      id,
      "INTERNAL_NOTE",
      other,
      id,
      expect.any(AbortSignal),
    ]);
  }
  // Closing retains the authorized inline thumbnail; replacement/unmount revoke it.
  expect(screen.getByAltText("Preview of synthetic.png")).toBeInTheDocument();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  expect(repo.download.mock.calls[0][4].aborted).toBe(true);
  anchor.mockRestore();
});

test("F046 closing during a download restores focus without reopening after completion", async () => {
  const repo = repository(),
    user = userEvent.setup();
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  render(
    <AttachmentList
      items={[metadata]}
      repository={repo}
      requestId={id}
      parentId={id}
      context="REQUEST_EVIDENCE"
    />,
  );
  const preview = screen.getByRole("button", { name: "Preview synthetic.png" });
  await user.click(preview);
  const dialog = await screen.findByRole("dialog");
  let finish;
  repo.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Download synthetic.png" }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Close", exact: true }),
  );
  expect(preview).toHaveFocus();
  expect(preview).toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Enter}");
  expect(repo.download).toHaveBeenCalledTimes(2);
  await act(() => finish(new Blob(["processed"], { type: "image/png" })));
  expect(preview).toHaveFocus();
  expect(preview).toHaveAttribute("aria-disabled", "false");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(anchor).toHaveBeenCalledTimes(1);
  anchor.mockRestore();
});

test("F046 changing attachment context discards previews and aborts late retrieval", async () => {
  const repo = repository(),
    user = userEvent.setup();
  let finish;
  repo.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <AttachmentList
      items={[metadata]}
      repository={repo}
      requestId={id}
      parentId={id}
      context="REQUEST_EVIDENCE"
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Preview synthetic.png" }),
  );
  const signal = repo.download.mock.calls[0][4];
  view.rerender(
    <AttachmentList
      items={[metadata]}
      repository={repo}
      requestId={other}
      parentId={other}
      context="REQUEST_EVIDENCE"
    />,
  );
  await act(() => finish(new Blob(["processed"], { type: "image/png" })));
  expect(signal.aborted).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Preview synthetic.png" }),
  );
  await screen.findByRole("dialog");
  view.rerender(
    <AttachmentList
      items={[{ ...metadata, id: other }]}
      repository={repo}
      requestId={other}
      parentId={other}
      context="REQUEST_EVIDENCE"
    />,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test("F046 unsupported types do not fabricate an image preview", () => {
  const repo = repository();
  render(
    <AttachmentList
      items={[
        {
          ...metadata,
          filename: "synthetic.pdf",
          mediaType: "application/pdf",
        },
      ]}
      repository={repo}
      requestId={id}
      parentId={id}
      context="REQUEST_EVIDENCE"
    />,
  );
  expect(
    screen.queryByRole("button", { name: /Preview|Enlarge/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(repo.download).not.toHaveBeenCalled();
  // The existing repository continues to reject unsupported types before rendering.
  expect(() =>
    attachmentProjection({ ...metadata, mediaType: "application/pdf" }),
  ).toThrow();
});

test("F046 display ordinals accommodate three digits without changing intake limits", () => {
  const repo = repository();
  const items = Array.from({ length: 100 }, (_, index) => ({
    ...metadata,
    id: String(index),
  }));
  render(
    <AttachmentList
      items={items}
      repository={repo}
      requestId={id}
      parentId={id}
      context="REQUEST_EVIDENCE"
    />,
  );
  expect(screen.getByText("100 attachments")).toBeInTheDocument();
  expect(screen.getByText("10.")).toHaveClass("attachment-ordinal");
  expect(screen.getByText("100.")).toHaveClass("attachment-ordinal");
  expect(repo.download).not.toHaveBeenCalled();
});
test("F046 expired staging can be discarded without mutating finalized server content", async () => {
  const repo = repository(),
    user = userEvent.setup();
  render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Choose Files" });
  select([fixture()]);
  await user.click(screen.getByRole("button", { name: "Prepare files" }));
  await screen.findByText(/MiB · Ready/);
  repo.remove.mockRejectedValueOnce({ status: 404 });
  await user.click(
    screen.getByRole("button", { name: "Remove synthetic.png" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Submit parent" })).toBeEnabled(),
  );
  expect(screen.queryByText("synthetic.png")).not.toBeInTheDocument();
});
test("F046 a late batch response cannot repopulate a navigated draft", async () => {
  const repo = repository(),
    user = userEvent.setup();
  let finish;
  repo.start.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const view = render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Choose Files" });
  select([fixture()]);
  await user.click(screen.getByRole("button", { name: "Prepare files" }));
  view.rerender(
    <Harness repo={repo} binding={{ issueId: other, versionId: id }} />,
  );
  await act(() => finish(claim));
  expect(repo.upload).not.toHaveBeenCalled();
  expect(repo.remove).toHaveBeenCalledWith(claim);
  expect(screen.queryByText("synthetic.png")).not.toBeInTheDocument();
});
test("F046 selected files wait for explicit processing, block submission and clear only after success", async () => {
  const repo = repository(),
    user = userEvent.setup();
  render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Choose Files" });
  select([fixture()]);
  expect(repo.start).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Submit parent" })).toBeDisabled();
  let complete;
  repo.upload.mockImplementationOnce(
    () => new Promise((resolve) => (complete = resolve)),
  );
  await user.click(screen.getByRole("button", { name: "Prepare files" }));
  expect(screen.getByRole("button", { name: "Submit parent" })).toBeDisabled();
  await act(() => complete(metadata));
  expect(await screen.findByText(/MiB · Ready/)).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Preview synthetic.png" }),
  );
  expect(
    await screen.findByAltText("Preview of synthetic.png"),
  ).toBeInTheDocument();
  expect(repo.preview).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Submit parent" }));
  expect(screen.queryByText("synthetic.png")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
});
test.each(["type", "size", "count", "total"])(
  "F046 immediate %s validation blocks server upload",
  async (kind) => {
    const repo = repository();
    render(<Harness repo={repo} />);
    await screen.findByRole("button", { name: "Choose Files" });
    let files = [fixture()];
    if (kind === "type") files = [fixture("bad.svg", "image/svg+xml")];
    if (kind === "size")
      Object.defineProperty(files[0], "size", { value: 5242881 });
    if (kind === "count") files = Array.from({ length: 6 }, () => fixture());
    if (kind === "total")
      files = Array.from({ length: 4 }, () => {
        const f = fixture();
        Object.defineProperty(f, "size", { value: 5242880 });
        return f;
      });
    select(files);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Prepare files" }),
    ).toBeDisabled();
    expect(repo.upload).not.toHaveBeenCalled();
  },
);
test("F046 retry uses the same staged file identity and rejected content requires removal", async () => {
  const repo = repository(),
    user = userEvent.setup();
  repo.upload.mockRejectedValueOnce(new Error("transient"));
  const view = render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Choose Files" });
  select([fixture()]);
  await user.click(screen.getByRole("button", { name: "Prepare files" }));
  await user.click(await screen.findByRole("button", { name: "Retry files" }));
  await screen.findByText(/MiB · Ready/);
  expect(repo.start).toHaveBeenCalledTimes(1);
  expect(repo.upload.mock.calls[0][1]).toBe(repo.upload.mock.calls[1][1]);
  view.unmount();
  expect(repo.remove).toHaveBeenCalledWith(claim);
});
test("F046 server rejection is never ready and Remove permits recovery", async () => {
  const repo = repository(),
    user = userEvent.setup();
  repo.upload.mockRejectedValue({ status: 400 });
  render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Choose Files" });
  select([fixture()]);
  await user.click(screen.getByRole("button", { name: "Prepare files" }));
  await screen.findByText(/File could not be processed/);
  expect(screen.getByRole("button", { name: "Submit parent" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Remove synthetic.png" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Submit parent" })).toBeEnabled(),
  );
});
test("F046 camera is user-initiated capture input, selection never uses persistent browser storage", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem"),
    repo = repository();
  const { container } = render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Take Photo" });
  const input = container.querySelector("input[capture]");
  expect(input).toHaveAttribute("capture", "environment");
  expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  select([fixture("../<script>😀.png")]);
  expect(storage).not.toHaveBeenCalled();
  expect(container.querySelector("script")).toBeNull();
});
test("F046 preview denial clears prior bytes, retains filename and notifies parent access handling", async () => {
  const repo = repository(),
    denied = vi.fn(),
    user = userEvent.setup();
  render(
    <AttachmentList
      items={[metadata]}
      repository={repo}
      requestId={id}
      parentId={other}
      context="INTERNAL_NOTE"
      onAccessFailure={denied}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Preview synthetic.png" }),
  );
  await screen.findByAltText("Preview of synthetic.png");
  repo.download.mockRejectedValue({ status: 403 });
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Download synthetic.png",
    }),
  );
  await waitFor(() => expect(denied).toHaveBeenCalled());
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("synthetic.png")).toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
test("F046 tab switches preserve separate Note and Communication files; successful create clears one draft", async () => {
  const repo = {
      attachments: repository(),
      notes: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      communications: vi
        .fn()
        .mockResolvedValue({ items: [], nextCursor: null }),
      createNote: vi.fn().mockResolvedValue({
        id,
        body: "Fictional note",
        author: { displayName: "Staff" },
        createdAt: "2026-09-23T12:00:00Z",
        attachments: [metadata],
      }),
    },
    user = userEvent.setup();
  render(
    <CollaborationPanel
      repository={repo}
      id={id}
      audience="public"
      capabilities={{
        canReadNotes: true,
        canCreateNotes: true,
        canReadCommunications: true,
        canCreateCommunication: true,
      }}
    />,
  );
  await screen.findByRole("button", { name: "Add files" });
  select([fixture("note.png")]);
  await user.type(screen.getByLabelText("Internal Note"), "Fictional note");
  await user.click(
    screen.getByRole("tab", { name: "Requester Communication" }),
  );
  await screen.findByRole("button", { name: "Add files" });
  expect(screen.queryByText("note.png")).not.toBeVisible();
  const panel = screen.getByRole("tabpanel");
  fireEvent.change(within(panel).getByLabelText("Choose attachment files"), {
    target: { files: [fixture("message.png")] },
  });
  expect(
    within(panel).getByText(
      /Attachments added here are intended for the requester/,
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Internal Notes" }));
  const notes = screen.getByRole("tabpanel");
  expect(within(notes).getByText("note.png")).toBeInTheDocument();
  await user.click(
    within(notes).getByRole("button", { name: "Prepare files" }),
  );
  await within(notes).findByText(/MiB · Ready/);
  await user.click(within(notes).getByRole("button", { name: "Add Note" }));
  await within(notes).findByText("Fictional note");
  expect(
    within(notes).queryByRole("button", { name: "Remove note.png" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("tab", { name: "Requester Communication" }),
  );
  expect(
    within(screen.getByRole("tabpanel")).getByText("message.png"),
  ).toBeInTheDocument();
});
test("F046 metadata projection excludes storage internals and transport uses header capability, multipart and no cookies", async () => {
  expect(
    attachmentProjection({
      ...metadata,
      storageKey: "hidden",
      checksum: "hidden",
    }),
  ).toEqual(metadata);
  expect(() =>
    attachmentProjection({ ...metadata, state: "PENDING_SCAN" }),
  ).toThrow();
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => metadata,
  });
  const api = createApiClient({
      baseUrl: "http://localhost:3000/api/v1",
      fetchImplementation: fetcher,
      getAccessToken: async () => "synthetic-staff-token",
    }),
    repo = createAttachmentRepository(api, true);
  await repo.upload(claim, id, fixture());
  const [url, options] = fetcher.mock.calls[0];
  expect(url).not.toContain(claim.token);
  expect(options.body).toBeInstanceOf(FormData);
  expect(options.headers["X-Reqro-Attachment"]).toBe(claim.token);
  expect(options.headers["Content-Type"]).toBeUndefined();
  expect(options.credentials).toBe("omit");
});

for (const status of [403, 404]) {
  test(`F046 staged preview ${status} clears prior bytes and invalidates the claim`, async () => {
    const repo = repository(),
      denied = vi.fn(),
      user = userEvent.setup();
    render(<Harness repo={repo} onAccessFailure={denied} />);
    await screen.findByRole("button", { name: "Choose Files" });
    select([fixture()]);
    await user.click(screen.getByRole("button", { name: "Prepare files" }));
    await screen.findByText(/MiB · Ready/);
    await user.click(
      screen.getByRole("button", { name: "Preview synthetic.png" }),
    );
    await screen.findByAltText("Preview of synthetic.png");
    repo.preview.mockRejectedValue({ status });
    await user.click(
      screen.getByRole("button", { name: "Preview synthetic.png" }),
    );
    await waitFor(() => expect(denied).toHaveBeenCalledWith({ status }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
    if (status === 403)
      expect(screen.queryByText("synthetic.png")).not.toBeInTheDocument();
    else {
      expect(
        screen.getByRole("button", { name: "Submit parent" }),
      ).toBeDisabled();
      repo.preview.mockResolvedValue(
        new Blob(["processed"], { type: "image/png" }),
      );
      await user.click(screen.getByRole("button", { name: "Prepare files" }));
      await screen.findByText(/MiB · Ready/);
      expect(repo.start).toHaveBeenCalledTimes(2);
    }
  });
}

for (const context of [
  "REQUEST_EVIDENCE",
  "INTERNAL_NOTE",
  "REQUESTER_COMMUNICATION",
]) {
  test(`F046 ${context} keeps each preview beside its own metadata and keyboard actions`, async () => {
    const repo = repository(),
      user = userEvent.setup();
    const longName =
      "fictional-very-long-unbroken-filename-for-wrapping-and-attachment-association.png";
    render(
      <AttachmentList
        items={[metadata, { ...metadata, id: other, filename: longName }]}
        repository={repo}
        requestId={id}
        parentId={id}
        context={context}
      />,
    );
    for (const name of ["synthetic.png", longName]) {
      await user.click(screen.getByRole("button", { name: "Preview " + name }));
      const dialog = await screen.findByRole("dialog", {
        name: "Image Preview",
      });
      expect(within(dialog).getByText(name)).toBeInTheDocument();
      expect(
        within(dialog).getByAltText("Enlarged preview of " + name),
      ).toBeInTheDocument();
      await user.click(
        within(dialog).getByRole("button", { name: "Close", exact: true }),
      );
      const image = screen.getByAltText("Preview of " + name);
      const presentation = image.parentElement.parentElement;
      expect(presentation).toHaveClass("attachment-preview");
      expect(presentation.firstElementChild).toBe(image.parentElement);
      expect(image.parentElement).toHaveAccessibleName("Enlarge " + name);
      const body = presentation.querySelector(".attachment-body");
      expect(within(body).getByText(name)).toBeInTheDocument();
      expect(
        within(body).getByRole("button", { name: "Download " + name }),
      ).toBeInTheDocument();
      expect(presentation.closest("li").querySelectorAll("img")).toHaveLength(
        1,
      );
      await user.tab();
      expect(
        within(body).getByRole("button", { name: "Download " + name }),
      ).toHaveFocus();
    }
    expect(repo.download.mock.calls.map((call) => call[1])).toEqual([
      context,
      context,
    ]);
  });
}
test("F046 a prepared draft groups its preview and filename with keyboard-reachable Remove", async () => {
  const repo = repository(),
    user = userEvent.setup();
  render(<Harness repo={repo} />);
  await screen.findByRole("button", { name: "Choose Files" });
  select([fixture()]);
  await user.click(screen.getByRole("button", { name: "Prepare files" }));
  await screen.findByText(/MiB · Ready/);
  await user.click(
    screen.getByRole("button", { name: "Preview synthetic.png" }),
  );
  const image = await screen.findByAltText("Preview of synthetic.png");
  const body = image.parentElement.querySelector(".attachment-body");
  expect(within(body).getByText("synthetic.png")).toBeInTheDocument();
  await user.tab();
  expect(
    within(body).getByRole("button", { name: "Remove synthetic.png" }),
  ).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(screen.queryByRole("img")).not.toBeInTheDocument(),
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
});
