import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { expect, test, vi } from "vitest";
import InternalRequestWorkspace from "../src/staff/requests/InternalRequestWorkspace.jsx";
import SubmittedInformation from "../src/staff/requests/SubmittedInformation.jsx";
import { categoryAccent } from "../src/components/ui/categoryAccent.js";
import { normalizeApiCategories } from "../src/catalog/catalogRepositories.js";

const row = {
  serviceRequestId: "fictional",
  issueName: "Benefits Question",
  categoryId: "synthetic-category",
  audience: "internal",
  referenceNumber: "DEV-000021",
  status: "open",
  departmentName: "Human Resources",
  createdAt: "2026-09-01T12:00:00Z",
};
const page = (query, total = 327) => ({
  items: [row],
  page: query.page,
  pageSize: query.pageSize,
  total,
  hasNextPage: query.page * query.pageSize < total,
  hasPreviousPage: query.page > 1,
});
function Navigation() {
  const go = useNavigate();
  return (
    <>
      <output aria-label="URL">{useLocation().search}</output>
      <button onClick={() => go(-1)}>History back</button>
      <button onClick={() => go(1)}>History forward</button>
    </>
  );
}
function show(list, initial = "?page=3&pageSize=25&sort=issue&direction=asc") {
  const repository = {
    list,
    options: vi.fn().mockResolvedValue({ departments: [], divisions: [] }),
    detail: vi.fn(),
    readAnswers: vi.fn(),
  };
  render(
    <MemoryRouter initialEntries={["/staff/requests" + initial]}>
      <Navigation />
      <InternalRequestWorkspace repository={repository} />
    </MemoryRouter>,
  );
  return repository;
}
test("F056.3 approved sizes use server query, reset page and restore URL through history", async () => {
  const list = vi.fn(async (query) => page(query));
  show(list);
  let selector = await screen.findByLabelText("Rows per page");
  expect(
    within(selector)
      .getAllByRole("option")
      .map((x) => x.value),
  ).toEqual(["25", "50", "100"]);
  expect(screen.getByText("51–75 of 327 requests")).toBeInTheDocument();
  fireEvent.change(selector, { target: { value: "50" } });
  await screen.findByText("1–50 of 327 requests");
  expect(list.mock.lastCall[0]).toMatchObject({
    page: 1,
    pageSize: 50,
    sort: "issue",
    direction: "asc",
  });
  expect(screen.getByLabelText("URL")).toHaveTextContent("pageSize=50");
  fireEvent.click(screen.getByText("History back"));
  await screen.findByText("51–75 of 327 requests");
  fireEvent.click(screen.getByText("History forward"));
  await screen.findByText("1–50 of 327 requests");
  fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }));
  await waitFor(() => expect(list.mock.lastCall[0].pageSize).toBe(50));
});
test("F056.3 dedicated Request Type and absent location keep the Issue cell uncluttered", async () => {
  const repository = show(
    vi.fn(async (q) => page(q)),
    "?pageSize=100",
  );
  const link = await screen.findByRole("link", { name: row.issueName });
  const cell = link.closest("th");
  expect(
    screen.getByRole("columnheader", { name: "Request Type" }),
  ).toBeInTheDocument();
  expect(within(cell).queryByText("Internal")).toBeNull();
  expect(cell.querySelector(".ui-location")).toBeNull();
  expect(screen.getByRole("cell", { name: "Internal" })).toBeInTheDocument();
  expect(repository.detail).not.toHaveBeenCalled();
  expect(repository.readAnswers).not.toHaveBeenCalled();
});
test("F056.3 unsupported URL size falls back to 25 and empty later pages recover", async () => {
  const list = vi.fn(async (q) =>
    q.page > 1 ? { ...page(q, 0), items: [] } : { ...page(q, 0), items: [] },
  );
  show(list, "?page=99&pageSize=500");
  await screen.findByText("Page 1 of 1");
  expect(list.mock.calls[0][0]).toMatchObject({ page: 99, pageSize: 25 });
  expect(list.mock.lastCall[0]).toMatchObject({ page: 1, pageSize: 25 });
  expect(screen.getByText("0–0 of 0 requests")).toBeInTheDocument();
});
test("F056.3 late page-size response cannot replace a newer response", async () => {
  let stale;
  const list = vi.fn((q) =>
    q.pageSize === 50
      ? new Promise((resolve) => {
          stale = () => resolve(page(q));
        })
      : Promise.resolve(page(q)),
  );
  show(list, "");
  fireEvent.change(await screen.findByLabelText("Rows per page"), {
    target: { value: "50" },
  });
  // Browser history can navigate while the old request is outstanding.
  fireEvent.click(screen.getByText("History back"));
  await screen.findByText("1–25 of 327 requests");
  await act(async () => stale());
  expect(screen.getByText("1–25 of 327 requests")).toBeInTheDocument();
  expect(screen.queryByText("1–50 of 327 requests")).toBeNull();
});
test("F056.3 protected card does not prefetch, wraps historical content and safely reports denial", async () => {
  const repository = {
    readAnswers: vi.fn().mockResolvedValue({
      answers: [
        {
          questionId: "q",
          label: "Historical prompt",
          displayValue: "Long answer ".repeat(100),
        },
      ],
    }),
  };
  render(<SubmittedInformation id="one" repository={repository} canRead />);
  expect(
    screen.getByRole("region", { name: "Submitted Information" }),
  ).toHaveClass("ui-card");
  expect(repository.readAnswers).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "View Submitted Information" }),
  );
  await screen.findByText("Historical prompt");
  repository.readAnswers.mockRejectedValue({ status: 403 });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh submitted information" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Historical prompt")).toBeNull();
});
test("F056.3 category accents are stable across catalog order and shared by identity", () => {
  const a = { id: "a", name: "A" },
    b = { id: "b", name: "B" };
  expect(normalizeApiCategories([a, b])[0].accent).toBe(
    normalizeApiCategories([b, a])[1].accent,
  );
  expect(normalizeApiCategories([a])[0].accent).toBe(categoryAccent(a.id));
  expect(categoryAccent("roads")).toBe("blue");
});
