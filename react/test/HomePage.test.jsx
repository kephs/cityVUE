import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";

import HomePage from "../src/pages/HomePage.jsx";
import PrimaryNavigation from "../src/components/navigation/PrimaryNavigation.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";

function renderHome(issues = [], loadIssues = () => issues) {
    return render(<MemoryRouter><HomePage loadIssues={loadIssues} /></MemoryRouter>);
}

const issues = [
    { id: "older-open", title: "Pothole", category: "Road", location: "1 Main Street", status: "Open", dateReported: "2026-08-20T12:00:00.000Z" },
    { id: "newest-closed", title: "Fallen Tree or Branch", category: "Parks", location: "4 Park Lane", status: "Closed", dateReported: "2026-08-29T12:00:00.000Z" },
    { id: "middle-progress", title: "Streetlight Out", category: "Lighting", location: "3 Oak Avenue", status: "In Progress", dateReported: "2026-08-27T12:00:00.000Z" },
    { id: "second-open", title: "Drainage Concern", category: "Water", location: "2 River Road", status: "Open", dateReported: "2026-08-25T12:00:00.000Z" }
];

describe("HomePage live issue presentation", () => {
    test("keeps Report an Issue and replaces the old shortcuts with callable emergency guidance", () => {
        renderHome();

        expect(screen.getByRole("heading", { name: "Report an Issue" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Report Issue" })).toHaveAttribute("href", "/report");
        expect(screen.getByRole("heading", { name: "Police or Fire Emergency" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
        expect(screen.getByRole("heading", { name: "Water/Sewer Emergency" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Call 240-314-8567" })).toHaveAttribute("href", "tel:2403148567");
        expect(screen.queryByRole("heading", { name: "View Issues" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "View Issue List" })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Open Dashboard" })).not.toBeInTheDocument();
    });

    test("leaves Issue List and Dashboard in the primary navigation", () => {
        render(<ThemeProvider><MemoryRouter><PrimaryNavigation isOpen={false} onNavigate={() => {}} /></MemoryRouter></ThemeProvider>);
        expect(screen.getByRole("link", { name: "Issue List" })).toHaveAttribute("href", "/issues");
        expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    });

    test("renders the real Hero CTA and removes old shortcut UI and ServiceHighlights", () => {
        renderHome();
        const hero = screen.getByRole("region", { name: "CityVUE introduction" });
        expect(within(hero).getByRole("link", { name: "Report a Concern" })).toHaveAttribute("href", "/report");
        expect(screen.queryByText("Track Updates")).not.toBeInTheDocument();
        expect(screen.queryByText("Request Services")).not.toBeInTheDocument();
        expect(screen.queryByText("Stay Connected")).not.toBeInTheDocument();
        expect(document.querySelector(".home-service-highlights")).not.toBeInTheDocument();
    });

    test("shows live total and status counts from supplied Issues", () => {
        renderHome(issues);
        const metrics = screen.getByRole("heading", { name: "Making a Difference Together" }).closest("section");
        expect(within(metrics).getByText("4")).toBeInTheDocument();
        expect(within(metrics).getByText("Total Issues Reported")).toBeInTheDocument();
        expect(within(metrics).getByText("Open Issues").previousElementSibling).toHaveTextContent("2");
        expect(within(metrics).getByText("In Progress").previousElementSibling).toHaveTextContent("1");
        expect(within(metrics).getByText("Closed Issues").previousElementSibling).toHaveTextContent("1");
        expect(screen.queryByText("Avg. Days to Resolve")).not.toBeInTheDocument();
        expect(screen.queryByText("Active Residents Engaged")).not.toBeInTheDocument();
    });

    test("shows accurate zero metrics and a compact empty recent state", () => {
        renderHome();
        const metrics = screen.getByRole("heading", { name: "Making a Difference Together" }).closest("section");
        expect(within(metrics).getAllByText("0")).toHaveLength(4);
        expect(screen.getByText("No issues have been reported yet.")).toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: /Report a Concern/ })).toHaveLength(2);
        expect(screen.getByRole("link", { name: /View All Issues/ })).toHaveAttribute("href", "/issues");
    });

    test("shows the three newest live Issues with safe icons and established edit routes", () => {
        renderHome(issues);
        const recent = screen.getByRole("heading", { name: "Recent Issues" }).closest("section");
        expect(within(recent).getByText("Fallen Tree or Branch")).toBeInTheDocument();
        expect(within(recent).getByText("Streetlight Out")).toBeInTheDocument();
        expect(within(recent).getByText("Drainage Concern")).toBeInTheDocument();
        expect(within(recent).queryByText("Pothole")).not.toBeInTheDocument();
        expect(within(recent).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/issues", "/issues/newest-closed/edit", "/issues/middle-progress/edit", "/issues/second-open/edit"]);
        expect(within(recent).getByText("Fallen Tree or Branch").closest("a").querySelector(".bi-tree")).toBeInTheDocument();
        expect(screen.queryByText("Tree Branch Overhanging Sidewalk")).not.toBeInTheDocument();
        expect(screen.queryByText("Overflowing Trash Bin")).not.toBeInTheDocument();
    });

    test("renders a restrained error without fake metrics when the injected loader throws", () => {
        renderHome([], () => { throw new Error("storage unavailable"); });
        expect(screen.getByRole("alert")).toHaveTextContent("Home issue information could not be loaded");
        expect(screen.queryByRole("heading", { name: "Making a Difference Together" })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Recent Issues" })).not.toBeInTheDocument();
    });
});
