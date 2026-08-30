import { getStatusClassName } from "./issuePresentation.js";

export default function IssueStatusBadge({ status }) {
    const displayStatus = status || "Open";
    return <span className={`badge ${getStatusClassName(status)}`}>{displayStatus}</span>;
}
