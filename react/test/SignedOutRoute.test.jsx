import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { RouterProvider } from "react-router-dom";
vi.mock("../src/auth/msalConfig.js", () => ({
  createMsalInstance: () => {
    throw new Error("Signed-out route initialized authentication");
  },
}));

test("signed-out route is outside auth and application data loading", async () => {
  window.history.replaceState(null, "", "/auth/signed-out");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected request"));
  const { default: router } = await import("../src/app/router.jsx");
  const view = render(<RouterProvider router={router} />);
  try {
    expect(
      await screen.findByRole("heading", { name: "Staff session ended" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to staff workspace" }),
    ).toHaveAttribute("href", "/staff/requests");
    expect(
      screen.queryByRole("button", { name: /sign in/i }),
    ).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    router.dispose();
    fetcher.mockRestore();
    window.history.replaceState(null, "", "/");
  }
});
