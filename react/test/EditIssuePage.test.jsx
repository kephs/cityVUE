import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

import EditIssuePage from "../src/pages/issues/EditIssuePage.jsx";

const matchedIssue = { id: "matched-1", title: "Pothole", description: "Resident description:\nDeep hole", category: "Road", priority: "Medium", status: "In Progress", reportedBy: "Anonymous", location: "Main Street", dateReported: "2026-01-01T00:00:00.000Z" };
const legacyIssue = { ...matchedIssue, id: "legacy-1", title: "Historic sidewalk concern", category: "Other" };

function Destination() { const location = useLocation(); return <div>{location.state?.notice || "Issue list"}</div>; }
function renderEdit({ issue = matchedIssue, updateIssue = vi.fn(() => true), id = issue?.id || "missing" } = {}) {
    render(<MemoryRouter initialEntries={[`/issues/${id}/edit`]}><Routes><Route path="/issues/:issueId/edit" element={<EditIssuePage getIssue={() => issue} updateIssue={updateIssue} />} /><Route path="/issues" element={<Destination />} /></Routes></MemoryRouter>);
    return updateIssue;
}

describe("EditIssuePage", () => {
    test("loads an exact catalog match without reconstructing dynamic answers", () => {
        renderEdit();
        expect(screen.getByText("Catalog matched")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /Roads & Streets.*Pothole/ })).toBeInTheDocument();
        expect(screen.getByLabelText("Request Details *")).toHaveValue(matchedIssue.description);
    });

    test("uses legacy fallback and initializes editable persisted fields", () => {
        renderEdit({ issue: legacyIssue });
        expect(screen.getByText("Legacy request")).toBeInTheDocument();
        expect(screen.getByLabelText("Title *")).toHaveValue(legacyIssue.title);
        expect(screen.getByLabelText("Category *")).toHaveValue("Other");
    });

    test("shows an accessible missing Issue state", () => {
        renderEdit({ issue: null });
        expect(screen.getByRole("heading", { name: "Issue Not Found" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Back to Issue List" })).toHaveAttribute("href", "/issues");
    });

    test("valid update preserves identity, date, and status then navigates", async () => {
        const user = userEvent.setup();
        const updateIssue = renderEdit();
        await user.clear(screen.getByLabelText("Issue Location *"));
        await user.type(screen.getByLabelText("Issue Location *"), "Oak Avenue");
        await user.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(updateIssue).toHaveBeenCalledWith(expect.objectContaining({ id: matchedIssue.id, dateReported: matchedIssue.dateReported, status: matchedIssue.status, location: "Oak Avenue" }));
        expect(screen.getByText("Issue updated successfully.")).toBeInTheDocument();
    });

    test("invalid update is blocked", async () => {
        const user = userEvent.setup();
        const updateIssue = renderEdit();
        await user.clear(screen.getByLabelText("Request Details *"));
        await user.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(updateIssue).not.toHaveBeenCalled();
        expect(screen.getByText("This field is required.")).toBeInTheDocument();
    });

    test("update failure preserves entered values and allows retry", async () => {
        const user = userEvent.setup();
        renderEdit({ updateIssue: vi.fn(() => { throw new Error("write failed"); }) });
        await user.clear(screen.getByLabelText("Issue Location *"));
        await user.type(screen.getByLabelText("Issue Location *"), "Retained value");
        await user.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(screen.getByRole("alert")).toHaveTextContent("could not be updated");
        expect(screen.getByLabelText("Issue Location *")).toHaveValue("Retained value");
    });

    test("Cancel returns to the list without updating", async () => {
        const user = userEvent.setup();
        const updateIssue = renderEdit();
        await user.click(screen.getByRole("link", { name: "Cancel" }));
        expect(updateIssue).not.toHaveBeenCalled();
        expect(screen.getByText("Issue list")).toBeInTheDocument();
    });
});
