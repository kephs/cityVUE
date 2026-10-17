import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import SubmissionTracking from "../src/pages/report/SubmissionTracking.jsx";

// 43 characters, the canonical unpadded base64url length of 32 bytes.
const CREDENTIAL = `F065${"A".repeat(39)}`;
const EXPIRES = "2027-04-14T12:00:00.000Z";

function browser({ write } = {}) {
  return {
    location: { origin: "https://reqro.test", assign: vi.fn() },
    navigator: {
      clipboard: {
        writeText: write ?? vi.fn(async () => undefined),
      },
    },
  };
}

test("F065 a returned credential produces the tracking link, expiry and shown-once guidance", () => {
  render(
    <SubmissionTracking
      tracking={{ credential: CREDENTIAL, expiresAt: EXPIRES }}
      browser={browser()}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Track this request" }),
  ).toBeInTheDocument();
  // The link uses the established fragment format, so the credential never
  // appears in a path or query string.
  const field = screen.getByLabelText("Your tracking link");
  expect(field).toHaveValue(`https://reqro.test/track#${CREDENTIAL}`);
  expect(field.value).not.toContain("?");
  expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  expect(screen.getByText(/Anyone with this link/i)).toBeInTheDocument();
  expect(screen.getByText(/stops working on/i)).toBeInTheDocument();
});

test("F065 no credential produces a fallback rather than an invented link", () => {
  for (const absent of [
    undefined,
    null,
    {},
    { expiresAt: EXPIRES },
    { credential: 42, expiresAt: EXPIRES },
  ]) {
    const { unmount } = render(
      <SubmissionTracking tracking={absent} browser={browser()} />,
    );
    expect(screen.getByText(/not available for this submission/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your tracking link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Track Request" })).toBeNull();
    expect(document.body.textContent).not.toContain("/track#");
    unmount();
  }
});

test("F065 an unusable expiry still shows the link without a false expiry date", () => {
  render(
    <SubmissionTracking
      tracking={{ credential: CREDENTIAL, expiresAt: "not-a-date" }}
      browser={browser()}
    />,
  );
  expect(screen.getByLabelText("Your tracking link")).toBeInTheDocument();
  expect(screen.queryByText(/stops working on/i)).toBeNull();
});

test("F065 Copy Tracking Link reports success", async () => {
  const user = userEvent.setup();
  const ok = browser();
  render(
    <SubmissionTracking
      tracking={{ credential: CREDENTIAL, expiresAt: EXPIRES }}
      browser={ok}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Copy Tracking Link" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tracking link copied.",
    ),
  );
  expect(ok.navigator.clipboard.writeText).toHaveBeenCalledWith(
    `https://reqro.test/track#${CREDENTIAL}`,
  );
});

test("F065 a refused clipboard tells the requester to copy manually", async () => {
  const user = userEvent.setup();
  const failing = browser({
    write: vi.fn(async () => {
      throw new Error("denied");
    }),
  });
  render(
    <SubmissionTracking
      tracking={{ credential: CREDENTIAL, expiresAt: EXPIRES }}
      browser={failing}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Copy Tracking Link" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Copy is unavailable. Select and copy the link manually.",
    ),
  );
  // The link itself is still present, so a refused clipboard never costs the
  // requester their only copy.
  expect(screen.getByLabelText("Your tracking link")).toHaveValue(
    `https://reqro.test/track#${CREDENTIAL}`,
  );
});

test("F065 Track Request navigates by full document load so the session scrubber runs", async () => {
  const user = userEvent.setup();
  const target = browser();
  render(
    <SubmissionTracking
      tracking={{ credential: CREDENTIAL, expiresAt: EXPIRES }}
      browser={target}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Track Request" }));
  expect(target.location.assign).toHaveBeenCalledWith(`/track#${CREDENTIAL}`);
});

test("F065 the credential never reaches storage, the title or the page URL", async () => {
  const user = userEvent.setup();
  const target = browser();
  render(
    <SubmissionTracking
      tracking={{ credential: CREDENTIAL, expiresAt: EXPIRES }}
      browser={target}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Copy Tracking Link" }));
  for (const store of [window.localStorage, window.sessionStorage])
    expect(JSON.stringify({ ...store })).not.toContain(CREDENTIAL);
  expect(document.title).not.toContain(CREDENTIAL);
  expect(window.location.href).not.toContain(CREDENTIAL);
  expect(window.location.hash).not.toContain(CREDENTIAL);
});
