import { Link } from "react-router-dom";

const activities = [
    { icon: "bi-tree", tone: "tree", title: "Tree Branch Overhanging Sidewalk", location: "Woodley Gardens, Rockville, MD", date: "2025-05-18", displayDate: "May 18, 2025", status: "In Progress", statusTone: "progress" },
    { icon: "bi-lamp", tone: "light", title: "Street Light Out", location: "N. Washington St, Rockville, MD", date: "2025-05-17", displayDate: "May 17, 2025", status: "Resolved", statusTone: "resolved" },
    { icon: "bi-trash3", tone: "trash", title: "Overflowing Trash Bin", location: "Town Center Park, Rockville, MD", date: "2025-05-16", displayDate: "May 16, 2025", status: "Submitted", statusTone: "submitted" }
];

export default function RecentActivity() {
    return (
        <section className="home-recent-activity" aria-labelledby="recent-heading">
            <div className="home-recent-header">
                <h2 id="recent-heading"><i className="bi bi-calendar3" aria-hidden="true"></i>Recent Activity</h2>
                <Link to="/issues">View All Issues<i className="bi bi-chevron-right" aria-hidden="true"></i></Link>
            </div>
            <div className="home-activity-list">
                {activities.map((activity) => (
                    <Link className="home-activity-row" to="/issues" key={activity.title}>
                        <div className={`home-activity-icon home-activity-${activity.tone}`} aria-hidden="true">
                            <i className={`bi ${activity.icon}`}></i>
                        </div>
                        <div className="home-activity-details">
                            <strong>{activity.title}</strong>
                            <span>{activity.location}</span>
                        </div>
                        <time dateTime={activity.date}>{activity.displayDate}</time>
                        <span className={`home-status home-status-${activity.statusTone}`}>{activity.status}</span>
                        <i className="bi bi-chevron-right home-row-arrow" aria-hidden="true"></i>
                    </Link>
                ))}
            </div>
        </section>
    );
}
