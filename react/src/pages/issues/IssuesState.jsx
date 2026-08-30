import { Link } from "react-router-dom";

export function NoIssuesState() {
    return (
        <div className="issues-empty-state" role="status">
            <span className="issues-empty-icon" aria-hidden="true"><i className="bi bi-inbox" /></span>
            <h2 className="h4 mt-3">No issues have been reported yet</h2>
            <p className="text-body-secondary">Reported issues will appear here.</p>
            <Link className="btn btn-primary" to="/report">Report an Issue</Link>
        </div>
    );
}

export function NoMatchesState({ onReset }) {
    return (
        <div className="issues-empty-state" role="status">
            <span className="issues-empty-icon" aria-hidden="true"><i className="bi bi-search" /></span>
            <h2 className="h4 mt-3">No issues match your search or filters</h2>
            <p className="text-body-secondary">Try different criteria or clear the current selections.</p>
            <button className="btn btn-outline-primary" type="button" onClick={onReset}>Clear search and filters</button>
        </div>
    );
}

export function IssuesErrorState() {
    return (
        <div className="alert alert-danger" role="alert">
            <h2 className="h5 alert-heading">Issues could not be loaded</h2>
            <p className="mb-0">Please refresh the page and try again.</p>
        </div>
    );
}
