import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import RequestDialog from "../src/staff/requests/RequestDialog.jsx";

function Harness({ busy = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open history</button>
      {open && (
        <RequestDialog
          title="Fictional history"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <button disabled>Unavailable action</button>
          <details>
            <summary>Read narrative</summary>
            <p>Fictional history text</p>
          </details>
        </RequestDialog>
      )}
    </>
  );
}

test("F043 dialog wraps focus through disclosure controls as well as buttons", async () => {
  // jsdom has no geometry; actual layout/native isolation is checked in browser UAT.
  const geometry = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}]);
  try {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open history" });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "Close", exact: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    const disclosure = screen.getByText("Read narrative");
    expect(disclosure).toHaveFocus();
    fireEvent.keyDown(disclosure, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  } finally {
    geometry.mockRestore();
  }
});

test("F043 pending operational command prevents closing until the operation settles", async () => {
  const view = render(<Harness busy />);
  await userEvent.click(screen.getByRole("button", { name: "Open history" }));
  expect(
    screen.getByRole("button", { name: "Close", exact: true }),
  ).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  view.rerender(<Harness />);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
