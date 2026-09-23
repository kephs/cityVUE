import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import ParticipationInput from "../src/residentIntake/ParticipationInput.jsx";
import ServiceLocationInput from "../src/residentIntake/ServiceLocationInput.jsx";
import ReportIssuePage from "../src/pages/report/ReportIssuePage.jsx";
import { mapIntakeToCreateServiceRequest } from "../src/serviceRequests/canonicalSubmission.js";
import { ParticipationPreview } from "../src/staff/ServiceParticipationPage.jsx";

const area = "10000000-0000-4000-8000-000000000051";
const repository = {
  areas: async () => [{ id: area, label: "Fictional Participation Area" }],
};
const question =
  "Which area do you associate with this service request? (Optional)";
afterEach(() => vi.unstubAllGlobals());
test("F051 area selection stays independent of manual/device Service Location changes", async () => {
  let success;
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: vi.fn((fn) => {
        success = fn;
      }),
    },
  });
  function Harness() {
    const [value, setValue] = useState(),
      [location, setLocation] = useState({
        text: "Fictional Lane",
        point: null,
      });
    return (
      <>
        <ParticipationInput
          repository={repository}
          value={value}
          onChange={setValue}
        />
        <ServiceLocationInput
          {...location}
          onChange={(text, point) => setLocation({ text, point })}
        />
      </>
    );
  }
  render(<Harness />);
  const user = userEvent.setup();
  const selector = await screen.findByLabelText(question);
  expect(selector).not.toBeRequired();
  await user.selectOptions(selector, area);
  fireEvent.change(screen.getByLabelText("Service Location (optional)"), {
    target: { value: "Different Fictional Lane" },
  });
  expect(selector).toHaveValue(area);
  fireEvent.click(
    screen.getByRole("button", { name: "Use my current location" }),
  );
  act(() => success({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }));
  expect(selector).toHaveValue(area);
  const current = screen.getByLabelText("Service Location (optional)").value;
  await user.selectOptions(selector, "declined");
  expect(screen.getByLabelText("Service Location (optional)")).toHaveValue(
    current,
  );
});
test.each(["anonymous", "identified"])(
  "F051 %s intake preserves area across Review/Back and maps only explicit geography",
  async (mode) => {
    const service = {
      id: "service",
      categoryId: "category",
      serviceDefinitionVersionId: "version",
      name: "Fictional Issue",
      citizenDescription: "Fictional test",
      status: "active",
      locationRequirement: "required",
      anonymousPolicy: "allowed",
      questions: [],
    };
    const create = vi
      .fn()
      .mockResolvedValue({ id: "result", referenceNumber: "FICTIONAL-51" });
    const data = {
      mode: "api",
      participation: repository,
      catalog: {
        loadCategories: async () => [
          {
            id: "category",
            name: "Fictional Category",
            description: "Fictional",
            status: "active",
          },
        ],
        loadIssues: async () => [service],
        loadDefinition: async () => service,
      },
      requests: { createServiceRequest: create },
    };
    render(
      <MemoryRouter>
        <ReportIssuePage repositories={data} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("radio", { name: /Fictional Category/ }),
    );
    await user.click(
      await screen.findByRole("radio", { name: /Fictional Issue/ }),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(
      await screen.findByLabelText("Tell us more about the concern *"),
      "Fictional description",
    );
    await user.type(
      screen.getByLabelText("Service Location (required)"),
      "Fictional Service Lane",
    );
    await user.click(
      screen.getByRole("radio", {
        name: mode === "anonymous" ? "Report anonymously" : "Provide my name",
      }),
    );
    if (mode === "identified")
      await user.type(screen.getByLabelText("Your name *"), "Fictional Person");
    await user.selectOptions(await screen.findByLabelText(question), area);
    await user.click(screen.getByRole("button", { name: "Review request" }));
    expect(
      screen.getByText("Fictional Participation Area"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back / Edit" }));
    expect(await screen.findByLabelText(question)).toHaveValue(area);
    await user.selectOptions(screen.getByLabelText(question), "declined");
    await user.click(screen.getByRole("button", { name: "Review request" }));
    expect(screen.getByText("Prefer not to say")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back / Edit" }));
    await user.selectOptions(await screen.findByLabelText(question), area);
    await user.click(screen.getByRole("button", { name: "Review request" }));
    await user.click(screen.getByRole("button", { name: "Submit Request" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const payload = mapIntakeToCreateServiceRequest(create.mock.calls[0][0]);
    expect(payload.participation).toEqual({ state: "PROVIDED", areaId: area });
    expect("contact" in payload).toBe(mode === "identified");
    expect(payload).not.toHaveProperty("requesterId");
    expect(payload.location.enteredAddress).toBe("Fictional Service Lane");
  },
);
test("F051 unavailable area catalog is optional and retries without exposing error details", async () => {
  const repo = {
    areas: vi
      .fn()
      .mockRejectedValueOnce(Error("private"))
      .mockResolvedValueOnce([]),
  };
  render(<ParticipationInput repository={repo} onChange={vi.fn()} />);
  expect(
    await screen.findByText(/submit without this optional/),
  ).toBeInTheDocument();
  expect(screen.queryByText("private")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry participation areas" }),
  );
  expect(await screen.findByLabelText(question)).not.toBeRequired();
});
const summary = {
  period: { startDate: "2026-01-01", endDate: "2026-02-28" },
  suppressionThreshold: 5,
  areas: [
    { areaId: area, label: "Fictional Area", suppressed: true, count: null },
  ],
  declined: { suppressed: false, count: 0 },
  notCollected: { suppressed: false, count: 6 },
};
test("F051 analytics displays only safe counts, recovers invalid period, clears on permission loss", async () => {
  const client = {
    get: vi
      .fn()
      .mockResolvedValueOnce(summary)
      .mockRejectedValueOnce({ status: 400 })
      .mockResolvedValueOnce(summary)
      .mockRejectedValueOnce({ status: 403 }),
  };
  render(<ParticipationPreview client={client} />);
  expect(await screen.findByText("Fewer than 5 requests")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Apply period" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  expect(screen.queryByText("6 requests")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Apply period" }));
  await screen.findByText("6 requests");
  await userEvent.click(screen.getByRole("button", { name: "Apply period" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not authorized");
  expect(
    screen.queryByRole("button", { name: "Apply period" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("6 requests")).not.toBeInTheDocument();
});
