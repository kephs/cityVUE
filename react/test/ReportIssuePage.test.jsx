import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import ReportIssuePage from "../src/pages/report/ReportIssuePage.jsx";

function renderPage(props = {}) {
    return render(<MemoryRouter initialEntries={["/report"]}><Routes><Route path="/report" element={<ReportIssuePage {...props} />} /><Route path="/issues" element={<div role="status">Issue submitted successfully.</div>} /></Routes></MemoryRouter>);
}

async function selectPothole(user) {
    await user.click(screen.getByRole("radio", { name: /Roads & Streets/ }));
    await user.click(screen.getByRole("radio", { name: /Pothole/ }));
}

async function reachPotholeDetails(user) {
    await selectPothole(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function completeAnonymousDetails(user, blocked = "no") {
    await user.selectOptions(screen.getByLabelText("Is the roadway blocked? *"), blocked);
    if (blocked === "yes") await user.type(screen.getByLabelText("Describe how the roadway is blocked *"), "One lane is blocked");
    await user.type(screen.getByLabelText("Tell us more about the concern *"), "Large pothole near the intersection.");
    await user.type(screen.getByLabelText("Location *"), "Main Street");
}

describe("ReportIssuePage configuration-driven intake", () => {
    test("renders active fixture Categories without exposing Departments", () => {
        renderPage();
        expect(screen.getByRole("radio", { name: /Roads & Streets/ })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: /Trash & Recycling/ })).toBeInTheDocument();
        expect(screen.queryByText("Public Works")).not.toBeInTheDocument();
        expect(screen.queryByText("Environmental Services")).not.toBeInTheDocument();
    });

    test("Category selection filters Services and changing Category clears selection", async () => {
        const user = userEvent.setup(); renderPage();
        await selectPothole(user);
        expect(screen.getByRole("radio", { name: /Damaged Street Sign/ })).toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: /Streetlights/ }));
        expect(screen.getByRole("radio", { name: /Streetlight Out/ })).toBeInTheDocument();
        expect(screen.queryByRole("radio", { name: /Pothole/ })).not.toBeInTheDocument();
    });

    test("live search supports aliases and a clear zero-result state", async () => {
        const user = userEvent.setup(); renderPage();
        await user.click(screen.getByRole("radio", { name: /Roads & Streets/ }));
        const search = screen.getByRole("searchbox", { name: "Search services" });
        await user.type(search, "hole in road");
        expect(screen.getByRole("radio", { name: /Pothole/ })).toBeInTheDocument();
        expect(screen.queryByRole("radio", { name: /Damaged Street Sign/ })).not.toBeInTheDocument();
        await user.clear(search); await user.type(search, "no such service");
        expect(screen.getByRole("heading", { name: "No matching services found." })).toBeInTheDocument();
    });

    test("renders configured questions and validates required visible questions", async () => {
        const user = userEvent.setup(); renderPage(); await reachPotholeDetails(user);
        expect(screen.getByLabelText("Approximate size in feet")).toHaveAttribute("type", "number");
        expect(screen.getByLabelText("Is the roadway blocked? *")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Review request" }));
        expect(screen.getByLabelText("Is the roadway blocked? *")).toHaveAccessibleErrorMessage("This question is required.");
    });

    test("conditional questions show and hide while clearing stale answers", async () => {
        const user = userEvent.setup(); renderPage(); await reachPotholeDetails(user);
        const blocked = screen.getByLabelText("Is the roadway blocked? *");
        await user.selectOptions(blocked, "yes");
        const details = screen.getByLabelText("Describe how the roadway is blocked *");
        await user.type(details, "Stale answer");
        await user.selectOptions(blocked, "no");
        expect(screen.queryByLabelText("Describe how the roadway is blocked *")).not.toBeInTheDocument();
        await user.type(screen.getByLabelText("Tell us more about the concern *"), "Concern");
        await user.type(screen.getByLabelText("Location *"), "Main Street");
        await user.click(screen.getByRole("button", { name: "Review request" }));
        expect(screen.queryByText("Stale answer")).not.toBeInTheDocument();
    });

    test("changing Service clears old answers", async () => {
        const user = userEvent.setup(); renderPage(); await reachPotholeDetails(user);
        await user.type(screen.getByLabelText("Approximate size in feet"), "3");
        await user.click(screen.getByRole("button", { name: "Back" }));
        await user.click(screen.getByRole("radio", { name: /Damaged Street Sign/ }));
        await user.click(screen.getByRole("radio", { name: /Pothole/ }));
        await user.click(screen.getByRole("button", { name: "Continue" }));
        expect(screen.getByLabelText("Approximate size in feet")).toHaveValue(null);
    });

    test("anonymous needs no name while identified reporting requires it", async () => {
        const user = userEvent.setup(); renderPage(); await reachPotholeDetails(user); await completeAnonymousDetails(user);
        expect(screen.queryByLabelText("Your name *")).not.toBeInTheDocument();
        await user.click(screen.getByRole("radio", { name: "Provide my name" }));
        await user.click(screen.getByRole("button", { name: "Review request" }));
        expect(screen.getByLabelText("Your name *")).toHaveAccessibleErrorMessage("Enter your name.");
    });

    test("review summarizes values and Back preserves relevant state", async () => {
        const user = userEvent.setup(); renderPage(); await reachPotholeDetails(user); await completeAnonymousDetails(user, "yes");
        await user.click(screen.getByRole("button", { name: "Review request" }));
        expect(screen.getByRole("heading", { name: "Review Your Request" })).toBeInTheDocument();
        expect(screen.getByText("Large pothole near the intersection.")).toBeInTheDocument();
        expect(screen.getByText("Reporting anonymously")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Back / Edit" }));
        expect(screen.getByLabelText("Tell us more about the concern *")).toHaveValue("Large pothole near the intersection.");
    });

    test("submits the exact compatibility payload once and navigates successfully", async () => {
        const user = userEvent.setup(); const saveIssue = vi.fn(); renderPage({ saveIssue, createTimestamp: () => "2026-08-29T18:00:00.000Z" }); await reachPotholeDetails(user); await completeAnonymousDetails(user);
        await user.click(screen.getByRole("button", { name: "Review request" }));
        await user.dblClick(screen.getByRole("button", { name: "Submit Request" }));
        expect(saveIssue).toHaveBeenCalledTimes(1);
        expect(saveIssue).toHaveBeenCalledWith({ title: "Pothole", description: "Resident description:\nLarge pothole near the intersection.\n\nAdditional details:\n- Is the roadway blocked?: No", category: "Road", priority: "Medium", status: "Open", reportedBy: "Anonymous", location: "Main Street", dateReported: "2026-08-29T18:00:00.000Z" });
        expect(screen.getByRole("status")).toHaveTextContent("Issue submitted successfully.");
    });

    test("save failure preserves review state and allows retry", async () => {
        const user = userEvent.setup(); const consoleError = vi.spyOn(console, "error").mockImplementation(() => {}); const saveIssue = vi.fn().mockImplementationOnce(() => { throw new Error("quota"); }); renderPage({ saveIssue }); await reachPotholeDetails(user); await completeAnonymousDetails(user);
        await user.click(screen.getByRole("button", { name: "Review request" }));
        await user.click(screen.getByRole("button", { name: "Submit Request" }));
        expect(screen.getByRole("alert")).toHaveTextContent("The issue could not be saved");
        expect(screen.getByText("Large pothole near the intersection.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Submit Request" }));
        expect(saveIssue).toHaveBeenCalledTimes(2);
        consoleError.mockRestore();
    });
});
