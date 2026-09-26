import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import AccessActions from "../src/admin/AccessActions.jsx";
import { Pager } from "../src/admin/AccessDiscovery.jsx";
function Menu({ canConfigure = false, onAction = vi.fn() }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <AccessActions
        staff={{ id: "a", displayName: "Alex Example", canConfigure }}
        open={open === "a"}
        setOpen={setOpen}
        onAction={onAction}
      />
      <button>After menu</button>
    </>
  );
}
test("Manage Access keyboard navigation, Escape and Tab restore predictable focus", async () => {
  const user = userEvent.setup(),
    action = vi.fn();
  render(<Menu canConfigure onAction={action} />);
  const trigger = screen.getByRole("button", {
    name: "Manage Access for Alex Example",
  });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "View Access" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(
    screen.getByRole("menuitem", { name: "Configure Access" }),
  ).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "View Access" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.keyboard("{Tab}");
  expect(screen.getByRole("button", { name: "After menu" })).toHaveFocus();
  expect(action).not.toHaveBeenCalled();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Configure Access" }));
  expect(action.mock.calls[0][1]).toBe("configure");
  expect(action.mock.calls[0][2].currentTarget).toBe(trigger);
});
test.each(["self", "inactive", "read-only caller"])(
  "server-ineligible %s has View Access only",
  async () => {
    const user = userEvent.setup();
    render(<Menu />);
    await user.click(screen.getByRole("button", { name: /Manage Access/ }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(
      screen.queryByRole("menuitem", { name: "Configure Access" }),
    ).not.toBeInTheDocument();
  },
);
test("pagination preserves bounded sizes, page requests and boundary buttons", async () => {
  const user = userEvent.setup(),
    page = vi.fn(),
    size = vi.fn();
  const { rerender } = render(
    <Pager
      data={{ total: 64, page: 2, pageSize: 25 }}
      onPage={page}
      onSize={size}
      label="Staff pages"
    />,
  );
  expect(screen.getByText("Showing 26–50 of 64")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(page).toHaveBeenLastCalledWith(3);
  await user.click(screen.getByRole("button", { name: "Previous" }));
  expect(page).toHaveBeenLastCalledWith(1);
  const select = screen.getByLabelText("Rows per page:");
  expect(
    within(select)
      .getAllByRole("option")
      .map((o) => o.textContent),
  ).toEqual(["25", "50", "100"]);
  await user.selectOptions(select, "50");
  expect(size).toHaveBeenCalledWith(50);
  rerender(
    <Pager
      data={{ total: 0, page: 1, pageSize: 25 }}
      onPage={page}
      label="Staff pages"
    />,
  );
  expect(screen.getByText("Showing 0–0 of 0")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});
