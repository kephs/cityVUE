import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import InternalRequestWorkspace from "../src/staff/requests/InternalRequestWorkspace.jsx";

const result = (label = "Result", total = 1) => ({
  items: total
    ? [
        {
          serviceRequestId: "fictional-id",
          referenceNumber: "SR-000001",
          issueName: label,
          audience: "public",
          departmentName: "Facilities",
          status: "open",
          createdAt: "2026-09-01T12:00:00Z",
        },
      ]
    : [],
  total,
  page: 1,
  pageSize: 25,
  hasNextPage: total > 25,
  hasPreviousPage: false,
});
let repository;
function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      <output aria-label="Query state">{location.search}</output>
    </>
  );
}
function show(query = "") {
  return render(
    <MemoryRouter initialEntries={["/staff/requests" + query]}>
      <Navigation />
      <InternalRequestWorkspace repository={repository} />
    </MemoryRouter>,
  );
}
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
const input = () => screen.getByRole("searchbox", { name: "Search requests" });
beforeEach(() => {
  vi.useFakeTimers();
  repository = {
    list: vi.fn().mockResolvedValue(result()),
    options: vi.fn().mockResolvedValue({
      departments: [{ id: "dept", name: "Facilities" }],
      divisions: [],
    }),
  };
});
afterEach(() => vi.useRealTimers());

test("results hierarchy follows filters, consolidated controls, summary and rows in DOM and keyboard order", async () => {
  show("?q=alpha");
  await flush();
  const filters = screen.getByRole("form", { name: "Request filters" });
  const toolbar = screen.getByRole("group", { name: "Request list controls" });
  const search = input().closest(".request-live-search");
  const summary = screen.getByText("1 requests · Page 1");
  const results = screen.getByRole("table");
  const ordered = [filters, toolbar, summary, results];
  for (let i = 1; i < ordered.length; i++)
    expect(
      ordered[i - 1].compareDocumentPosition(ordered[i]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  expect(toolbar).toHaveClass("request-list-controls");
  expect(
    search.querySelector(".request-live-search-controls"),
  ).toContainElement(input());
  expect(input()).toHaveAttribute(
    "aria-describedby",
    "request-live-search-help",
  );
  expect(
    screen.getByText(
      "Searches reference, Issue and displayed Service Location. Other filters still apply.",
    ),
  ).toBeInTheDocument();
  expect(search).toContainElement(
    screen.getByRole("button", { name: "Clear search" }),
  );
  expect(search.closest("form")).toBeNull();
  const keyboard = [
    screen.getByRole("button", { name: "Reset", exact: true }),
    input(),
    screen.getByRole("button", { name: "Clear search" }),
    screen.getByLabelText("Sort by"),
    screen.getByLabelText("Direction"),
    screen.getByRole("button", { name: "Refresh", exact: true }),
  ];
  for (let i = 1; i < keyboard.length; i++)
    expect(
      keyboard[i - 1].compareDocumentPosition(keyboard[i]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  for (const control of keyboard) expect(control.tabIndex).toBe(0);
  for (const control of keyboard.slice(1))
    expect(toolbar).toContainElement(control);
  expect(summary).toHaveAttribute("role", "status");
  expect(toolbar).not.toContainElement(summary);
  expect(input()).toHaveAttribute(
    "placeholder",
    "Search reference, issue, or service location",
  );
  expect(toolbar.querySelectorAll("input, select, button")).toHaveLength(5);
  expect(
    screen.getAllByRole("group", { name: "Request list controls" }),
  ).toHaveLength(1);
});

test.each([
  ["Sort by", "issue", { sort: "issue" }],
  ["Audience", "internal", { audience: "internal" }],
])(
  "%s changes cancel a pending searched response",
  async (label, value, expected) => {
    show("?q=alpha");
    await flush();
    let reject;
    repository.list.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    fireEvent.click(screen.getByText("Refresh"));
    await flush();
    const signal = repository.list.mock.lastCall[1];
    repository.list.mockResolvedValueOnce(result("New controls"));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await flush();
    expect(signal.aborted).toBe(true);
    expect(repository.list.mock.lastCall[0]).toMatchObject({
      q: "alpha",
      page: 1,
      ...expected,
    });
    await act(async () => {
      reject({ status: 500 });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("New controls")).toBeInTheDocument();
  },
);

test("pagination carries search immediately and a subsequent search cancels its late page", async () => {
  repository.list.mockResolvedValueOnce(result("Page one", 30));
  show("?q=alpha");
  await flush();
  let resolve;
  repository.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByText("Next"));
  await flush();
  expect(repository.list.mock.lastCall[0]).toMatchObject({
    q: "alpha",
    page: 2,
  });
  const signal = repository.list.mock.lastCall[1];
  fireEvent.change(input(), { target: { value: "beta" } });
  await settle();
  expect(repository.list.mock.lastCall[0]).toMatchObject({
    q: "beta",
    page: 1,
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve({ ...result("Old page"), page: 2 });
  });
  expect(screen.queryByText("Old page")).toBeNull();
  expect(screen.getByLabelText("Row position 1")).toBeInTheDocument();
});

test("debounces rapid input, trims edges, resets page and preserves every applied control", async () => {
  show(
    "?page=3&audience=public&view=mine&assignment=unassigned&status=open&departmentId=dept&sort=issue&direction=asc&search=SR-000001",
  );
  await flush();
  for (const value of ["t", "tr", " tree  debris "])
    fireEvent.change(input(), { target: { value } });
  expect(repository.list).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Result")).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(repository.list).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(repository.list).toHaveBeenLastCalledWith(
    expect.objectContaining({
      q: "tree  debris",
      page: 1,
      audience: "public",
      view: "mine",
      assignment: "unassigned",
      status: "open",
      departmentId: "dept",
      sort: "issue",
      direction: "asc",
      search: "SR-000001",
    }),
    expect.any(AbortSignal),
  );
});

test("short input does not search or show stale rows; whitespace means no constraint; Enter is harmless", async () => {
  show();
  await flush();
  fireEvent.change(input(), { target: { value: "x" } });
  await settle();
  expect(repository.list).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText("Enter at least 2 characters to search."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Result")).toBeNull();
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(repository.list).toHaveBeenCalledTimes(1);
  fireEvent.change(input(), { target: { value: "   " } });
  await flush();
  expect(repository.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ q: "" }),
    expect.any(AbortSignal),
  );
  expect(input()).toHaveAttribute("maxlength", "160");
});

test.each(["Clear search", "Reset"])(
  "%s cancels pending debounce and late responses",
  async (button) => {
    show("?q=alpha&sort=issue&direction=asc");
    await flush();
    let resolve;
    repository.list.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.change(input(), { target: { value: "beta" } });
    await settle();
    const signal = repository.list.mock.lastCall[1];
    fireEvent.change(input(), { target: { value: "gamma" } });
    fireEvent.click(screen.getByRole("button", { name: button }));
    await flush();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(result("Obsolete beta"));
    });
    await settle();
    expect(screen.queryByText("Obsolete beta")).toBeNull();
    expect(input()).toHaveValue("");
    expect(repository.list.mock.lastCall[0]).toMatchObject({
      q: "",
      page: 1,
      sort: button === "Reset" ? "created" : "issue",
    });
    expect(
      repository.list.mock.calls.some(([filter]) => filter.q === "gamma"),
    ).toBe(false);
    if (button === "Clear search") expect(input()).toHaveFocus();
  },
);

