import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import ServiceRequestDetailsPage from "../src/pages/issues/ServiceRequestDetailsPage.jsx";

const details = {
    serviceRequest: { id: "80000000-0000-4000-8000-000000000001", referenceNumber: "SR-202609-000123", status: "open", priority: "medium", createdAt: "2026-09-02T12:00:00Z", updatedAt: "2026-09-02T12:00:00Z", revision: 1 },
    classification: { issueName: "Pothole", category: { id: "category", name: "Roads & Streets" }, department: { id: "department", name: "Public Works" }, division: { id: "division", name: "Streets" } },
    request: { description: "Synthetic request description" },
    answers: [{ questionId: "question", label: "Is the roadway blocked?", displayValue: "No", type: "single_select", order: 1 }],
    location: { enteredAddress: "123 Test Street", locationType: "entered_address" },
    requester: { anonymous: false, name: "Alex Example", email: "resident@example.test" },
    activity: [{ type: "service_request_created", actorType: "identified_resident", occurredAt: "2026-09-02T12:00:00Z", metadata: {} }]
};

function renderPage(data) {
    return render(<MemoryRouter initialEntries={["/issues/80000000-0000-4000-8000-000000000001"]}><Routes><Route path="/issues/:issueId" element={<ServiceRequestDetailsPage data={data} />} /></Routes></MemoryRouter>);
}

test("renders the complete canonical read model with persisted answer snapshots", async () => {
    renderPage({ mode: "api", repository: { getServiceRequestDetails: vi.fn(async () => details) } });
    expect(await screen.findByRole("heading", { level: 1, name: "Pothole" })).toBeInTheDocument();
    for (const text of ["SR-202609-000123", "Public Works", "Streets", "Roads & Streets", "Synthetic request description", "Is the roadway blocked?", "No", "123 Test Street", "Alex Example", "resident@example.test", "Service Request Created"]) expect(screen.getByText(text)).toBeInTheDocument();
});

test("renders anonymous requester and omits optional sections safely", async () => {
    const minimal = { ...details, classification: { ...details.classification, division: undefined }, requester: { anonymous: true }, location: undefined, answers: [] };
    renderPage({ mode: "api", repository: { getServiceRequestDetails: vi.fn(async () => minimal) } });
    expect(await screen.findByText("Anonymous")).toBeInTheDocument();
    expect(screen.queryByText("Streets")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Additional Information" })).not.toBeInTheDocument();
});

test("shows loading, not-found, and retryable generic error states", async () => {
    let reject; const repository = { getServiceRequestDetails: vi.fn(() => new Promise((_, no) => { reject = no; })) };
    renderPage({ mode: "api", repository }); expect(screen.getByText("Loading request details…")).toBeInTheDocument();
    reject({ code: "not-found" }); expect(await screen.findByRole("heading", { name: "Request not found" })).toBeInTheDocument();
    const user = userEvent.setup(); const retry = vi.fn().mockRejectedValueOnce({ code: "network" }).mockResolvedValue(details);
    renderPage({ mode: "api", repository: { getServiceRequestDetails: retry } });
    await screen.findByRole("heading", { name: "Request details could not be loaded" }); await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("SR-202609-000123")).toBeInTheDocument();
});

test("keeps canonical details unavailable outside explicitly enabled API mode", () => {
    renderPage({ mode: "unavailable" });
    expect(screen.getByRole("heading", { name: "Request details unavailable" })).toBeInTheDocument();
});
