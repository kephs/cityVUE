import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import ReportIssuePage from "../src/pages/report/ReportIssuePage.jsx";
import { CityVueApiError } from "../src/api/apiClient.js";

const category = { id: "category", name: "Roads", description: "Road concerns", icon: "bi-signpost", accent: "blue", status: "active" };
const service = { id: "service", categoryId: "category", serviceDefinitionVersionId: "version", name: "Pothole", citizenDescription: "Road damage", status: "active", locationRequirement: "required", anonymousPolicy: "allowed", questions: [] };

function apiRepositories(createServiceRequest, detailsEnabled = false) {
    return { mode: "api", detailsEnabled, catalog: { notice: "Local API mode", loadCategories: vi.fn(async () => [category]), loadIssues: vi.fn(async () => [service]), loadDefinition: vi.fn(async () => service) }, requests: { createServiceRequest } };
}

async function completeRequest(user) {
    await user.click(await screen.findByRole("radio", { name: /Roads/ }));
    await user.click(await screen.findByRole("radio", { name: /Pothole/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("Tell us more about the concern *"), "Resident-only description");
    await user.type(screen.getByLabelText("Location *"), "100 Main Street");
    await user.click(screen.getByRole("button", { name: "Review request" }));
}

test("API mode loads asynchronously, submits once, and displays the API reference verbatim", async () => {
    const user = userEvent.setup();
    let resolveRequest; const create = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<MemoryRouter><ReportIssuePage repositories={apiRepositories(create)} /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading categories");
    await completeRequest(user);
    await user.dblClick(screen.getByRole("button", { name: "Submit Request" }));
    expect(create).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
    resolveRequest({ id: "request", referenceNumber: "SR-202609-000123", status: "open", createdAt: "2026-09-02T00:00:00Z" });
    expect(await screen.findByRole("status")).toHaveTextContent("SR-202609-000123");
});

test("offers canonical details navigation only when development reads are enabled", async () => {
    const user = userEvent.setup(); const create = vi.fn().mockResolvedValue({ id: "80000000-0000-4000-8000-000000000001", referenceNumber: "SR-202609-000125" });
    render(<MemoryRouter><ReportIssuePage repositories={apiRepositories(create, true)} /></MemoryRouter>);
    await completeRequest(user); await user.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(await screen.findByRole("button", { name: "View request details" })).toBeInTheDocument();
});

test("API submission errors preserve review state and allow an explicit retry", async () => {
    const user = userEvent.setup(); const create = vi.fn().mockRejectedValueOnce(new Error("The issue form has changed. Please review the latest questions before submitting.")).mockResolvedValue({ referenceNumber: "SR-202609-000124" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><ReportIssuePage repositories={apiRepositories(create)} /></MemoryRouter>);
    await completeRequest(user); await user.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("issue form has changed");
    expect(screen.getByText("Resident-only description")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(create).toHaveBeenCalledTimes(2);
});

test.each([
    ["LOCATION_INELIGIBLE", "This issue appears to be outside the service area for this request type."],
    ["LOCATION_ELIGIBILITY_UNDETERMINED", "We could not confirm whether this location is eligible. Please check the location and try again."],
    ["LOCATION_ELIGIBILITY_UNAVAILABLE", "Location validation is temporarily unavailable. Please try again."]
])("shows safe geographic error %s and preserves review state", async (code, message) => {
    const user = userEvent.setup(); const create = vi.fn().mockRejectedValue(new CityVueApiError(code, message, { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MemoryRouter><ReportIssuePage repositories={apiRepositories(create)} /></MemoryRouter>);
    await completeRequest(user); await user.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("Resident-only description")).toBeInTheDocument();
    expect(screen.queryByText(/provider|layer|endpoint/i)).not.toBeInTheDocument();
});
