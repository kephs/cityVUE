import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  IssueIcon,
  LocationDisplay,
  StatusBadge,
} from "../src/components/ui/RequestPresentation.jsx";
import {
  activityPresentation,
  statusPresentation,
  safeIssueIcon,
} from "../src/components/ui/presentation.js";
import RequestActivity from "../src/staff/requests/RequestActivity.jsx";
afterEach(cleanup);

test("list toolbar wraps and readable ordinals retain room for multiple digits", () => {
  const css = readFileSync(
    "react/src/staff/requests/staffRequests.css",
    "utf8",
  );
  expect(css.match(/\.request-list-toolbar\s*\{([^}]+)\}/)[1]).toMatch(
    /flex-wrap:\s*wrap/,
  );
  expect(css.match(/\.request-row-position\s*\{([^}]+)\}/)[1]).toMatch(
    /font-size:\s*var\(--font-body\)/,
  );
  expect(css.match(/\.request-row-position > span\s*\{([^}]+)\}/)[1]).toMatch(
    /min-width:\s*4ch/,
  );
  expect(css.match(/\.staff-request-table thead\s*\{([^}]+)\}/)[1]).toMatch(
    /font-size:\s*var\(--font-body\)/,
  );
});

test("detail audience/reference metadata uses token spacing and responsive flex wrapping", () => {
  const css = readFileSync(
    "react/src/staff/requests/staffRequests.css",
    "utf8",
  );
  const rule = css.match(/\.request-identity-meta\s*\{([^}]+)\}/)[1];
  expect(rule).toMatch(/display:\s*flex/);
  expect(rule).toMatch(/flex-wrap:\s*wrap/);
  expect(rule).toMatch(/gap:\s*var\(--space-2\) var\(--space-4\)/);
});

test.each([
  "signpost-split",
  "bi-tree",
  undefined,
  "unknown",
  "<svg onload=alert(1)>",
])("catalog icon %s is allowlisted with neutral fallback", (value) => {
  const { container } = render(<IssueIcon icon={value} size="large" />);
  expect(container.querySelector("span")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(container.querySelector("i")).toHaveClass(safeIssueIcon(value));
  expect(container.querySelector("svg")).toBeNull();
  if (!["signpost-split", "bi-tree"].includes(value))
    expect(safeIssueIcon(value)).toBe("bi-file-earmark-text");
});
test.each([null, undefined, "", "   "])(
  "missing service location %s renders no row",
  (value) => {
    const { container } = render(<LocationDisplay value={value} />);
    expect(container).toBeEmptyDOMElement();
  },
);
test.each([
  "123 Fictional Lane",
  "Training area B",
  "Long fictional location ".repeat(40),
  "<script>alert('x')</script>",
])("service location is plain text: %s", (value) => {
  const { container } = render(<LocationDisplay value={value} />);
  expect(container.textContent).toBe(value);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("i")).toHaveAttribute("aria-hidden", "true");
});
test.each(Object.entries(statusPresentation))(
  "status %s has text, semantic token and decorative icon",
  (value, meta) => {
    render(<StatusBadge value={value} />);
    const badge = screen.getByText(meta.label);
    expect(badge).toHaveClass(`tone-${meta.tone}`);
    expect(badge.querySelector("i")).toHaveAttribute("aria-hidden", "true");
  },
);
test.each(Object.entries(activityPresentation))(
  "activity %s retains safe content and semantic presentation",
  async (type, meta) => {
    const text = "<script>fictional</script>";
    const repository = {
      activity: vi.fn().mockResolvedValue({
        items: [
          {
            id: "fictional",
            type,
            occurredAt: "2026-09-20T12:00:00Z",
            actorDisplay: "Staff member",
            fromDepartment: text,
            toDepartment: "Fictional scope",
            fromTargetName: text,
            fromTargetType: "role",
            toTargetName: text,
            toTargetType: "group",
            narrative: text,
          },
        ],
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    };
    const { container } = render(
      <RequestActivity
        repository={repository}
        id="fictional"
        onAccessFailure={vi.fn()}
      />,
    );
    const title = await screen.findByRole("heading", { name: meta.label });
    expect(title.closest("li")).toHaveClass(`tone-${meta.tone}`);
    expect(container.querySelector(".activity-marker i")).toHaveClass(
      `bi-${meta.icon}`,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(text);
    expect(
      screen.getByText("Staff member", { exact: false }),
    ).toBeInTheDocument();
    expect(repository.activity).toHaveBeenCalledTimes(1);
  },
);

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((n) => parseInt(n, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test("light and dark semantic text pairs meet 4.5:1 contrast", () => {
  const css = readFileSync("react/src/theme/designTokens.css", "utf8");
  const blocks = css.split('[data-bs-theme="dark"]');
  for (const block of blocks) {
    const values = Object.fromEntries(
      [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const pairs = [
      ["--text-primary", "--surface-card"],
      ["--text-secondary", "--surface-card"],
      ["--text-muted", "--surface-card"],
      ["--text-primary", "--surface-subtle"],
      ["--brand-on-primary", "--brand-primary"],
    ];
    for (const tone of ["open", "work", "hold", "closed", "cancelled"])
      pairs.push([`--status-${tone}`, `--status-${tone}-bg`]);
    for (const tone of ["created", "routing", "assignment", "watcher"])
      pairs.push([`--activity-${tone}`, `--activity-${tone}-bg`]);
    for (const [fg, bg] of pairs) {
      const a = luminance(values[fg] || "#ffffff"),
        b = luminance(values[bg]);
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