test("out-of-order results and errors cannot replace newer search; controls remain mounted", async () => {
  show();
  await flush();
  let oldResolve;
  repository.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        oldResolve = done;
      }),
  );
  fireEvent.change(input(), { target: { value: "alpha" } });
  await settle();
  const searchNode = input();
  repository.list.mockResolvedValueOnce(result("Current beta"));
  fireEvent.change(input(), { target: { value: "beta" } });
  await settle();
  await act(async () => {
    oldResolve(result("Obsolete alpha"));
  });
  expect(screen.getByText("Current beta")).toBeInTheDocument();
  expect(screen.queryByText("Obsolete alpha")).toBeNull();
  expect(input()).toBe(searchNode);
  expect(
    screen.getByRole("option", { name: "Facilities" }),
  ).toBeInTheDocument();
});

test("sort, filter and Refresh use current search immediately; browser back/forward restores it", async () => {
  show();
  await flush();
  fireEvent.change(input(), { target: { value: "alpha" } });
  await settle();
  fireEvent.change(input(), { target: { value: "beta" } });
  await settle();
  fireEvent.click(screen.getByText("Back"));
  await flush();
  expect(input()).toHaveValue("alpha");
  fireEvent.click(screen.getByText("Forward"));
  await flush();
  expect(input()).toHaveValue("beta");
  fireEvent.change(screen.getByLabelText("Sort by"), {
    target: { value: "issue" },
  });
  await flush();
  expect(repository.list.mock.lastCall[0]).toMatchObject({
    q: "beta",
    sort: "issue",
    page: 1,
  });
  fireEvent.change(screen.getByLabelText("Status"), {
    target: { value: "open" },
  });
  fireEvent.click(screen.getByText("Apply filters"));
  await flush();
  expect(repository.list.mock.lastCall[0]).toMatchObject({
    q: "beta",
    status: "open",
  });
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(repository.list.mock.lastCall[0]).toMatchObject({
    q: "beta",
    status: "open",
    sort: "issue",
  });
});

test("empty matches and failed requests have distinct accessible states; retry preserves search", async () => {
  repository.list.mockResolvedValueOnce(result("", 0));
  show("?q=missing");
  await flush();
  expect(
    screen.getByText("No requests match your current filters."),
  ).toBeInTheDocument();
  repository.list.mockRejectedValueOnce({ status: 500 });
  fireEvent.click(screen.getByText("Refresh"));
  await flush();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(
    screen.queryByText("No requests match your current filters."),
  ).toBeNull();
  fireEvent.click(screen.getByText("Try again"));
  await flush();
  expect(repository.list.mock.lastCall[0]).toMatchObject({ q: "missing" });
  expect(screen.getByText("1 requests · Page 1")).toHaveAttribute(
    "role",
    "status",
  );
});
