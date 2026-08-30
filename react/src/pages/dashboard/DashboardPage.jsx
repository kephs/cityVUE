import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { getCategoryCounts, getPriorityCounts, getRecentIssues, getStatusCounts, getTotalIssues } from "../../../../assets/js/utils/statistics.js";
import IssueService from "../../../../assets/services/IssueService.js";
import { formatIssueDate, getStatusClassName } from "../issues/issuePresentation.js";
import DashboardChart from "./DashboardChart.jsx";
import "./dashboard.css";

const RECENT_LIMIT = 5;

export function buildDashboardFilterTarget(filter, value) {
    return `/issues?${filter}=${encodeURIComponent(value)}`;
}

function SummaryCard({ label, value, icon, tone, to }) {
    return <Link className="dashboard-stat-link" to={to} aria-label={`View ${label.toLowerCase()}`}><article className={`dashboard-stat-card dashboard-stat-${tone}`}><span className="dashboard-stat-icon" aria-hidden="true"><i className={`bi ${icon}`} /></span><div><p className="dashboard-stat-value">{value}</p><h2>{label}</h2></div><i className="bi bi-arrow-up-right dashboard-stat-arrow" aria-hidden="true" /></article></Link>;
}

function recentIssueIcon(category) {
    const value = String(category || "").toLowerCase();
    if (value.includes("road")) return "bi-signpost-split";
    if (value.includes("light")) return "bi-lightbulb";
    if (value.includes("water")) return "bi-droplet";
    if (value.includes("garbage")) return "bi-recycle";
    if (value.includes("park")) return "bi-tree";
    return "bi-file-earmark-text";
}

