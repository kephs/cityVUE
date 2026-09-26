import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import Confirmation from "../src/admin/Confirmation.jsx";

test("Reqro confirmation names its message, focuses Keep, cancels on Escape and restores focus", async () => {
  const invoke = document.createElement("button");
  document.body.append(invoke);
  invoke.focus();
  const cancel = vi.fn(),
    confirm = vi.fn();
  const view = render(
    <Confirmation
      title="Replace Copied Configuration?"
      cancelLabel="Keep Current Configuration"
      confirmLabel="Replace Configuration"
      onCancel={cancel}
      onConfirm={confirm}
      returnFocus={invoke}
    >
      Copied settings and edits will be replaced.
    </Confirmation>,
  );
  const dialog = screen.getByRole("dialog", {
    name: "Replace Copied Configuration?",
  });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAccessibleDescription(
    "Copied settings and edits will be replaced.",
  );
  expect(
    screen.getByRole("button", { name: "Keep Current Configuration" }),
  ).toHaveFocus();
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Replace Configuration" }),
  );
  expect(confirm).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(invoke).toHaveFocus();
  invoke.remove();
});

test("confirmation backdrop cancels and never confirms", () => {
  const cancel = vi.fn(),
    confirm = vi.fn();
  render(
    <Confirmation
      title="Replace?"
      onCancel={cancel}
      onConfirm={confirm}
      confirmLabel="Replace"
    >
      Review settings.
    </Confirmation>,
  );
  fireEvent.click(screen.getByRole("dialog"), { clientX: -1, clientY: -1 });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});

test("Nested confirmation contains Tab and does not send Escape cancellation to the drawer", () => {
  const parentCancel = vi.fn(),
    cancel = vi.fn();
  render(
    <div onCancel={parentCancel}>
      <Confirmation
        title="Nested confirmation"
        onCancel={cancel}
        onConfirm={() => {}}
        confirmLabel="Replace"
        cancelLabel="Keep"
      >
        Review.
      </Confirmation>
    </div>,
  );
  const first = screen.getByRole("button", { name: "Keep" }),
    last = screen.getByRole("button", { name: "Replace" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(parentCancel).not.toHaveBeenCalled();
});
