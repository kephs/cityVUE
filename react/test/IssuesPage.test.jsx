import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

import IssuesPage from "../src/pages/issues/IssuesPage.jsx";

const issues = [
    {
        id: "issue-1",
        title: "Broken Streetlight",
        description: "Lamp flickers after dark",
        category: "Lighting",
        priority: "High",
        status: "Open",
        reportedBy: "Jordan Lee",
        location: "Main Street",
        dateReported: "2026-03-01T12:00:00.000Z"
    },
    {
        id: "issue-2",
        title: "Pothole",
        description: "Deep hole in travel lane",
        category: "Road",
        priority: "Medium",
        status: "In Progress",
        reportedBy: "Casey",
        location: "Oak Avenue",
        dateReported: "2026-01-01T12:00:00.000Z"
    },
    {
        id: "issue-3",
        title: "Overflowing bin",
        description: null,
        category: "Garbage",
        priority: "Low",
        status: "Closed",
        reportedBy: null,
        location: null,
        dateReported: "2026-02-01T12:00:00.000Z"
    }
];

function renderIssuesPage({ initialEntry = "/issues", loadIssues = () => issues } = {}) {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <IssuesPage loadIssues={loadIssues} />
        </MemoryRouter>
    );
}

function renderIssuesPageWithDelete({ deleteIssue = vi.fn(() => true), loadIssues = () => issues } = {}) {
    render(<MemoryRouter initialEntries={["/issues"]}><IssuesPage loadIssues={loadIssues} deleteIssue={deleteIssue} /></MemoryRouter>);
    return deleteIssue;
}

function renderedIssueTitles() {
    return screen.getAllByRole("row").slice(1).map((row) =>
        within(row).getAllByRole("cell")[0].querySelector("strong").textContent
    );
}

