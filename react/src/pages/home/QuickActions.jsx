import { Link } from "react-router-dom";

const actions = [
    { icon: "bi-flag", tone: "blue", title: "Report an Issue", description: "Quickly submit a new community issue to let us know.", label: "Report Issue", to: "/report" },
    { icon: "bi-list-check", tone: "green", title: "View Issues", description: "Browse and search reported issues in your community.", label: "View Issue List", to: "/issues" },
    { icon: "bi-speedometer2", tone: "gold", title: "Dashboard", description: "View statistics and summaries about community issues.", label: "Open Dashboard", to: "/dashboard" }
];

export default function QuickActions() {
    return (
        <section className="home-action-grid" aria-label="Quick actions">
            {actions.map((action) => (
                <article className="home-action-card" key={action.title}>
                    <div className={`home-action-icon home-action-icon-${action.tone}`} aria-hidden="true">
                        <i className={`bi ${action.icon}`}></i>
                    </div>
                    <h2>{action.title}</h2>
                    <p>{action.description}</p>
                    <Link className={`home-button home-button-${action.tone}`} to={action.to}>{action.label}</Link>
                </article>
            ))}
        </section>
    );
}
