import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const chartMocks = vi.hoisted(() => {
    const destroy = vi.fn();
    const Chart = vi.fn(function Chart() { this.destroy = destroy; });
    return { destroy, Chart };
});
vi.mock("chart.js/auto", () => ({ default: chartMocks.Chart }));

import DashboardPage, { buildDashboardFilterTarget } from "../src/pages/dashboard/DashboardPage.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";

const issues = [
    { id: "old", title: "Old Road Issue", category: "Road", priority: "High", status: "Open", reportedBy: "A", location: "One", dateReported: "2025-01-01T00:00:00.000Z" },
    { id: "new", title: "Newest Light Issue", category: "Lighting", priority: "Medium", status: "In Progress", reportedBy: "B", location: "Two", dateReported: "2026-05-01T00:00:00.000Z" },
    { id: "closed", title: "Closed Bin", category: "Garbage", priority: "Low", status: "Closed", reportedBy: "C", location: "Three", dateReported: "2026-04-01T00:00:00.000Z" },
    { id: "road-2", title: "Second Road Issue", category: "Road", priority: "High", status: "Open", dateReported: "2026-03-01T00:00:00.000Z" },
    { id: "partial", title: "Partial Issue", category: null, priority: null, status: null, dateReported: "invalid" },
    { id: "sixth", title: "Sixth Recent Candidate", category: "Water", priority: "Medium", status: "Open", dateReported: "2026-02-01T00:00:00.000Z" }
];

function LocationProbe() {
    const location = useLocation();
    return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

function renderDashboard(loadIssues = () => issues) {
    return render(<ThemeProvider><MemoryRouter><DashboardPage loadIssues={loadIssues} /><LocationProbe /></MemoryRouter></ThemeProvider>);
}

describe("DashboardPage", () => {
    beforeEach(() => { chartMocks.Chart.mockClear(); chartMocks.destroy.mockClear(); });

    test("renders populated status and priority parity metrics", () => {
        renderDashboard();
        expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
        expect(screen.getByLabelText("View total issues")).toHaveTextContent("6");
        expect(screen.getByLabelText("View open issues")).toHaveTextContent("3");
        expect(screen.getByLabelText("View in progress issues")).toHaveTextContent("1");
        expect(screen.getByLabelText("View closed issues")).toHaveTextContent("1");
        expect(screen.getByRole("link", { name: "High Priority: 2" })).toHaveTextContent("2");
    });

    test("renders category summary with compatible Issue List links", () => {
        renderDashboard();
        const categoryData = screen.getByLabelText("Category chart data");
        expect(within(categoryData).getByRole("link", { name: "View Road issues" })).toHaveAttribute("href", "/issues?category=Road");
        expect(within(categoryData).getByText("2")).toBeInTheDocument();
        expect(within(categoryData).getByRole("link", { name: "View Uncategorized issues" })).toHaveAttribute("href", "/issues?category=Uncategorized");
    });

    test("renders informational Department counts and includes unmatched Issues", () => {
        renderDashboard();
        const departmentSection = screen.getByRole("heading", { name: "Issues by Department" }).closest("section");
        const departmentData = within(departmentSection).getByLabelText("Department chart data");

        expect(within(departmentData).getByText("Public Works")).toBeInTheDocument();
        expect(within(departmentData).getByLabelText("4 issues")).toHaveTextContent("4");
        expect(within(departmentData).getByText("Environmental Services").closest("div")).toHaveTextContent("1");
        expect(within(departmentData).getByText("Unassigned Department").closest("div")).toHaveTextContent("1");
        expect(within(departmentData).queryByRole("link")).not.toBeInTheDocument();

        const departmentChart = chartMocks.Chart.mock.calls[3][1];
        expect(departmentChart.data.labels).toEqual(["Public Works", "Environmental Services", "Unassigned Department"]);
        expect(departmentChart.data.datasets[0].data).toEqual([4, 1, 1]);
        expect(departmentChart.options.indexAxis).toBe("y");
        expect(departmentChart.options.onClick).toBeUndefined();
    });

    test("recent issues use existing newest-first ordering and five-item limit", () => {
        renderDashboard();
        const list = screen.getByRole("heading", { name: "Recent Issues" }).closest("section");
        const links = within(list)
            .getAllByRole("link")
            .filter((link) => !link.textContent.includes("View All Issues"));
        expect(links).toHaveLength(5);
        expect(links[0]).toHaveTextContent("Newest Light Issue");
        expect(within(list).queryByText("Partial Issue")).not.toBeInTheDocument();
    });

    test("hides status and priority chips while retaining accessible drill-down links", () => {
        renderDashboard();
        expect(screen.getByText("Open: 3. In Progress: 1. Closed: 1.")).toBeInTheDocument();
        expect(screen.getByText("High: 2. Medium: 2. Low: 1.")).toBeInTheDocument();
        expect(document.querySelector(".dashboard-chart-links")).not.toBeInTheDocument();
        expect(screen.getByRole("navigation", { name: "Status chart drill-down" })).toHaveClass("dashboard-chart-access-links");
        expect(screen.getByRole("navigation", { name: "Priority chart drill-down" })).toHaveClass("dashboard-chart-access-links");
        expect(screen.getByRole("link", { name: /View Open issues/ })).toHaveAttribute("href", "/issues?status=Open");
        expect(screen.getByRole("link", { name: /View Medium Priority issues/ })).toHaveAttribute("href", "/issues?priority=Medium");
        expect(screen.getByLabelText("Category chart data")).toBeInTheDocument();
    });

    test("chart callback boundaries navigate to the existing Issue List filters", () => {
        renderDashboard();
        act(() => chartMocks.Chart.mock.calls[0][1].options.onClick({}, [{ index: 0 }]));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/issues?status=Open");
        act(() => chartMocks.Chart.mock.calls[1][1].options.onClick({}, [{ index: 1 }]));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/issues?priority=Medium");
    });

    test("category targets safely encode stored category values", () => {
        expect(buildDashboardFilterTarget("category", "Road & Bridge / North")).toBe("/issues?category=Road%20%26%20Bridge%20%2F%20North");
        renderDashboard(() => [{ ...issues[0], category: "Road & Bridge / North" }]);
        act(() => chartMocks.Chart.mock.calls[2][1].options.onClick({}, [{ index: 0 }]));
        expect(screen.getByLabelText("Current route")).toHaveTextContent("/issues?category=Road%20%26%20Bridge%20%2F%20North");
    });

    test("renders useful empty state without charts", () => {
        renderDashboard(() => []);
        expect(screen.getByRole("heading", { name: "No issue data to summarize yet" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Report an Issue" })).toHaveAttribute("href", "/report");
        expect(chartMocks.Chart).not.toHaveBeenCalled();
    });

    test("contains retrieval failure without fabricated statistics", () => {
        renderDashboard(() => { throw new Error("storage failed"); });
        expect(screen.getByRole("alert")).toHaveTextContent("Dashboard information could not be loaded");
        expect(screen.queryByLabelText("View total issues")).not.toBeInTheDocument();
    });

    test("creates four chart instances and destroys them on unmount", () => {
        const view = renderDashboard();
        expect(chartMocks.Chart).toHaveBeenCalledTimes(4);
        view.unmount();
        expect(chartMocks.destroy).toHaveBeenCalledTimes(4);
    });
});
