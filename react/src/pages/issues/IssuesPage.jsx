import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { filterIssues, getIssueFiltersFromUrl } from "../../../../assets/js/utils/issueFilters.js";
import { sortIssues } from "../../../../assets/js/utils/issueSort.js";
import IssueService from "../../../../assets/services/IssueService.js";
import IssueFilters from "./IssueFilters.jsx";
import IssueTable from "./IssueTable.jsx";
import DeleteIssueDialog from "./DeleteIssueDialog.jsx";
import { IssuesErrorState, NoIssuesState, NoMatchesState } from "./IssuesState.jsx";
import "./issues.css";

const emptyFilters = { search: "", category: "", priority: "", status: "" };

export default function IssuesPage({ loadIssues = () => IssueService.getIssues(), deleteIssue = (id) => IssueService.deleteIssue(id) }) {
    const location = useLocation();
    const urlFilters = useMemo(
        () => getIssueFiltersFromUrl(location.search, location.hash),
        [location.search, location.hash]
    );
    const [filters, setFilters] = useState({ ...emptyFilters, ...urlFilters });
    const [sortBy, setSortBy] = useState("newest");
    const [readState, setReadState] = useState(() => {
        try {
            const issues = loadIssues();
            return { issues: Array.isArray(issues) ? issues : [], error: false };
        } catch {
            return { issues: [], error: true };
        }
    });
    const [notice, setNotice] = useState(location.state?.notice || "");
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteError, setDeleteError] = useState("");
    const [deleting, setDeleting] = useState(false);
    const deleteTriggerRef = useRef(null);

    useEffect(() => {
        setFilters((current) => ({ ...current, ...urlFilters }));
    }, [urlFilters]);

    const visibleIssues = useMemo(
        () => sortIssues(filterIssues(readState.issues, filters), sortBy),
        [readState.issues, filters, sortBy]
    );
    const hasActiveFilters = Object.values(filters).some(Boolean);
    const resetFilters = () => setFilters(emptyFilters);
    const cancelDelete = useCallback(() => {
        if (deleting) return;
        setDeleteTarget(null);
        setDeleteError("");
    }, [deleting]);
    const openDelete = (issue, trigger) => {
        deleteTriggerRef.current = trigger;
        setDeleteError("");
        setDeleteTarget(issue);
    };
    const confirmDelete = () => {
        if (!deleteTarget || deleting) return;
        setDeleting(true);
        setDeleteError("");
        try {
            if (!deleteIssue(deleteTarget.id)) throw new Error("not deleted");
            setReadState((current) => ({ ...current, issues: current.issues.filter((issue) => issue.id !== deleteTarget.id) }));
            setNotice("Issue deleted successfully.");
            setDeleteTarget(null);
        } catch {
            setDeleteError("The issue could not be deleted. Please try again.");
        } finally {
            setDeleting(false);
        }
    };

    if (readState.error) {
        return (
            <section aria-labelledby="issues-heading">
                <h1 className="mb-2" id="issues-heading">Issue List</h1>
                <p className="text-body-secondary mb-4">Search, review, and manage reported community issues.</p>
                <IssuesErrorState />
            </section>
        );
    }

    return (
        <section className="issues-page" aria-labelledby="issues-heading">
            {notice && (
                <div className="alert alert-success" role="status">
                    {notice}
                </div>
            )}
            <header className="issues-header">
                <div className="issues-header-icon" aria-hidden="true"><i className="bi bi-list-check" /></div>
                <div><p className="issues-eyebrow">Community Operations</p><h1 id="issues-heading">Issue List</h1>
                <p className="text-body-secondary mb-0">Search, review, and manage reported community issues.</p></div>
            </header>
            <IssueFilters
                filters={filters}
                sortBy={sortBy}
                hasActiveFilters={hasActiveFilters}
                onFilterChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
                onSortChange={setSortBy}
                onReset={resetFilters}
            />
            <section className="card border-0 shadow-sm overflow-hidden" aria-labelledby="reported-issues-heading">
                <div className="card-header bg-body d-flex flex-column flex-sm-row justify-content-between align-items-sm-center gap-2 py-3">
                    <div>
                        <h2 className="h5 fw-bold mb-1" id="reported-issues-heading">Reported Issues</h2>
                        <p className="text-body-secondary small mb-0">Edit an issue or delete one with confirmation.</p>
                    </div>
                    <span className="issues-result-count" aria-live="polite">{visibleIssues.length} {visibleIssues.length === 1 ? "issue" : "issues"}</span>
                </div>
                {readState.issues.length === 0
                    ? <NoIssuesState />
                    : visibleIssues.length === 0
                        ? <NoMatchesState onReset={resetFilters} />
                        : <IssueTable issues={visibleIssues} onDelete={openDelete} />}
            </section>
            <DeleteIssueDialog issue={deleteTarget} error={deleteError} deleting={deleting} onCancel={cancelDelete} onConfirm={confirmDelete} returnFocusRef={deleteTriggerRef} />
        </section>
    );
}
