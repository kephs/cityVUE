import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import ReportIssuePage from "../src/pages/report/ReportIssuePage.jsx";
import SubmissionTracking from "../src/pages/report/SubmissionTracking.jsx";
import { CityVueApiError } from "../src/api/apiClient.js";

/**
 * F066 — the resident client's idempotency-key lifecycle.
 *
 * The server guarantees at most one request per key. That guarantee is only
 * useful if the client sends the *same* key when it retries the *same*
 * submission, and a *different* key when the submission is genuinely
 * different. Both halves are asserted here against the real page, by reading
 * the key out of the repository call rather than from the component's
 * internals.
 */

const category = {
  id: "category",
  name: "Roads",
  description: "Road concerns",
  icon: "bi-signpost",
  accent: "blue",
  status: "active",
};
const service = {
  id: "service",
  categoryId: "category",
  serviceDefinitionVersionId: "version",
  name: "Pothole",
  citizenDescription: "Road damage",
  status: "active",
  locationRequirement: "required",
  anonymousPolicy: "allowed",
  questions: [],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiRepositories(createServiceRequest) {
  return {
    mode: "api",
    detailsEnabled: false,
    catalog: {
      notice: "Local API mode",
      loadCategories: vi.fn(async () => [category]),
      loadIssues: vi.fn(async () => [service]),
      loadDefinition: vi.fn(async () => service),
    },
    requests: { createServiceRequest },
  };
}

async function completeRequest(user, description = "Resident-only description") {
  await user.click(await screen.findByRole("radio", { name: /Roads/ }));
  await user.click(await screen.findByRole("radio", { name: /Pothole/ }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(
    await screen.findByLabelText("Tell us more about the concern *"),
    description,
  );
  await user.type(
    screen.getByLabelText("Service Location (required)"),
    "100 Main Street",
  );
  await user.click(screen.getByRole("radio", { name: "Report anonymously" }));
  await user.click(screen.getByRole("button", { name: "Review request" }));
}

/** The key as the repository actually received it. */
const keyOf = (create, call = 0) =>
  create.mock.calls[call]?.[1]?.idempotencyKey;

test("F066 a submission carries a high-entropy idempotency key", async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    referenceNumber: "SR-202610-000001",
    status: "open",
  });
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(create).toHaveBeenCalledTimes(1);
  // A version 4 UUID: 122 random bits, which is what makes the reservation
  // space unguessable.
  expect(keyOf(create)).toMatch(UUID);
});

test("F066 retrying the same submission reuses its key so the server can deduplicate", async () => {
  const user = userEvent.setup();
  // The lost-response shape: the request may well have been committed, so the
  // retry must be able to resolve to it rather than create another.
  const create = vi
    .fn()
    .mockRejectedValueOnce(
      new CityVueApiError("timeout", "The request took too long. Please try again."),
    )
    .mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      referenceNumber: "SR-202610-000001",
      status: "open",
    });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(create).toHaveBeenCalledTimes(2);
  expect(keyOf(create, 1)).toMatch(UUID);
  expect(keyOf(create, 1)).toBe(keyOf(create, 0));
});

test("F066 an edited submission is sent under a new key, never the previous one", async () => {
  const user = userEvent.setup();
  const create = vi
    .fn()
    .mockRejectedValueOnce(
      new CityVueApiError("timeout", "The request took too long. Please try again."),
    )
    .mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      referenceNumber: "SR-202610-000001",
      status: "open",
    });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
  // Go back and change the submission materially, then submit again. Reusing
  // the key here would make the server refuse a legitimate new submission.
  await user.click(screen.getByRole("button", { name: /Back/ }));
  const description = await screen.findByLabelText(
    "Tell us more about the concern *",
  );
  await user.clear(description);
  await user.type(description, "A materially different narrative");
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(create).toHaveBeenCalledTimes(2);
  expect(keyOf(create, 1)).toMatch(UUID);
  expect(keyOf(create, 1)).not.toBe(keyOf(create, 0));
});

