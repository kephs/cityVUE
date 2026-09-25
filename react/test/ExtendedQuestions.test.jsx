import { useState } from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import FollowUpQuestions, {
  validQuestions,
} from "../src/admin/FollowUpQuestions.jsx";
import DynamicQuestion, {
  displayAnswer,
} from "../src/pages/report/DynamicQuestion.jsx";
import AnswerValue from "../src/components/ui/AnswerValue.jsx";
import {
  parseCalendarDate,
  formatCalendarDate,
} from "../src/components/ui/calendarDate.js";
import ReportIssuePage from "../src/pages/report/ReportIssuePage.jsx";
import SubmittedInformation from "../src/staff/requests/SubmittedInformation.jsx";
import { mapIntakeToCreateServiceRequest } from "../src/serviceRequests/canonicalSubmission.js";
import { getVisibleQuestions } from "../src/catalog/catalogService.js";

const multi = {
  id: "multi",
  type: "multi-select",
  label: "Affected areas",
  helpText: "Select all that apply.",
  required: true,
  displayOrder: 0,
  options: [
    { value: "a", label: "First" },
    { value: "b", label: "<b>Second</b>" },
  ],
};
const date = {
  id: "date",
  type: "date",
  label: "First noticed",
  required: true,
  displayOrder: 1,
};
const information = {
  id: "information",
  type: "information",
  label: "<script>Plain information only</script>",
  required: false,
  displayOrder: 2,
};
function Builder() {
  const [questions, setQuestions] = useState([]);
  return <FollowUpQuestions questions={questions} onChange={setQuestions} />;
}
test("F056.2C builder switches unsaved types, preserves choice options, clears incompatible fields and renders Information controls", async () => {
  const user = userEvent.setup();
  render(<Builder />);
  await user.click(screen.getByRole("button", { name: "Add question" }));
  await user.selectOptions(screen.getByLabelText("Type"), "multi_select");
  await user.type(screen.getByLabelText("Question"), "Synthetic prompt");
  await user.type(screen.getByLabelText("Help text"), "Synthetic help");
  await user.click(screen.getByLabelText("Required"));
  for (const label of ["A", "B"]) {
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(
      screen.getByLabelText(`Option ${label === "A" ? 1 : 2}`),
      label,
    );
  }
  await user.selectOptions(screen.getByLabelText("Type"), "single_select");
  expect(screen.getByLabelText("Option 1")).toHaveValue("A");
  await user.selectOptions(screen.getByLabelText("Type"), "date");
  expect(screen.queryByLabelText("Option 1")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Required")).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Type"), "information");
  expect(screen.queryByLabelText("Required")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Help text")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Information text")).toHaveValue(
    "Synthetic prompt",
  );
  expect(screen.getByText(/Display only/)).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Done editing question" }),
  );
  expect(
    screen.getByRole("heading", { name: "Follow-up questions" }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole("button", { name: "Change order for question 1" }),
  );
  expect(await screen.findByLabelText("Display order")).toBeInTheDocument();
});
test.each(["multi_select", "date", "information"])(
  "F056.2C published %s remains readonly in semantic type",
  async (type) => {
    render(
      <FollowUpQuestions
        questions={[
          {
            key: "published",
            type,
            prompt: "Published",
            required: false,
            help: "",
            order: 0,
            options: [],
          },
        ]}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Edit question 1" }),
    );
    expect(screen.getByLabelText("Type")).toBeDisabled();
  },
);
test("F056.2C Information validation rejects required/help/options and enforces Unicode limit", () => {
  const q = {
    key: null,
    type: "information",
    prompt: "😀".repeat(200),
    required: false,
    help: "",
    order: 0,
    options: [],
  };
  expect(validQuestions([q])).toBe(true);
  for (const extra of [
    { required: true },
    { help: "Hidden" },
    { options: [{ label: "A", order: 0 }] },
    { prompt: "😀".repeat(201) },
  ])
    expect(validQuestions([{ ...q, ...extra }])).toBe(false);
});
test("F056.2C checkbox group exposes legend/help/error and supports keyboard selection and deselection", async () => {
  const user = userEvent.setup();
  function Control() {
    const [value, set] = useState([]);
    return (
      <DynamicQuestion
        question={multi}
        value={value}
        error="Choose at least one."
        onChange={(_, next) => set(next)}
      />
    );
  }
  render(<Control />);
  const group = screen.getByRole("group", {
    name: "Affected areas (Required)",
  });
  expect(group).toHaveAccessibleDescription(
    "Select all that apply. Choose at least one.",
  );
  expect(group).toHaveAttribute("aria-invalid", "true");
  await user.tab();
  expect(screen.getByRole("checkbox", { name: "First" })).toHaveFocus();
  await user.keyboard(" ");
  expect(screen.getByRole("checkbox", { name: "First" })).toBeChecked();
  await user.tab();
  await user.keyboard(" ");
  expect(screen.getByRole("checkbox", { name: "<b>Second</b>" })).toBeChecked();
  await user.keyboard(" ");
  expect(
    screen.getByRole("checkbox", { name: "<b>Second</b>" }),
  ).not.toBeChecked();
  expect(group.querySelector("b")).toBeNull();
});
test("F056.2C Date is labeled date input and Information has no control, required text or HTML execution", () => {
  const view = render(
    <>
      <DynamicQuestion
        question={date}
        value="2024-02-29"
        onChange={vi.fn()}
        error="Enter a valid date."
      />
      <DynamicQuestion question={information} onChange={vi.fn()} />
    </>,
  );
  expect(screen.getByLabelText("First noticed (Required)")).toHaveAttribute(
    "type",
    "date",
  );
  expect(
    screen.getByLabelText("First noticed (Required)"),
  ).toHaveAccessibleDescription("Enter a valid date.");
  expect(screen.getByText(information.label)).toBeInTheDocument();
  expect(view.container.querySelector("script")).toBeNull();
  expect(view.container.querySelectorAll("input")).toHaveLength(1);
});
test("F056.2C Review uses canonical labels in a list, shared date formatting and no Information answer", () => {
  render(<AnswerValue value={displayAnswer(multi, ["b", "a"])} />);
  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "First",
    "<b>Second</b>",
  ]);
  expect(displayAnswer(date, "2024-02-29")).toBe("February 29, 2024");
  expect(displayAnswer(information, "forged")).toBe("");
});
test.each(["America/Los_Angeles", "Pacific/Kiritimati"])(
  "F056.2C shared calendar formatter preserves dates in %s",
  (tz) => {
    const file = pathToFileURL(
      resolve("react/src/components/ui/calendarDate.js"),
    ).href;
    const script = `const {formatCalendarDate}=await import(${JSON.stringify(file)}); process.stdout.write(formatCalendarDate('2024-02-29'));`;
    expect(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      }),
    ).toBe("February 29, 2024");
  },
);
test.each([
  "2023-02-29",
  "1900-02-29",
  "2024-04-31",
  "2024-00-01",
  "2024-13-01",
  "0000-01-01",
  "2024-01-01T00:00:00Z",
  "01/01/2024",
  "2024-01-01\n",
  "2024-01-01\r\n",
])("F056.2C UI calendar parser rejects %s", (value) => {
  expect(parseCalendarDate(value)).toBeNull();
  expect(formatCalendarDate(value)).toBe("");
});
test("F056.2C wire mapping is additive, canonical and omits Information/empty selections/date", () => {
  const base = {
    service: {
      id: "issue",
      serviceDefinitionVersionId: "version",
      questions: [multi, date, information],
    },
    description: "Synthetic",
    location: "",
    reportingMode: "anonymous",
    reporterName: "",
  };
  expect(
    mapIntakeToCreateServiceRequest({
      ...base,
      answers: { multi: ["b", "a"], date: "2024-02-29", information: "forged" },
    }).answers,
  ).toEqual([
    { questionId: "multi", optionKeys: ["a", "b"] },
    { questionId: "date", value: "2024-02-29" },
  ]);
  expect(
    mapIntakeToCreateServiceRequest({
      ...base,
      answers: { multi: [], date: "" },
    }).answers,
  ).toEqual([]);
});
test("F056.2C scalar conditions target Information but External Redirect suppresses all new types", () => {
  const service = {
    questions: [
      multi,
      date,
      { ...information, visibilityRule: { field: "control", equals: "yes" } },
    ],
  };
  expect(getVisibleQuestions(service, { control: "no" })).toHaveLength(2);
  expect(getVisibleQuestions(service, { control: "yes" })).toHaveLength(3);
  expect(
    getVisibleQuestions(
      { ...service, actionType: "external_redirect" },
      { control: "yes" },
    ),
  ).toEqual([]);
});
function setupFlow(questions) {
  const category = {
    id: "category",
    name: "Synthetic category",
    status: "active",
    description: "Fictional fixture",
  };
  const service = {
    id: "issue",
    serviceDefinitionVersionId: "version",
    categoryId: category.id,
    name: "Synthetic intake",
    status: "active",
    citizenDescription: "Fictional intake",
    locationRequirement: "not-applicable",
    anonymousPolicy: "allowed",
    questions,
  };
  const onSuccess = vi.fn(),
    requests = { createServiceRequest: vi.fn(async () => ({ id: "request" })) };
  render(
    <MemoryRouter>
      <ReportIssuePage
        repositories={{
          mode: "api",
          catalog: {
            initialCategories: [category],
            loadCategories: async () => [category],
            loadIssues: async () => [service],
            loadDefinition: async () => service,
          },
          requests,
        }}
        onSuccess={onSuccess}
      />
    </MemoryRouter>,
  );
  return { requests, onSuccess };
}
async function reachQuestions(user) {
  await user.click(screen.getByRole("radio", { name: /Synthetic category/ }));
  await user.click(
    await screen.findByRole("radio", { name: /Synthetic intake/ }),
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("radio", { name: "Report anonymously" }));
  await user.type(
    screen.getByLabelText("Tell us more about the concern *"),
    "Fictional concern",
  );
  await user.click(
    screen.getByRole("button", { name: "Continue to additional information" }),
  );
}
test("F056.2C mixed Additional information requires new answers, Review shows labels/date, Edit retains memory", async () => {
  const user = userEvent.setup();
  setupFlow([multi, date, information]);
  await reachQuestions(user);
  await user.click(screen.getByRole("button", { name: "Review request" }));
  expect(screen.getAllByText("This question is required.")).toHaveLength(2);
  await user.click(screen.getByRole("checkbox", { name: "<b>Second</b>" }));
  await user.click(screen.getByRole("checkbox", { name: "First" }));
  fireEvent.change(screen.getByLabelText("First noticed (Required)"), {
    target: { value: "2024-02-29" },
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  expect(screen.getByText("February 29, 2024")).toBeInTheDocument();
  expect(screen.queryByText(information.label)).not.toBeInTheDocument();
  expect(
    screen
      .getAllByRole("listitem")
      .filter((li) => ["First", "<b>Second</b>"].includes(li.textContent))
      .map((li) => li.textContent),
  ).toEqual(["First", "<b>Second</b>"]);
  await user.click(screen.getByRole("button", { name: "Back / Edit" }));
  expect(screen.getByRole("checkbox", { name: "First" })).toBeChecked();
  expect(screen.getByLabelText("First noticed (Required)")).toHaveValue(
    "2024-02-29",
  );
});
test("F056.2C Information-only schema retains Additional information but creates no answer", async () => {
  const user = userEvent.setup();
  const { requests } = setupFlow([information]);
  await reachQuestions(user);
  expect(
    screen.getByRole("heading", { name: "Additional information" }),
  ).toBeInTheDocument();
  expect(screen.getByText(information.label)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review request" }));
  expect(screen.queryByText(information.label)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Submit Request" }));
  expect(requests.createServiceRequest).toHaveBeenCalledWith(
    expect.objectContaining({ answers: {} }),
  );
});
test("F056.2C protected staff shows historical label list/date only after deliberate protected read", async () => {
  const repository = {
    readAnswers: vi.fn(async () => ({
      answers: [
        {
          questionId: "multi",
          label: "Historical choices",
          type: "multi_select",
          selectedLabels: ["Historical A", "<b>Historical B</b>"],
        },
        {
          questionId: "date",
          label: "Historical date",
          type: "date",
          dateValue: "2024-02-29",
        },
      ],
    })),
  };
  const view = render(
    <SubmittedInformation id="request" repository={repository} canRead />,
  );
  expect(screen.queryByText("Historical choices")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "View submitted information" }),
  );
  const panel = screen.getByRole("region", { name: "Submitted information" });
  expect(
    await within(panel).findByText("February 29, 2024"),
  ).toBeInTheDocument();
  expect(
    within(panel)
      .getAllByRole("listitem")
      .map((li) => li.textContent),
  ).toEqual(["Historical A", "<b>Historical B</b>"]);
  expect(panel.querySelector("b")).toBeNull();
  view.rerender(
    <SubmittedInformation
      id="request"
      repository={repository}
      canRead={false}
    />,
  );
  expect(screen.queryByText("Historical choices")).not.toBeInTheDocument();
});