describe("IssuesPage", () => {
    test("renders a populated issue list with accessible controls and edit links", () => {
        renderIssuesPage();

        expect(screen.getByRole("heading", { name: "Issue List" })).toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Category" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Sort By" })).toBeInTheDocument();
        expect(screen.getByText("3 issues")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Edit Broken Streetlight" })).toHaveAttribute("href", "/issues/issue-1/edit");
    });

    test("search filters visible issues using the shared Stage 0 semantics", async () => {
        const user = userEvent.setup();
        renderIssuesPage();

        await user.type(screen.getByRole("searchbox", { name: "Search" }), "oak avenue");

        expect(screen.getByText("Pothole")).toBeInTheDocument();
        expect(screen.queryByText("Broken Streetlight")).not.toBeInTheDocument();
        expect(screen.getByText("1 issue")).toBeInTheDocument();
    });

    test("category, priority, status, and search criteria combine", async () => {
        const user = userEvent.setup();
        renderIssuesPage();

        await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Road");
        await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "Medium");
        await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "In Progress");
        await user.type(screen.getByRole("searchbox", { name: "Search" }), "travel lane");

        expect(renderedIssueTitles()).toEqual(["Pothole"]);
    });

    test("changing sort mode changes visible row order", async () => {
        const user = userEvent.setup();
        renderIssuesPage();

        expect(renderedIssueTitles()).toEqual(["Broken Streetlight", "Overflowing bin", "Pothole"]);
        await user.selectOptions(screen.getByRole("combobox", { name: "Sort By" }), "titleDesc");
        expect(renderedIssueTitles()).toEqual(["Pothole", "Overflowing bin", "Broken Streetlight"]);
        await user.selectOptions(screen.getByRole("combobox", { name: "Sort By" }), "priority");
        expect(renderedIssueTitles()).toEqual(["Broken Streetlight", "Pothole", "Overflowing bin"]);
    });

    test("shows a filtered zero-result state and resets the criteria", async () => {
        const user = userEvent.setup();
        renderIssuesPage();

        await user.type(screen.getByRole("searchbox", { name: "Search" }), "does not exist");
        expect(screen.getByRole("heading", { name: "No issues match your search or filters" })).toBeInTheDocument();

        const clearButtons = screen.getAllByRole("button", { name: "Clear search and filters" });
        await user.click(clearButtons.at(-1));
        expect(screen.getByText("3 issues")).toBeInTheDocument();
        expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    });

    test("honors query and hash URL filter compatibility", () => {
        renderIssuesPage({ initialEntry: "/issues?status=Open#status=Closed&category=Garbage" });

        expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("Closed");
        expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Garbage");
        expect(renderedIssueTitles()).toEqual(["Overflowing bin"]);
    });

    test("distinguishes an empty collection from filtered zero results", () => {
        renderIssuesPage({ loadIssues: () => [] });

        expect(screen.getByRole("heading", { name: "No issues have been reported yet" })).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    test("contains thrown read failures without crashing the shell content", () => {
        renderIssuesPage({ loadIssues: () => { throw new Error("storage unavailable"); } });

        expect(screen.getByRole("alert")).toHaveTextContent("Issues could not be loaded");
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    test("Delete opens an accessible confirmation and Cancel restores focus without deleting", async () => {
        const user = userEvent.setup();
        const deleteIssue = renderIssuesPageWithDelete();
        const trigger = screen.getByRole("button", { name: "Delete Pothole" });
        await user.click(trigger);
        const dialog = screen.getByRole("dialog", { name: "Delete issue?" });
        expect(dialog).toHaveAttribute("aria-describedby", "delete-dialog-description");
        expect(within(dialog).getByText(/This action cannot be undone/)).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(deleteIssue).not.toHaveBeenCalled();
        expect(trigger).toHaveFocus();
    });

    test("confirm calls delete once, removes the Issue, and announces success", async () => {
        const user = userEvent.setup();
        const deleteIssue = renderIssuesPageWithDelete();
        await user.click(screen.getByRole("button", { name: "Delete Pothole" }));
        await user.click(screen.getByRole("button", { name: "Delete Issue" }));
        expect(deleteIssue).toHaveBeenCalledTimes(1);
        expect(deleteIssue).toHaveBeenCalledWith("issue-2");
        expect(screen.queryByText("Pothole")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Issue deleted successfully.");
    });

    test("delete failure preserves the Issue and provides retry feedback", async () => {
        const user = userEvent.setup();
        const deleteIssue = renderIssuesPageWithDelete({ deleteIssue: vi.fn(() => { throw new Error("failed"); }) });
        await user.click(screen.getByRole("button", { name: "Delete Pothole" }));
        await user.click(screen.getByRole("button", { name: "Delete Issue" }));
        expect(screen.getByRole("link", { name: "Edit Pothole" })).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("could not be deleted");
        expect(deleteIssue).toHaveBeenCalledTimes(1);
    });

    test("deleting under an active filter preserves filters and shows the filtered empty state", async () => {
        const user = userEvent.setup();
        renderIssuesPageWithDelete();
        await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Road");
        await user.selectOptions(screen.getByRole("combobox", { name: "Sort By" }), "titleDesc");
        await user.click(screen.getByRole("button", { name: "Delete Pothole" }));
        await user.click(screen.getByRole("button", { name: "Delete Issue" }));
        expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("Road");
        expect(screen.getByRole("combobox", { name: "Sort By" })).toHaveValue("titleDesc");
        expect(screen.getByRole("heading", { name: "No issues match your search or filters" })).toBeInTheDocument();
    });

    test("deleting the only Issue shows the collection empty state", async () => {
        const user = userEvent.setup();
        renderIssuesPageWithDelete({ loadIssues: () => [issues[1]] });
        await user.click(screen.getByRole("button", { name: "Delete Pothole" }));
        await user.click(screen.getByRole("button", { name: "Delete Issue" }));
        expect(screen.getByRole("heading", { name: "No issues have been reported yet" })).toBeInTheDocument();
    });
});