test("F066 a reused-key refusal makes the next attempt mint a new key", async () => {
  const user = userEvent.setup();
  const create = vi
    .fn()
    .mockRejectedValueOnce(
      new CityVueApiError(
        "SUBMISSION_KEY_REUSED",
        "Your request details changed after it was first sent. Submit again to send this as a new request.",
        { status: 409 },
      ),
    )
    .mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      referenceNumber: "SR-202610-000001",
      status: "open",
    });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Submit again to send this as a new request",
  );
  // The review state survives, so the resident does not retype anything.
  expect(screen.getByText("Resident-only description")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  // Retrying under the old key would be refused forever; a fresh key is the
  // only recovery.
  expect(keyOf(create, 1)).not.toBe(keyOf(create, 0));
});

test("F066 an in-progress refusal keeps the key, because retrying with it is the resolution", async () => {
  const user = userEvent.setup();
  const create = vi
    .fn()
    .mockRejectedValueOnce(
      new CityVueApiError(
        "SUBMISSION_IN_PROGRESS",
        "This request is still being processed. Wait a moment and submit again - it will not be duplicated.",
        { status: 409 },
      ),
    )
    .mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      referenceNumber: "SR-202610-000001",
      status: "open",
      replay: { tracking: "not_issued" },
    });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "will not be duplicated",
  );
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  // The same key is what lets the second attempt resolve to the request the
  // first one may already have created.
  expect(keyOf(create, 1)).toBe(keyOf(create, 0));
});

test("F066 the key is never written to browser storage or the URL", async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    referenceNumber: "SR-202610-000001",
    status: "open",
  });
  localStorage.clear();
  sessionStorage.clear();
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  const key = keyOf(create);
  expect(key).toMatch(UUID);
  // A reload discards the in-progress form too, so a stored key could not be
  // paired with its submission and would only widen exposure.
  for (const store of [localStorage, sessionStorage]) {
    const dump = Object.keys(store)
      .map((name) => `${name}=${String(store.getItem(name))}`)
      .join("|");
    expect(dump).not.toContain(key);
  }
  expect(window.location.href).not.toContain(key);
  expect(document.title).not.toContain(key);
});

test("F066 a replayed submission says the tracking link cannot be recovered", () => {
  // The honest answer to the lost-response problem: only the credential's
  // digest was stored, so no replay can return the link. The one recovery
  // path that does exist is named.
  render(<SubmissionTracking replay={{ tracking: "issued_unrecoverable" }} />);
  expect(
    screen.getByText(/cannot be shown again/i),
  ).toBeInTheDocument();
  expect(screen.getByText(/contact the service team/i)).toBeInTheDocument();
  // And it must not imply a link is available.
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("F066 a replay that never had a link keeps the ordinary no-link message", () => {
  render(<SubmissionTracking replay={{ tracking: "not_issued" }} />);
  expect(
    screen.getByText(/tracking link is not available for this submission/i),
  ).toBeInTheDocument();
  expect(screen.queryByText(/cannot be shown again/i)).not.toBeInTheDocument();
});

test("F066 a replayed confirmation does not claim a fresh submission", async () => {
  const user = userEvent.setup();
  const create = vi.fn().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    referenceNumber: "SR-202610-000001",
    status: "open",
    replay: { tracking: "issued_unrecoverable" },
  });
  render(
    <MemoryRouter>
      <ReportIssuePage repositories={apiRepositories(create)} />
    </MemoryRouter>,
  );
  await completeRequest(user);
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(
    await screen.findByText("This request was already submitted."),
  ).toBeInTheDocument();
  // The reference is still shown, because it is the thing the resident needs.
  expect(screen.getByText("SR-202610-000001")).toBeInTheDocument();
  expect(screen.getByText(/cannot be shown again/i)).toBeInTheDocument();
});