export default function DashboardPage({ loadIssues = () => IssueService.getIssues() }) {
    const navigate = useNavigate();
    const navigateToStatus = useCallback((index) => navigate(buildDashboardFilterTarget("status", ["Open", "In Progress", "Closed"][index])), [navigate]);
    const navigateToPriority = useCallback((index) => navigate(buildDashboardFilterTarget("priority", ["High", "Medium", "Low"][index])), [navigate]);
    const [readState] = useState(() => { try { const issues = loadIssues(); return { issues: Array.isArray(issues) ? issues : [], error: false }; } catch { return { issues: [], error: true }; } });
    const issues = readState.issues;
    const status = getStatusCounts(issues);
    const priority = getPriorityCounts(issues);
    const categoryEntries = Object.entries(getCategoryCounts(issues));
    const categoryNames = categoryEntries.map(([name]) => name).join("\u0000");
    const navigateToCategory = useCallback((index) => {
        const category = categoryNames.split("\u0000")[index];
        if (category) navigate(buildDashboardFilterTarget("category", category));
    }, [navigate, categoryNames]);
    if (readState.error) return <section aria-labelledby="dashboard-heading"><h1 id="dashboard-heading">Dashboard</h1><div className="alert alert-danger" role="alert"><h2 className="h5 alert-heading">Dashboard information could not be loaded</h2><p className="mb-0">Please refresh the page and try again.</p></div></section>;

    if (!issues.length) return <section className="dashboard-page" aria-labelledby="dashboard-heading"><header className="dashboard-header"><div><p className="dashboard-eyebrow">City Operations Overview</p><h1 id="dashboard-heading">Dashboard</h1><p className="text-body-secondary mb-0">Monitor reported issues and current service-request trends.</p></div></header><div className="dashboard-empty" role="status"><span className="dashboard-empty-icon" aria-hidden="true"><i className="bi bi-bar-chart" /></span><h2 className="h4 mt-3">No issue data to summarize yet</h2><p className="text-body-secondary">Report an issue to begin building the CityVUE overview.</p><Link className="btn btn-primary" to="/report">Report an Issue</Link></div></section>;

    const recent = getRecentIssues(issues, RECENT_LIMIT);

    return <section className="dashboard-page" aria-labelledby="dashboard-heading">
        <header className="dashboard-header"><div><p className="dashboard-eyebrow">City Operations Overview</p><h1 id="dashboard-heading">Dashboard</h1><p className="text-body-secondary mb-0">Monitor reported issues and current service-request trends.</p></div><div className="dashboard-header-actions"><Link className="btn btn-primary" to="/report"><i className="bi bi-plus-circle me-2" aria-hidden="true" />Report Issue</Link><Link className="btn btn-outline-primary" to="/issues"><i className="bi bi-list-check me-2" aria-hidden="true" />View All Issues</Link></div></header>
        <section aria-label="Issue status statistics" className="dashboard-summary-grid"><SummaryCard label="Total Issues" value={getTotalIssues(issues)} icon="bi-collection" tone="total" to="/issues" /><SummaryCard label="Open Issues" value={status.open} icon="bi-folder2-open" tone="open" to="/issues?status=Open" /><SummaryCard label="In Progress Issues" value={status.inProgress} icon="bi-arrow-repeat" tone="progress" to="/issues?status=In%20Progress" /><SummaryCard label="Closed Issues" value={status.closed} icon="bi-check-circle" tone="closed" to="/issues?status=Closed" /></section>
        <section className="dashboard-priority-panel" aria-labelledby="priority-summary-heading"><div className="dashboard-priority-heading"><span className="dashboard-section-icon" aria-hidden="true"><i className="bi bi-flag" /></span><div><h2 id="priority-summary-heading">Priority Overview</h2><p>Current issues grouped by reported priority.</p></div></div><div className="dashboard-priority-grid" aria-label="Issue priority statistics"><Link aria-label={`High Priority: ${priority.high}`} className="dashboard-priority high" to="/issues?priority=High"><span><i aria-hidden="true" />High</span><strong>{priority.high}</strong></Link><Link aria-label={`Medium Priority: ${priority.medium}`} className="dashboard-priority medium" to="/issues?priority=Medium"><span><i aria-hidden="true" />Medium</span><strong>{priority.medium}</strong></Link><Link aria-label={`Low Priority: ${priority.low}`} className="dashboard-priority low" to="/issues?priority=Low"><span><i aria-hidden="true" />Low</span><strong>{priority.low}</strong></Link></div></section>
        <section className="dashboard-chart-grid" aria-label="Status and priority charts"><article className="dashboard-panel"><div className="dashboard-panel-header"><h2><i className="bi bi-pie-chart me-2" aria-hidden="true" />Status Overview</h2></div><div className="dashboard-chart"><DashboardChart type="doughnut" labels={["Open", "In Progress", "Closed"]} values={[status.open, status.inProgress, status.closed]} label="Issues by status" onDataClick={navigateToStatus} /></div><p className="visually-hidden">Open: {status.open}. In Progress: {status.inProgress}. Closed: {status.closed}.</p><nav className="dashboard-chart-access-links" aria-label="Status chart drill-down">{[["Open", status.open], ["In Progress", status.inProgress], ["Closed", status.closed]].map(([name, count]) => <Link key={name} to={buildDashboardFilterTarget("status", name)}>View {name} issues <span className="visually-hidden">({count})</span></Link>)}</nav></article><article className="dashboard-panel"><div className="dashboard-panel-header"><h2><i className="bi bi-bar-chart me-2" aria-hidden="true" />Priority Overview</h2></div><div className="dashboard-chart"><DashboardChart type="pie" labels={["High", "Medium", "Low"]} values={[priority.high, priority.medium, priority.low]} label="Issues by priority" onDataClick={navigateToPriority} /></div><p className="visually-hidden">High: {priority.high}. Medium: {priority.medium}. Low: {priority.low}.</p><nav className="dashboard-chart-access-links" aria-label="Priority chart drill-down">{[["High", priority.high], ["Medium", priority.medium], ["Low", priority.low]].map(([name, count]) => <Link key={name} to={buildDashboardFilterTarget("priority", name)}>View {name} Priority issues <span className="visually-hidden">({count})</span></Link>)}</nav></article></section>
        <section className="dashboard-panel mb-4" aria-labelledby="category-chart-heading"><div className="dashboard-panel-header"><h2 id="category-chart-heading"><i className="bi bi-bar-chart-steps me-2" aria-hidden="true" />Issues by Category</h2></div><div className="dashboard-category-layout"><div className="dashboard-category-chart"><DashboardChart type="bar" labels={categoryEntries.map(([name]) => name)} values={categoryEntries.map(([, count]) => count)} label="Number of issues" onDataClick={navigateToCategory} /></div><dl className="dashboard-category-list" aria-label="Category chart data">{categoryEntries.map(([name, count]) => <div key={name}><dt><Link aria-label={`View ${name} issues`} to={buildDashboardFilterTarget("category", name)}>{name}</Link></dt><dd>{count}</dd></div>)}</dl></div></section>
        <section className="dashboard-panel dashboard-recent-panel" aria-labelledby="recent-issues-heading"><div className="dashboard-panel-header"><h2 id="recent-issues-heading"><i className="bi bi-clock-history me-2" aria-hidden="true" />Recent Issues</h2><Link className="dashboard-view-all" to="/issues">View All Issues<i className="bi bi-chevron-right" aria-hidden="true" /></Link></div><ul className="dashboard-recent-list">{recent.map((issue, index) => <li key={issue.id || `recent-${index}`}><Link className="dashboard-recent-item" to={`/issues/${encodeURIComponent(String(issue.id || ""))}/edit`}><span className="dashboard-recent-icon" aria-hidden="true"><i className={`bi ${recentIssueIcon(issue.category)}`} /></span><span className="dashboard-recent-copy"><strong>{issue.title || "Untitled Issue"}</strong><span>{issue.category || "Uncategorized"} · {formatIssueDate(issue.dateReported) || "Date unavailable"}</span></span><span className={`badge ${getStatusClassName(issue.status)}`}>{issue.status || "Open"}</span><i className="bi bi-chevron-right dashboard-recent-arrow" aria-hidden="true" /></Link></li>)}</ul></section>
    </section>;
}
