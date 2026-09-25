import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import IssueConfiguration from "../src/admin/IssueConfiguration.jsx";
const sample = {
  id: "fictional-issue",
  name: "Fictional Street Sign",
  description: "A synthetic example.",
  active: true,
  category: "Roads",
  displayOrder: 0,
  coreRevision: 4,
  actionRevision: 2,
  policyRevision: 3,
  assignmentRevision: 0,
  requesterPolicy: "IDENTIFIED_REQUIRED",
  defaultAssignment: null,
  templateEligible: true,
};
async function action(user, label, name = sample.name) {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await user.click(screen.getByRole("menuitem", { name: label, exact: true }));
}
function setup(canWrite = true) {
  let items = [{ ...sample }];
  const onDenied = vi.fn();
  const client = {
    get: vi.fn(async (url) =>
      url === "/admin/issues/categories"
        ? { items: [] }
        : url.includes("templates?")
          ? { items, hasMore: false }
          : !url.includes("?") && !url.includes("assignment-targets")
            ? { issue: items.find((i) => url.endsWith(i.id)) }
            : url.includes("assignment-targets")
              ? {
                  items: [
                    {
                      type: "role",
                      id: "fictional-role",
                      displayName: "Fictional Traffic Operations",
                    },
                  ],
                }
              : {
                  items,
                  total: items.length,
                  organizationTotal: items.length,
                  inactive: items.filter((i) => !i.active).length,
                  active: items.filter((i) => i.active).length,
                  page: 1,
                  pageSize: 25,
                  canWrite,
                },
    ),
    patch: vi.fn(async (id, body) => {
      const issue = {
        ...items[0],
        name: body.name,
        description: body.description,
        displayOrder: body.displayOrder,
        active: body.active,
        requesterPolicy: body.requesterPolicy,
        coreRevision: 9,
      };
      items = [issue];
      return { issue, changed: true };
    }),
    post: vi.fn(async (url, body) => {
      const issue = {
        ...sample,
        ...body,
        id: "new-issue",
        active: false,
        coreRevision: 2,
        policyRevision: 1,
      };
      items = [...items, issue];
      return { issue, changed: true };
    }),
  };
  render(
    <MemoryRouter>
      <IssueConfiguration client={client} onDenied={onDenied} />
    </MemoryRouter>,
  );
  return { client, onDenied, user: userEvent.setup() };
}
test("F056 read-only shows human configuration and no mutation controls", async () => {
  const { client, user } = setup(false);
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", {
      name: `View Configuration for ${sample.name}`,
    }),
  );
  expect(screen.getAllByText("Identification required")[0]).toBeInTheDocument();
  expect(screen.getByText("No default assignment")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /Add Issue|Edit configuration|Change order|Deactivate/,
    }),
  ).not.toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056 create requires explicit template, selected policy and deliberate Save; cancel writes nothing", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  await user.click(screen.getByRole("button", { name: "+ Add Issue" }));
  expect(screen.getByRole("button", { name: "Create Issue" })).toBeDisabled();
  await user.type(screen.getByLabelText("Issue name"), " New Fictional Issue ");
  await user.click(screen.getByRole("combobox", { name: "Intake template" }));
  await user.click(
    await screen.findByRole("option", { name: /Fictional Street Sign/ }),
  );
  await user.click(screen.getByLabelText("Anonymous requests allowed"));
  expect(screen.getByRole("button", { name: "Create Issue" })).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: "External only" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create Issue" })).toBeEnabled(),
  );
  expect(client.post).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create Issue" }));
  await screen.findByRole("row", { name: "New Fictional Issue" });
  expect(client.post).toHaveBeenCalledWith(
    "/admin/issues",
    {
      name: "New Fictional Issue",
      description: "",
      displayOrder: 0,
      requesterPolicy: "ANONYMOUS_ALLOWED",
      defaultAssignment: null,
      templateId: sample.id,
      availability: "EXTERNAL_ONLY",
    },
    expect.objectContaining({ authenticated: true }),
  );
  expect(screen.getAllByText("Inactive").at(-1)).toBeInTheDocument();
});
test("F056 editor uses independent expected revisions and authoritative response/focus", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", {
      name: `Configure ${sample.name}`,
    }),
  );
  expect(screen.getByLabelText("Issue name")).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "Renamed");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() =>
    expect(screen.getByRole("row", { name: "Renamed" })).toHaveFocus(),
  );
  expect(client.patch).toHaveBeenCalledWith(
    "/admin/issues/fictional-issue",
    expect.objectContaining({
      expectedCoreRevision: 4,
      expectedActionRevision: 2,
      expectedPolicyRevision: 3,
      expectedAssignmentRevision: 0,
      name: "Renamed",
    }),
    expect.anything(),
  );
  await action(user, "Change Order", "Renamed");
  await user.clear(screen.getByLabelText("Display Order"));
  await user.type(screen.getByLabelText("Display Order"), "7");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(client.patch).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ expectedCoreRevision: 9, displayOrder: 7 }),
    expect.anything(),
  );
});
test("F056 Cancel restores action focus and performs no write", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  const action = screen.getByRole("button", {
    name: `Configure ${sample.name}`,
  });
  await user.click(action);
  await user.type(screen.getByLabelText("Description"), " edited");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard and close" }));
  expect(action).toHaveFocus();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056 deactivation confirmation cancels by keyboard and only confirm sends state mutation", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  const action = screen.getByRole("button", {
    name: `Actions for ${sample.name}`,
  });
  await user.click(action);
  await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
  expect(
    screen.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveFocus();
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { bubbles: false, cancelable: true }),
  );
  expect(action).toHaveFocus();
  expect(client.patch).not.toHaveBeenCalled();
  await user.click(action);
  await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
  await user.click(screen.getByRole("button", { name: "Deactivate issue" }));
  await waitFor(() => expect(action).toBeEnabled());
  await user.click(action);
  await screen.findByRole("menuitem", { name: "Activate" });
  expect(client.patch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ active: false, expectedCoreRevision: 4 }),
    expect.anything(),
  );
  await user.click(screen.getByRole("menuitem", { name: "Activate" }));
  await waitFor(() => expect(action).toBeEnabled());
  await user.click(action);
  await screen.findByRole("menuitem", { name: "Deactivate" });
});
test("F056 stale conflict blocks retry until explicit discard/refresh; no replay", async () => {
  const { user, client } = setup();
  client.patch.mockRejectedValue({ status: 409 });
  await screen.findByText(sample.name);
  await action(user, "Change Order");
  await user.type(screen.getByLabelText("Display Order"), "2");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Refresh the latest configuration",
  );
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Refresh Configuration" }),
  );
  await user.click(screen.getByRole("button", { name: "Discard and refresh" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Display Order")).toHaveValue(0),
  );
  expect(client.patch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
});
test("F056 permission revocation clears protected state and rechecks Admin authority", async () => {
  const { user, client, onDenied } = setup();
  client.patch.mockRejectedValue({ status: 403 });
  await screen.findByText(sample.name);
  await action(user, "Deactivate");
  await user.click(screen.getByRole("button", { name: "Deactivate issue" }));
  await waitFor(() => expect(onDenied).toHaveBeenCalledOnce());
  expect(screen.queryByText(sample.name)).not.toBeInTheDocument();
});
test("F056 unsafe markup and negative order cannot be saved", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", {
      name: `Configure ${sample.name}`,
    }),
  );
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "<script>bad</script>");
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "Safe");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard and close" }));
  await action(user, "Change Order");
  await user.clear(screen.getByLabelText("Display Order"));
  await user.type(screen.getByLabelText("Display Order"), "-1");
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056 duplicate rejection gives reactivation guidance and keeps the draft", async () => {
  const { user, client } = setup();
  client.patch.mockRejectedValue({ status: 400, code: "ISSUE_DUPLICATE" });
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", {
      name: `Configure ${sample.name}`,
    }),
  );
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "Duplicate");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "An Issue with this name already exists.",
  );
  expect(screen.getByLabelText("Issue name")).toHaveValue("Duplicate");
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
});

