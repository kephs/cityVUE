import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import AppLayout from "../src/components/layout/AppLayout.jsx";
import HomePage from "../src/pages/HomePage.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import { useAuth } from "../src/auth/AuthContext.jsx";
import { loadActiveAlerts } from "../src/alerts/alertsRepository.js";
import { loadResidentExperience } from "../src/pages/home/residentExperienceRepository.js";
import { readResidentIntakeConfig } from "../src/config/runtimeConfig.js";
import { adaptResidentExperience } from "../src/pages/home/residentExperienceAdapter.js";
import { safeHomePresentation } from "../src/pages/home/safeHomePresentation.js";
import { publishedExperienceFixture } from "./fixtures/residentExperience.js";
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn() }));
vi.mock("../src/alerts/alertsRepository.js", () => ({
  loadActiveAlerts: vi.fn(),
}));
vi.mock("../src/pages/home/residentExperienceRepository.js", () => ({
  loadResidentExperience: vi.fn(),
}));
vi.mock("../src/config/runtimeConfig.js", () => ({
  readResidentIntakeConfig: vi.fn(),
}));
beforeEach(() => {
  useAuth.mockReturnValue({ enabled: false, isAuthenticated: false });
  readResidentIntakeConfig.mockReturnValue({
    dataSource: "api",
    apiBaseUrl: "https://example.org/api/v1",
  });
  loadActiveAlerts.mockResolvedValue([]);
  loadResidentExperience.mockResolvedValue(safeHomePresentation);
});
afterEach(() => vi.resetAllMocks());
function app() {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <AppLayout>
          <HomePage />
        </AppLayout>
      </ThemeProvider>
    </MemoryRouter>
  );
}
function noPhones() {
  expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  expect(document.body.textContent).not.toMatch(
    /911|240-314-8567|Police or Fire Emergency|Water\/Sewer Emergency/,
  );
}
test("initial/delayed render never flashes contacts; one complete published presentation replaces fallback", async () => {
  let resolve;
  loadResidentExperience.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { container } = render(app());
  noPhones();
  expect(document.title).toBe(safeHomePresentation.title);
  const dto = publishedExperienceFixture();
  dto.configuration.presentation.branding.applicationName =
    "Published Community";
  dto.configuration.presentation.metadata.title = "Published title";
  dto.configuration.presentation.footer.tagline = "Published footer";
  await act(async () => resolve(adaptResidentExperience(dto)));
  expect(screen.getAllByAltText("Published Community")).toHaveLength(2);
  expect(screen.getByText("Published footer")).toBeInTheDocument();
  expect(document.title).toBe("Published title");
  expect(container.querySelectorAll(".reqro-action-card")).toHaveLength(3);
  expect(loadResidentExperience).toHaveBeenCalledTimes(1);
  expect(loadActiveAlerts).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".resident-alert-banner")).toBeNull();
});
test("API failure retains usable generic content without contacts", async () => {
  loadResidentExperience.mockRejectedValue(new Error("unavailable"));
  render(app());
  await act(async () => {});
  noPhones();
  expect(screen.getByRole("link", { name: "Report Issue" })).toHaveAttribute(
    "href",
    "/report",
  );
});

test("Reqro publication restores all three frozen actions and exact phone labels after safe initial content", async () => {
  let resolve;
  loadResidentExperience.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { container } = render(app());
  noPhones();
  expect(container.querySelectorAll(".reqro-action-card")).toHaveLength(1);
  await act(async () =>
    resolve(adaptResidentExperience(publishedExperienceFixture())),
  );
  expect(container.querySelectorAll(".reqro-action-card")).toHaveLength(3);
  for (const title of [
    "Report a Concern",
    "Police or Fire Emergency",
    "Water/Sewer Emergency",
  ])
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Call 911" })).toHaveAttribute(
    "href",
    "tel:911",
  );
  expect(
    screen.getByRole("link", { name: "240-314-8567", exact: true }),
  ).toHaveAttribute("href", "tel:2403148567");
  expect(screen.queryByText("Call 240-314-8567")).toBeNull();
});

test("no publication retains only the safe generic action", async () => {
  loadResidentExperience.mockResolvedValue(
    adaptResidentExperience({ schemaVersion: 1, configuration: null }),
  );
  const { container } = render(app());
  await act(async () => {});
  noPhones();
  expect(container.querySelectorAll(".reqro-action-card")).toHaveLength(1);
});
test.each([0, 1, 2, 3, 4, 5, 6])(
  "published %i enabled actions use the existing layout without default restoration",
  async (count) => {
    const dto = publishedExperienceFixture();
    dto.configuration.actions = Array.from({ length: count }, (_, i) => ({
      ...dto.configuration.actions[0],
      id: `action-${i}`,
      order: i,
    }));
    loadResidentExperience.mockResolvedValue(adaptResidentExperience(dto));
    const { container } = render(app());
    await act(async () => {});
    expect(container.querySelectorAll(".reqro-action-card")).toHaveLength(
      count,
    );
    noPhones();
  },
);
test("auth and trusted-source changes clear prior content and ignore older responses", async () => {
  let oldResolve, newResolve;
  loadResidentExperience
    .mockReturnValueOnce(
      new Promise((done) => {
        oldResolve = done;
      }),
    )
    .mockReturnValueOnce(
      new Promise((done) => {
        newResolve = done;
      }),
    );
  const view = render(app());
  const oldSignal = loadResidentExperience.mock.calls[0][0].signal;
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    account: { homeAccountId: "new-account", tenantId: "new-context" },
  });
  view.rerender(app());
  noPhones();
  expect(oldSignal.aborted).toBe(true);
  await act(async () => newResolve(safeHomePresentation));
  await act(async () =>
    oldResolve(adaptResidentExperience(publishedExperienceFixture())),
  );
  noPhones();
  loadResidentExperience.mockReturnValue(new Promise(() => {}));
  readResidentIntakeConfig.mockReturnValue({
    dataSource: "api",
    apiBaseUrl: "https://different.example/api/v1",
  });
  view.rerender(app());
  noPhones();
});
test("logout clears a previously loaded publication before the new request completes", async () => {
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    account: { homeAccountId: "staff" },
  });
  loadResidentExperience.mockResolvedValueOnce(
    adaptResidentExperience(publishedExperienceFixture()),
  );
  const view = render(app());
  await act(async () => {});
  expect(document.querySelector('a[href="tel:911"]')).not.toBeNull();
  loadResidentExperience.mockReturnValue(new Promise(() => {}));
  useAuth.mockReturnValue({ enabled: true, isAuthenticated: false });
  view.rerender(app());
  noPhones();
});
test("unmount cancels pending configuration reads", async () => {
  let resolve;
  loadResidentExperience.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(app());
  const signal = loadResidentExperience.mock.calls[0][0].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve(adaptResidentExperience(publishedExperienceFixture())),
  );
  expect(document.querySelector(".reqro-home")).toBeNull();
});
