import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  const { client } = setup(false);
  await screen.findByText(sample.name);
  expect(screen.getAllByText("Identification required")[0]).toBeInTheDocument();
  expect(screen.getByText("No default assignment")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /Add issue|Edit configuration|Change order|Deactivate/,
    }),
  ).not.toBeInTheDocument();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056 create requires explicit template, selected policy and deliberate Save; cancel writes nothing", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  await user.click(screen.getByRole("button", { name: "+ Add issue" }));
  expect(screen.getByRole("button", { name: "Create issue" })).toBeDisabled();
  await user.type(screen.getByLabelText("Issue name"), " New Fictional Issue ");
  await user.click(screen.getByRole("combobox", { name: "Intake template" }));
  await user.click(
    await screen.findByRole("option", { name: /Fictional Street Sign/ }),
  );
  await user.click(screen.getByLabelText("Anonymous requests allowed"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create issue" })).toBeEnabled(),
  );
  expect(client.post).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create issue" }));
  await screen.findByRole("listitem", { name: "New Fictional Issue" });
  expect(client.post).toHaveBeenCalledWith(
    "/admin/issues",
    {
      name: "New Fictional Issue",
      description: "",
      displayOrder: 0,
      requesterPolicy: "ANONYMOUS_ALLOWED",
      defaultAssignment: null,
      templateId: sample.id,
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
      name: `Edit ${sample.name}`,
    }),
  );
  expect(screen.getByLabelText("Issue name")).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "Renamed");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.getByRole("listitem", { name: "Renamed" })).toHaveFocus(),
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
  await user.click(
    screen.getByRole("button", { name: "Change order for Renamed" }),
  );
  await user.clear(screen.getByLabelText("Display order"));
  await user.type(screen.getByLabelText("Display order"), "7");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
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
    name: `Edit ${sample.name}`,
  });
  await user.click(action);
  await user.type(screen.getByLabelText("Description"), " edited");
  await user.click(screen.getByRole("button", { name: "Cancel edit" }));
  expect(action).toHaveFocus();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056 deactivation confirmation cancels by keyboard and only confirm sends state mutation", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  const action = screen.getByRole("button", {
    name: `Deactivate ${sample.name}`,
  });
  await user.click(action);
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
  await user.click(screen.getByRole("button", { name: "Deactivate issue" }));
  await screen.findByRole("button", { name: `Activate ${sample.name}` });
  expect(client.patch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ active: false, expectedCoreRevision: 4 }),
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", { name: `Activate ${sample.name}` }),
  );
  await screen.findByRole("button", { name: `Deactivate ${sample.name}` });
});
test("F056 stale conflict blocks retry until explicit discard/refresh; no replay", async () => {
  const { user, client } = setup();
  client.patch.mockRejectedValue({ status: 409 });
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", { name: `Change order for ${sample.name}` }),
  );
  await user.type(screen.getByLabelText("Display order"), "2");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Refresh the latest configuration",
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh Issues" }));
  await user.click(screen.getByRole("button", { name: "Discard and refresh" }));
  await screen.findByText(sample.name);
  expect(client.patch).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Display order")).not.toBeInTheDocument();
});
test("F056 permission revocation clears protected state and rechecks Admin authority", async () => {
  const { user, client, onDenied } = setup();
  client.patch.mockRejectedValue({ status: 403 });
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", { name: `Deactivate ${sample.name}` }),
  );
  await user.click(screen.getByRole("button", { name: "Deactivate issue" }));
  await waitFor(() => expect(onDenied).toHaveBeenCalledOnce());
  expect(screen.queryByText(sample.name)).not.toBeInTheDocument();
});
test("F056 unsafe markup and negative order cannot be saved", async () => {
  const { user, client } = setup();
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", {
      name: `Edit ${sample.name}`,
    }),
  );
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "<script>bad</script>");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "Safe");
  await user.clear(screen.getByLabelText("Display order"));
  await user.type(screen.getByLabelText("Display order"), "-1");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(client.patch).not.toHaveBeenCalled();
});
test("F056 duplicate rejection gives reactivation guidance and keeps the draft", async () => {
  const { user, client } = setup();
  client.patch.mockRejectedValue({ status: 400, code: "ISSUE_DUPLICATE" });
  await screen.findByText(sample.name);
  await user.click(
    screen.getByRole("button", {
      name: `Edit ${sample.name}`,
    }),
  );
  await user.clear(screen.getByLabelText("Issue name"));
  await user.type(screen.getByLabelText("Issue name"), "Duplicate");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "An Issue with this name already exists.",
  );
  expect(screen.getByLabelText("Issue name")).toHaveValue("Duplicate");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});