test("F056.5 summary and menu are lazy, keyboard operable, and restore focus", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  expect(client.get).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("columnheader").map((node) => node.textContent),
  ).toEqual([
    "Issue",
    "Category",
    "Availability",
    "Handling",
    "Status",
    "Actions",
  ]);
  const trigger = screen.getByRole("button", {
    name: `Actions for ${sample.name}`,
  });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Configure" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Change Order" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Deactivate" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(client.get).toHaveBeenCalledTimes(2);
  await action(user, "Configure");
  expect(
    screen.getByRole("dialog", { name: "Configure Issue" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Display Order")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(trigger).toHaveFocus();
});

test("F056.5 Escape protects dirty drafts and Cancel keeps unsaved values", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  await action(user, "Configure");
  await user.type(screen.getByLabelText("Description"), " unsaved");
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  const confirmation = screen.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await user.click(
    within(confirmation).getByRole("button", { name: "Cancel", exact: true }),
  );
  expect(screen.getByLabelText("Description")).toHaveValue(
    "A synthetic example. unsaved",
  );
  expect(client.patch).not.toHaveBeenCalled();
});

test("F056.5 closed detail ignores late response and read-only loads no assignment targets", async () => {
  const { user, client } = setup(false);
  await screen.findByText(sample.name);
  const initial = client.get.getMockImplementation();
  let resolveDetail;
  client.get.mockImplementation((url, options) =>
    url === `/admin/issues/${sample.id}`
      ? new Promise((resolve) => {
          resolveDetail = resolve;
        })
      : initial(url, options),
  );
  await action(user, "View Configuration");
  expect(
    screen.getByText("Loading the latest Issue configuration…"),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Close configuration", exact: true }),
  );
  await act(() => resolveDetail({ issue: sample }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  client.get.mockImplementation(initial);
  await action(user, "View Configuration");
  expect(
    screen.queryByRole("button", { name: "Save Changes" }),
  ).not.toBeInTheDocument();
  expect(
    client.get.mock.calls.some(([url]) => url.includes("assignment-targets")),
  ).toBe(false);
  expect(client.patch).not.toHaveBeenCalled();
});

test("F056.5 pending Save submits once; closing waits for an explicit decision", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  let finish;
  client.patch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await action(user, "Configure");
  await user.type(screen.getByLabelText("Description"), " changed");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Close configuration", exact: true }),
  );
  const confirmation = screen.getByRole("dialog", {
    name: "Close while saving?",
  });
  expect(confirmation).toHaveTextContent(
    "Closing does not cancel the submitted change",
  );
  await user.click(
    within(confirmation).getByRole("button", { name: "Close configuration" }),
  );
  await act(() => finish({ issue: sample, changed: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(client.patch).toHaveBeenCalledOnce();
  expect(screen.getByText("Issue configuration updated.")).toBeInTheDocument();
});

test("F056.5 drawer loops Tab boundaries and Escape restores the initiating action", async () => {
  const { user } = setup();
  await screen.findByText(sample.name);
  const trigger = screen.getByRole("button", { name: "+ Add Issue" });
  await user.click(trigger);
  // jsdom has no layout; browser review also verifies actual visible controls.
  const rectangles = vi
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockImplementation(function () {
      return this.closest("[hidden]") ? [] : [{}];
    });
  try {
    const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
    const close = screen.getByRole("button", {
      name: "Close configuration",
      exact: true,
    });
    cancel.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(trigger).toHaveFocus();
  } finally {
    rectangles.mockRestore();
  }
});
