import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test } from "vitest";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
import {
  OrganizationBrand,
  ReqroBrand,
  reqroBrand,
} from "../src/branding/ReqroBrand.jsx";
function view(branding) {
  return render(
    <ThemeProvider>
      <OrganizationBrand branding={branding} />
    </ThemeProvider>,
  );
}
test("F054 canonical fallback uses supplied dark wordmark without trademark or client identity", () => {
  view(null);
  expect(screen.getByRole("img", { name: "Reqro" })).toHaveAttribute(
    "src",
    "/branding/reqro/reqro-logo-dark.png",
  );
  expect(
    screen.getByText(
      reqroBrand.tagline
        .split("•")
        .map((word) => word.trim())
        .join(", "),
    ),
  ).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/Rockville|Rise Together|™|®/);
  expect(screen.queryByText("Powered by Reqro")).not.toBeInTheDocument();
});
test("F054 fictional Organization presentation, missing tagline, failure fallback and identity reset", () => {
  const branding = {
    mode: "ORGANIZATION",
    displayName: "Example Organization",
    tagline: null,
    logoKey: "example-organization",
    revision: 2,
  };
  const r = view(branding);
  expect(screen.getByText("Example Organization")).toBeInTheDocument();
  expect(screen.getByText("Powered by Reqro")).toBeInTheDocument();
  const logo = document.querySelector(".organization-logo");
  expect(logo).toHaveAttribute(
    "src",
    "/branding/examples/example-organization.png",
  );
  fireEvent.error(logo);
  expect(screen.getByRole("img", { name: "Reqro" })).toHaveAttribute(
    "src",
    "/branding/reqro/reqro-mark-dark.png",
  );
  r.rerender(
    <ThemeProvider>
      <OrganizationBrand branding={{ ...branding, revision: 3 }} />
    </ThemeProvider>,
  );
  expect(document.querySelector(".organization-logo")).toBeInTheDocument();
});
test("F054 plain text escapes markup, long names remain text, and unapproved paths never become image sources", () => {
  const displayName = '<script>alert("x")</script> Example ' + "X".repeat(50);
  view({
    mode: "ORGANIZATION",
    displayName,
    tagline: "<img src=x onerror=alert(1)>",
    logoKey: "https://tracker.invalid/logo.svg",
    revision: 1,
  });
  expect(screen.getByText(displayName)).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector("[onerror]")).toBeNull();
  expect(document.querySelector("img")).toHaveAttribute(
    "src",
    "/branding/reqro/reqro-mark-dark.png",
  );
});
test("F054 missing required name and failed product bytes still provide visible Reqro fallback", () => {
  view({ mode: "ORGANIZATION", displayName: " ", logoKey: "../../secret" });
  expect(
    screen.getByText(
      reqroBrand.tagline
        .split("•")
        .map((word) => word.trim())
        .join(", "),
    ),
  ).toBeInTheDocument();
  fireEvent.error(screen.getByRole("img", { name: "Reqro" }));
  expect(screen.getByText("Reqro")).toBeInTheDocument();
});
test("F054 themed product mark follows the shared theme", () => {
  render(
    <ThemeProvider>
      <ReqroBrand compact />
    </ThemeProvider>,
  );
  expect(
    screen.getByRole("img", { name: "Reqro" }).getAttribute("src"),
  ).toMatch(/^\/branding\/reqro\/reqro-mark-(light|dark)\.png$/);
});

test("F056.4 brand phrase has natural accessible text and decorative green separators", () => {
  view(null);
  const phrase = screen.getByText("People, Requests, Progress");
  expect(phrase).toHaveClass("visually-hidden");
  const separators = document.querySelectorAll(".reqro-tagline-separator");
  expect(separators).toHaveLength(2);
  for (const separator of separators) {
    expect(separator).toHaveTextContent("●");
    expect(separator.closest('[aria-hidden="true"]')).not.toBeNull();
  }
  expect(document.querySelector(".reqro-tagline")).toHaveTextContent(
    "People ● Requests ● Progress",
  );
});
