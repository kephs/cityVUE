import { Link } from "react-router-dom";

const actions = [
    { icon: "bi-flag", tone: "blue", title: "Report an Issue", description: "Quickly submit a new community issue to let us know.", label: "Report Issue", to: "/report" },
    { icon: "bi-shield-fill-exclamation", tone: "emergency", title: "Police or Fire Emergency", description: "If this is a Police or Fire Emergency, call immediately.", phone: "911", label: "Call 911", href: "tel:911" },
    { icon: "bi-droplet-fill", tone: "water", buttonTone: "gold", title: "Water/Sewer Emergency", description: "If this is a Water/Sewer Emergency, call the City immediately.", phone: "240-314-8567", label: "240-314-8567", href: "tel:2403148567" }
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
                    {action.to ? <Link className={`home-button home-button-${action.tone}`} to={action.to}>{action.label}</Link> : <a className={`home-button home-call-button home-button-${action.buttonTone ?? action.tone}`} href={action.href} aria-label={`Call ${action.phone}`}><i className="bi bi-telephone-fill" aria-hidden="true" />{action.label}</a>}
                </article>
            ))}
        </section>
    );
}
