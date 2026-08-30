import { Link } from "react-router-dom";
import { getRecentIssues } from "../../../../assets/js/utils/statistics.js";
import { getIssueIcon } from "../issues/issueIconPresentation.js";
import { formatIssueDate, getStatusClassName } from "../issues/issuePresentation.js";

const RECENT_LIMIT = 3;

export default function RecentActivity({ issues }) {
    const recentIssues = getRecentIssues(issues, RECENT_LIMIT);
    return (
        <section className="home-recent-activity" aria-labelledby="recent-heading">
            <div className="home-recent-header">
                <h2 id="recent-heading"><i className="bi bi-clock-history" aria-hidden="true"></i>Recent Issues</h2>
                <Link to="/issues">View All Issues<i className="bi bi-chevron-right" aria-hidden="true"></i></Link>
            </div>
            {recentIssues.length ? <div className="home-activity-list">
                {recentIssues.map((issue, index) => {
                    const displayDate = formatIssueDate(issue.dateReported) || "Date unavailable";
                    const target = issue.id ? `/issues/${encodeURIComponent(String(issue.id))}/edit` : "/issues";
                    return <Link className="home-activity-row" to={target} key={issue.id || `recent-issue-${index}`}>
                        <div className="home-activity-icon" aria-hidden="true">
                            <i className={`bi ${getIssueIcon(issue)}`}></i>
                        </div>
                        <div className="home-activity-details">
                            <strong>{issue.title || "Untitled Issue"}</strong>
                            <span>{issue.location || "Location unavailable"}</span>
                        </div>
                        <time dateTime={issue.dateReported || undefined}>{displayDate}</time>
                        <span className={`badge ${getStatusClassName(issue.status)}`}>{issue.status || "Open"}</span>
                        <i className="bi bi-chevron-right home-row-arrow" aria-hidden="true"></i>
                    </Link>;
                })}
            </div> : <div className="home-recent-empty" role="status"><span className="home-recent-empty-icon" aria-hidden="true"><i className="bi bi-inbox" /></span><div><h3>No issues have been reported yet.</h3><p>When concerns are reported, the newest issues will appear here.</p></div><Link to="/report">Report a Concern<i className="bi bi-arrow-right" aria-hidden="true" /></Link></div>}
        </section>
    );
}
