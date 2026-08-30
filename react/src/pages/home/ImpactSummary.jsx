import { getStatusCounts, getTotalIssues } from "../../../../assets/js/utils/statistics.js";

export default function ImpactSummary({ issues }) {
    const status = getStatusCounts(issues);
    const statistics = [
        { icon: "bi-clipboard2-data", tone: "blue", value: getTotalIssues(issues), label: "Total Issues Reported" },
        { icon: "bi-folder2-open", tone: "green", value: status.open, label: "Open Issues" },
        { icon: "bi-arrow-repeat", tone: "orange", value: status.inProgress, label: "In Progress" },
        { icon: "bi-check-circle", tone: "purple", value: status.closed, label: "Closed Issues" }
    ];
    return (
        <section className="home-impact-panel" aria-labelledby="impact-heading">
            <header className="home-section-heading">
                <h2 id="impact-heading">Making a Difference Together</h2>
                <p>Your reports help us build a better Rockville.</p>
            </header>
            <div className="home-statistics-grid">
                {statistics.map((statistic) => (
                    <article className="home-statistic" key={statistic.label}>
                        <div className={`home-statistic-icon home-stat-${statistic.tone}`} aria-hidden="true">
                            <i className={`bi ${statistic.icon}`}></i>
                        </div>
                        <div>
                            <strong>{statistic.value}</strong>
                            <span>{statistic.label}</span>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}
