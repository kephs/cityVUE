import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { test, expect, vi } from "vitest";
import SiteHeader from "../src/components/layout/SiteHeader.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import { useAuth } from "../src/auth/AuthContext.jsx";
vi.mock("../src/auth/AuthContext.jsx", () => ({ useAuth: vi.fn() }));
function show(props = {}) {
  useAuth.mockReturnValue({
    enabled: true,
    isAuthenticated: true,
    displayName: "Fictional staff",
    signOut: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={["/staff/requests"]}>
      <ThemeProvider>
        <SiteHeader {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}
test("long brand, active navigation and keyboard mobile menu retain all routes", async () => {
  const user = userEvent.setup();
  const brandName = "Fictional Regional Community Service Authority";
  show({ brandName });
  expect(
    screen.getByRole("link", { name: `${brandName} home` }),
  ).toHaveAttribute("href", "/");
  const menu = screen.getByRole("button", { name: "Open navigation menu" });
  menu.focus();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("button", { name: "Close navigation menu" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    screen.getByRole("link", { name: "Service Requests" }),
  ).toHaveAttribute("aria-current", "page");
  for (const name of [
    "Home",
    "Report an Issue",
    "Issue List",
    "Dashboard",
    "AI Workspace",
    "Map Preview",
    "Service Requests",
  ])
    expect(screen.getByRole("link", { name, exact: true })).toBeInTheDocument();
  expect(screen.getByText("Fictional staff")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: /Switch to .* mode/ });
  const before = toggle.getAttribute("aria-label");
  await user.click(toggle);
  expect(toggle.getAttribute("aria-label")).not.toBe(before);
});
test("untrusted logo URL falls back to existing mark", () => {
  const { container } = show({ brandLogo: "javascript:alert(1)" });
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".bi-buildings-fill")).toBeInTheDocument();
});
test("approved local logo slot remains decorative beside brand name", () => {
  const { container } = show({ brandLogo: "/branding/fictional-logo.svg" });
  expect(container.querySelector("img")).toHaveAttribute("alt", "");
  expect(
    screen.getByRole("link", { name: "CityVUE home" }),
  ).toBeInTheDocument();
});
