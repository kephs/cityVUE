import { Link } from "react-router-dom";

import IssueStatusBadge from "./IssueStatusBadge.jsx";
import { getIssueIcon } from "./issueIconPresentation.js";
import { formatIssueDate } from "./issuePresentation.js";

function displayValue(value) {
    return String(value || "");
}

export default function IssueRow({ issue, onDelete, apiMode = false }) {
    const issueId = displayValue(issue.id);

    return (
        <tr className="issue-row">
            {apiMode && <td data-label="Reference"><code className="issue-reference">{issue.referenceNumber}</code></td>}
            <td className="issue-title-cell" data-label="Issue"><span className="issue-row-icon" aria-hidden="true"><i className={`bi ${getIssueIcon(issue)}`} /></span><span className="issue-title-copy">{apiMode ? <Link to={`/issues/${encodeURIComponent(issueId)}`} aria-label={`View details for ${issue.issueName}`}>{issue.issueName}</Link> : <strong>{displayValue(issue.title) || "Untitled Issue"}</strong>}{!apiMode && <small>{displayValue(issue.location) || "Location unavailable"}</small>}</span></td>
            {apiMode && <td data-label="Department"><strong>{issue.department.name}</strong>{issue.division && <small className="d-block text-body-secondary">{issue.division.name}</small>}</td>}
            <td data-label="Category">{apiMode ? issue.category.name : displayValue(issue.category)}</td>
            <td data-label="Priority"><span className={`issue-priority priority-${displayValue(issue.priority).toLowerCase()}`}><i aria-hidden="true" />{displayValue(issue.priority)}</span></td>
            <td data-label="Status"><IssueStatusBadge status={issue.status} /></td>
            {!apiMode && <td data-label="Reported By">{displayValue(issue.reportedBy)}</td>}
            <td data-label="Date">{formatIssueDate(apiMode ? issue.reportedAt : issue.dateReported)}</td>
            {!apiMode && <td className="issue-actions-cell" data-label="Actions"><div className="issue-row-actions">
                <Link className="btn btn-sm btn-outline-primary" to={`/issues/${encodeURIComponent(issueId)}/edit`} aria-label={`Edit ${displayValue(issue.title) || "issue"}`}>
                    <i className="bi bi-pencil me-1" aria-hidden="true"></i>Edit
                </Link>
                <button className="btn btn-sm btn-outline-danger" type="button" onClick={(event) => onDelete(issue, event.currentTarget)} aria-label={`Delete ${displayValue(issue.title) || "issue"}`}><i className="bi bi-trash me-1" aria-hidden="true" />Delete</button>
            </div></td>}
        </tr>
    );
}
