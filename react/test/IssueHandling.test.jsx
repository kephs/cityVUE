import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { useState } from "react";
import IssueHandling, { handlingPayload } from "../src/admin/IssueHandling.jsx";
const fields = {
  availability: "",
  actionType: "internal_intake",
  destination: "",
  message: "",
  label: "Continue",
};
function Harness({ issue }) {
  const [draft, setDraft] = useState({
    ...fields,
    availability: issue?.availability,
  });
  return (
    <IssueHandling
      issue={issue}
      draft={draft}
      set={(key, value) => setDraft((old) => ({ ...old, [key]: value }))}
    />
  );
}
test("F056.2B explicit mutually exclusive creation choice and editable existing availability", async () => {
  const set = vi.fn(),
    view = render(<IssueHandling draft={fields} set={set} />);
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect(screen.getAllByRole("radio").every((r) => !r.checked)).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: "External only" }));
  expect(set).toHaveBeenCalledWith("availability", "EXTERNAL_ONLY");
  view.rerender(
    <IssueHandling
      issue={{ availability: "INTERNAL_AND_EXTERNAL" }}
      draft={fields}
      set={set}
    />,
  );
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect(screen.getByText("Internal and external")).toBeInTheDocument();
  expect(screen.getByText("Reqro Intake")).toBeInTheDocument();
});
test("F056.2B scoped action capability controls fields and radio group", async () => {
  const view = render(
    <Harness
      issue={{ availability: "EXTERNAL_ONLY", canManageHandling: false }}
    />,
  );
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  view.rerender(
    <Harness
      issue={{ availability: "EXTERNAL_ONLY", canManageHandling: true }}
    />,
  );
  await userEvent.click(
    screen.getByRole("radio", {
      name: "Send the requester to another service",
    }),
  );
  expect(screen.getByLabelText("Destination URL")).toBeInTheDocument();
  expect(screen.getByLabelText("Handoff message")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("radio", { name: "Collect the request in Reqro" }),
  );
  expect(screen.queryByLabelText("Destination URL")).not.toBeInTheDocument();
  expect(
    handlingPayload({ ...fields, destination: "https://example.com/" }),
  ).toEqual({ actionType: "internal_intake" });
});
test("F056.2B safe hostname does not expose path/query in read-only presentation", () => {
  render(
    <IssueHandling
      issue={{ availability: "EXTERNAL_ONLY" }}
      draft={{
        ...fields,
        actionType: "external_redirect",
        destination: "https://example.com/private?static=value",
      }}
      readOnly
    />,
  );
  expect(screen.getByText("example.com")).toBeInTheDocument();
  expect(screen.queryByText(/private\?static/)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("F056.5 creation Availability remains explicit without redirect capability", async () => {
  render(<Harness />);

  for (const label of [
    "External only",
    "Internal and external",
    "Internal only",
  ]) {
    await userEvent.click(screen.getByRole("radio", { name: label }));
    expect(screen.getByRole("radio", { name: label })).toBeChecked();
    expect(screen.getByText("Reqro Intake")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen.getByText("Requests are created and managed in Reqro."),
    ).toBeInTheDocument();
  }
});

test("F056.5 polish explains governed Availability and emphasizes selectable Handling", async () => {
  render(
    <Harness
      issue={{ availability: "EXTERNAL_ONLY", canManageHandling: true }}
    />,
  );
  expect(
    screen.getByText(
      "Changes apply to future intake. Historical requests are unchanged.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "External only" })).toBeChecked();
  const redirect = screen.getByRole("radio", {
    name: "Send the requester to another service",
  });
  await userEvent.click(redirect);
  expect(redirect).toBeChecked();
  expect(redirect.closest("label")).toHaveClass("is-selected");
  expect(screen.getByText("External Redirect").closest("div")).toHaveClass(
    "issue-handling-summary",
  );
  expect(
    screen.getByText("Users continue in an external service."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Destination URL")).toBeInTheDocument();
});

test("Availability conflict retains redirect until deliberate Handling resolution", async () => {
  render(
    <Harness
      issue={{ availability: "EXTERNAL_ONLY", canManageHandling: true }}
    />,
  );
  await userEvent.click(
    screen.getByRole("radio", {
      name: "Send the requester to another service",
    }),
  );
  await userEvent.click(
    screen.getByRole("radio", { name: "Internal only", exact: true }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Handling needs attention",
  );
  expect(
    screen.getByRole("radio", {
      name: "Send the requester to another service",
    }),
  ).toBeChecked();
  await userEvent.click(
    screen.getByRole("radio", { name: "Collect the request in Reqro" }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
