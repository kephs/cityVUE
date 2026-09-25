import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import FollowUpQuestions, {
  validQuestions,
} from "../src/admin/FollowUpQuestions.jsx";
import DynamicQuestion, {
  displayAnswer,
} from "../src/pages/report/DynamicQuestion.jsx";
import SubmittedInformation from "../src/staff/requests/SubmittedInformation.jsx";

const q = {
  key: "one",
  prompt: "Existing question",
  help: "Helpful text",
  type: "short_text",
  required: false,
  order: 0,
  options: [],
  condition: null,
};
function Builder() {
  const [questions, set] = useState([q]);
  return <FollowUpQuestions questions={questions} onChange={set} />;
}
test("F056.2A builder edits local schema, exposes supported types and preserves existing type identity", async () => {
  const user = userEvent.setup();
  render(<Builder />);
  await user.click(screen.getByRole("button", { name: "Edit question 1" }));
  expect(screen.getByLabelText("Type")).toBeDisabled();
  await user.clear(screen.getByLabelText("Question"));
  await user.type(screen.getByLabelText("Question"), "<b>Plain text</b>");
  await user.click(
    screen.getByRole("button", { name: "Done editing question" }),
  );
  expect(screen.getByText("<b>Plain text</b>")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add question" }));
  expect(screen.getByLabelText("Type")).not.toBeDisabled();
  expect(screen.queryByRole("option", { name: "Date" })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Type"), "single_select");
  await user.click(screen.getByRole("button", { name: "Add option" }));
  expect(screen.getByLabelText("Option 1")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("2–25");
});
test("F056.2A read-only configuration has no authoring controls", () => {
  render(<FollowUpQuestions questions={[q]} readOnly />);
  expect(screen.getByText("Existing question")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
test("F056.2A inherited controllers cannot be removed", () => {
  render(
    <FollowUpQuestions
      questions={[
        q,
        {
          ...q,
          key: "dependent",
          order: 1,
          condition: { questionKey: "one", operator: "equals", value: "yes" },
        },
      ]}
      onChange={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Remove question 1" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Conditional behavior inherited"),
  ).toBeInTheDocument();
});
test("F056.2A authoring validation rejects duplicate orders and labels", () => {
  expect(validQuestions([q, { ...q, key: "two" }])).toBe(false);
  expect(
    validQuestions([
      {
        ...q,
        type: "single_select",
        options: [
          { key: "a", label: " First ", order: 0 },
          { key: "b", label: "FIRST", order: 1 },
        ],
      },
    ]),
  ).toBe(false);
});
test("F056.2A response controls expose required, help and yes/no radios; Review uses labels", async () => {
  const onChange = vi.fn();
  const question = {
    id: "question",
    type: "yes-no",
    label: "Is it blocked?",
    required: true,
    helpText: "Help text",
  };
  render(
    <DynamicQuestion question={question} value="no" onChange={onChange} />,
  );
  expect(
    screen.getByRole("group", { name: "Is it blocked? (Required)" }),
  ).toHaveAccessibleDescription("Help text");
  expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
  expect(onChange).toHaveBeenCalledWith("question", "yes");
  expect(
    displayAnswer(
      {
        type: "single-select",
        options: [{ value: "opaque", label: "Human label" }],
      },
      "opaque",
    ),
  ).toBe("Human label");
  expect(displayAnswer(question, "no")).toBe("No");
});
test("F056.2A withheld answers disclose no panel, count or metadata", () => {
  const repository = { readAnswers: vi.fn() };
  render(
    <SubmittedInformation id="one" repository={repository} canRead={false} />,
  );
  expect(screen.queryByText("Submitted Information")).not.toBeInTheDocument();
  expect(repository.readAnswers).not.toHaveBeenCalled();
});
test("F056.2A protected state clears on denial, request change and ignores stale response", async () => {
  let resolve;
  const repository = {
    readAnswers: vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  };
  const view = render(
    <SubmittedInformation id="one" repository={repository} canRead />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "View Submitted Information" }),
  );
  view.rerender(
    <SubmittedInformation id="two" repository={repository} canRead />,
  );
  resolve({
    answers: [
      { questionId: "q", label: "Stale label", displayValue: "Stale value" },
    ],
  });
  await waitFor(() =>
    expect(screen.queryByText("Stale value")).not.toBeInTheDocument(),
  );
  repository.readAnswers.mockRejectedValue({ status: 403 });
  await userEvent.click(
    screen.getByRole("button", { name: "View Submitted Information" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Submitted information is unavailable.",
    ),
  );
});
