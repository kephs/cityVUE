import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HomePage from "../src/pages/HomePage.jsx";
import ResidentActions from "../src/pages/home/ResidentActions.jsx";
import { homePresentation } from "../src/pages/home/homePresentation.js";
import AppLayout from "../src/components/layout/AppLayout.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import { useAuth } from "../src/auth/AuthContext.jsx";
import { loadActiveAlerts } from "../src/alerts/alertsRepository.js";
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn() }));
vi.mock("../src/alerts/alertsRepository.js", () => ({ loadActiveAlerts: vi.fn() }));
beforeEach(() => {
  window.localStorage.clear();
  useAuth.mockReturnValue({ enabled: false, isAuthenticated: false });
  loadActiveAlerts.mockResolvedValue([]);
});
afterEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });
async function show(presentation = homePresentation) {
  const result = render(<MemoryRouter><ThemeProvider><AppLayout homepagePresentation={presentation}><HomePage /></AppLayout></ThemeProvider></MemoryRouter>);
  await act(async () => {});
  return result;
}
describe("Reqro homepage", () => {
  test("uses approved wordmarks, scenic background and structured live headline", async () => {
    const { container } = await show();
    expect(screen.getAllByRole("img", { name: "Reqro" })).toHaveLength(2);
    for (const logo of screen.getAllByRole("img", { name: "Reqro" })) {
      expect(logo).toHaveAttribute("src", homePresentation.wordmark);
      expect(logo).toHaveAttribute("width", "584");
    }
    const artwork = container.querySelector(".reqro-hero-background");
    expect(artwork).toHaveAttribute("src", "/branding/reqro/hero/reqro-home-background.png");
    expect(artwork).toHaveAttribute("alt", "");
    expect(artwork).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("A more connected community starts with you.");
    expect(container.querySelector(".reqro-headline-highlight")).toHaveTextContent("with you.");
    expect(container.querySelector(".reqro-home-tagline")).toHaveTextContent("People ● Requests ● Progress");
    expect(container.querySelector(".reqro-hero-invitation")).toBeNull();
    expect(screen.queryByText("Connecting residents with the right team")).not.toBeInTheDocument();
    expect(container.querySelector('img[src*="reqro-home-hero.png"]')).toBeNull();
  });
  test("default cards have exact content and semantic destinations within hero", async () => {
    await show();
    const actions = screen.getByRole("region", { name: "Resident Actions" });
    const cards = within(actions).getAllByRole("article");
    expect(cards).toHaveLength(3);
    homePresentation.actions.forEach((action, index) => {
      expect(within(cards[index]).getByRole("heading")).toHaveTextContent(action.title);
      expect(cards[index]).toHaveTextContent(action.description);
      expect(within(cards[index]).getByRole("link")).toHaveTextContent(action.ctaLabel);
    });
    expect(within(actions).getByRole("link", { name: "Report Issue" })).toHaveAttribute("href", "/report");
    expect(within(actions).getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
    expect(within(actions).getByRole("link", { name: "240-314-8567" })).toHaveAttribute("href", "tel:2403148567");
    const hero = document.querySelector(".reqro-hero");
    expect(hero).toContainElement(actions);
    expect(hero.nextElementSibling).toBe(screen.getByRole("region", { name: homePresentation.benefitsLabel }));
    expect(within(hero).getAllByRole("link")).toHaveLength(3);
  });
  test("public navigation excludes staff, previews and legacy branding; absent alerts reserve nothing", async () => {
    const { container } = await show();
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    for (const name of ["Issue List", "Dashboard", "AI Workspace", "Map Preview", "Service Requests", "Administration"]) expect(within(nav).queryByRole("link", { name })).toBeNull();
    expect(container.textContent).not.toMatch(/Rockville|CityVUE|Recent Issues|Making a Difference Together/);
    expect(container.querySelectorAll("[id]").length).toBe(new Set([...container.querySelectorAll("[id]")].map((node) => node.id)).size);
    expect(loadActiveAlerts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Resident alerts and notices" })).toBeNull();
  });
  test("retains authenticated staff entry and sign-out callback", async () => {
    const signOut = vi.fn();
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: true, signOut });
    await show();
    expect(screen.getByRole("link", { name: "Service Requests" })).toHaveAttribute("href", "/staff/requests");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  test("anonymous sign-in and keyboard menu preserve behavior", async () => {
    const signIn = vi.fn();
    useAuth.mockReturnValue({ enabled: true, isAuthenticated: false, signIn });
    await show();
    const user = userEvent.setup();
    const menu = screen.getByRole("button", { name: "Open navigation menu" });
    menu.focus(); await user.keyboard("{Enter}");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Staff sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(menu).toHaveFocus();
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });
  test("footer-only icon theme control changes theme and accessible name", async () => {
    await show();
    const toggle = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(screen.getByRole("contentinfo")).toContainElement(toggle);
    expect(within(screen.getByRole("navigation")).queryByRole("button", { name: /Switch to/ })).toBeNull();
    expect(toggle.textContent).toBe("");
    await userEvent.click(toggle);
    expect(document.documentElement.dataset.bsTheme).toBe("dark");
    expect(toggle).toHaveAccessibleName("Switch to light mode");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(document.documentElement.dataset.bsTheme).toBe("light");
  });
  test("composes unchanged F019 above hero and preserves returned order", async () => {
    const alert = { id: "notice", type: "notice", severity: "info", title: "Fictional service notice", message: "Synthetic notice.", startsAt: "2020-01-01T00:00:00Z", publishedAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", expiresAt: null };
    loadActiveAlerts.mockResolvedValue([{ ...alert, id: "urgent", severity: "critical", title: "Fictional urgent notice" }, alert]);
    await show();
    const banner = screen.getByRole("region", { name: "Resident alerts and notices" });
    expect(banner.nextElementSibling).toHaveClass("reqro-hero");
    expect(within(banner).getAllByRole("heading").map((node) => node.textContent)).toEqual(["Fictional urgent notice", "Fictional service notice"]);
  });
  test("renders exact benefits and footer defaults as live text", async () => {
    await show();
    const band = screen.getByRole("region", { name: homePresentation.benefitsLabel });
    for (const item of homePresentation.benefits) {
      expect(within(band).getByRole("heading", { name: item.title })).toBeVisible();
      expect(within(band).getByText(item.description)).toBeVisible();
    }
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Built for Today. Ready for a Stronger Tomorrow.");
    expect(within(screen.getByRole("contentinfo")).queryByRole("link", { name: "Report a Concern" })).toBeNull();
  });
  test("one input replaces every tenant presentation surface", async () => {
    const fixture = {
      ...homePresentation, brandName: "Fictional Community",
      wordmark: "/branding/examples/example.png", wordmarkSize: { width: 120, height: 80 },
      title: "Fictional Community home", description: "Fictional public presentation.",
      navigation: { ...homePresentation.navigation, links: [{ id: "home", label: "Welcome", actionType: "internal", target: "/" }, { id: "help", label: "Get help", actionType: "internal", target: "/report?source=fixture" }] },
      tagline: { ...homePresentation.tagline, words: ["Neighbors", "Services", "Updates"] },
      hero: { ...homePresentation.hero, image: "/branding/examples/example.png", decorative: false, alt: "Fictional scene", headline: [{ text: "Your community, " }, { text: "connected.", highlighted: true }] },
      actionsTitle: "Ways to get help",
      actions: [{ ...homePresentation.actions[0], title: "Community help", ctaLabel: "Begin here", target: "/report?fixture" }],
      benefitsLabel: "Community benefits",
      benefits: [{ ...homePresentation.benefits[0], id: "fixture", title: "Local connection", description: "A synthetic benefit." }],
      footer: { ...homePresentation.footer, wordmark: "/branding/examples/footer.png", message: "A fictional footer.", showThemeToggle: false, links: [{ id: "help", label: "Read help", actionType: "external", target: "https://example.org/help" }] },
    };
    await show(fixture);
    expect(screen.getByRole("link", { name: "Fictional Community home" }).querySelector("img")).toHaveAttribute("src", fixture.wordmark);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your community, connected.");
    expect(screen.getByRole("img", { name: "Fictional scene" })).toHaveAttribute("src", fixture.hero.image);
    expect(document.querySelector(".reqro-home-tagline")).toHaveTextContent("Neighbors ● Services ● Updates");
    expect(screen.getByRole("link", { name: "Get help" })).toHaveAttribute("href", "/report?source=fixture");
    expect(screen.getByRole("link", { name: "Begin here" })).toHaveAttribute("href", "/report?fixture");
    expect(screen.getByRole("region", { name: fixture.benefitsLabel })).toHaveTextContent("Local connection");
    expect(screen.getByRole("contentinfo")).toHaveTextContent(fixture.footer.message);
    expect(within(screen.getByRole("contentinfo")).getByRole("img")).toHaveAttribute("src", fixture.footer.wordmark);
    expect(screen.getByRole("link", { name: "Read help" })).toHaveAttribute("href", "https://example.org/help");
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    expect(document.title).toBe(fixture.title);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", fixture.description);
  });
  test("filters and orders benefits and removes all-disabled band", async () => {
    const fixture = { ...homePresentation, benefits: [
      { ...homePresentation.benefits[0], order: 30 },
      { ...homePresentation.benefits[1], enabled: false },
      { ...homePresentation.benefits[2], order: 10 },
    ] };
    const { unmount } = await show(fixture);
    expect(within(screen.getByRole("region", { name: fixture.benefitsLabel })).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Efficient Operations", "Engaged Residents"]);
    unmount();
    await show({ ...fixture, benefits: fixture.benefits.map((b) => ({ ...b, enabled: false })) });
    expect(screen.queryByRole("region", { name: fixture.benefitsLabel })).toBeNull();
  });
  test("restores metadata on unmount", async () => {
    document.title = "Previous screen";
    const description = document.createElement("meta");
    description.name = "description"; description.content = "Previous description"; document.head.append(description);
    const { unmount } = await show();
    expect(document.title).toBe(homePresentation.title);
    expect(description.content).toBe(homePresentation.description);
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute("href", homePresentation.favicon);
    unmount();
    expect(document.title).toBe("Previous screen");
    expect(description.content).toBe("Previous description");
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
    description.remove();
  });
});
describe("Resident Actions presentation", () => {
  const actions = (count) => Array.from({ length: count }, (_, index) => ({ ...homePresentation.actions[0], id: `action-${index}`, order: index, title: `Action ${index}`, ctaLabel: `Open action ${index}` }));
  test.each([0, 1, 2, 3, 4, 5, 6])("renders %i enabled actions with no placeholders", (count) => {
    const { container } = render(<MemoryRouter><ResidentActions actions={actions(count)} title="Resident Actions" /></MemoryRouter>);
    if (!count) expect(container).toBeEmptyDOMElement();
    else { expect(screen.getAllByRole("article")).toHaveLength(count); expect(screen.getAllByRole("link")).toHaveLength(count); }
  });
  test("filters disabled and sorts order without mutating input", () => {
    const items = actions(4);
    items[0].order = 20; items[2].order = 10; items[1].enabled = false; items[3].enabled = false;
    render(<MemoryRouter><ResidentActions actions={items} title="Resident Actions" /></MemoryRouter>);
    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual(["Action 2", "Action 0"]);
    expect(items[0].id).toBe("action-0");
  });
  test("all disabled or invalid targets leave no section", () => {
    const { container } = render(<MemoryRouter><ResidentActions actions={[...actions(3).map((action) => ({ ...action, enabled: false })), { ...actions(1)[0], target: "javascript:alert(1)" }]} title="Resident Actions" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
