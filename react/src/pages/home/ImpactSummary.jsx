const statistics = [
    { icon: "bi-clipboard2-data", tone: "blue", value: "1,248", label: "Total Issues Reported" },
    { icon: "bi-check-circle", tone: "green", value: "982", label: "Issues Resolved" },
    { icon: "bi-clock", tone: "orange", value: "3.2", label: "Avg. Days to Resolve" },
    { icon: "bi-people", tone: "purple", value: "8,756", label: "Active Residents Engaged" }
];

export default function ImpactSummary() {
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
