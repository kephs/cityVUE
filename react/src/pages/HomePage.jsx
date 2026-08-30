import { useState } from "react";
import IssueService from "../../../assets/services/IssueService.js";
import Hero from "./home/Hero.jsx";
import ImpactSummary from "./home/ImpactSummary.jsx";
import QuickActions from "./home/QuickActions.jsx";
import RecentActivity from "./home/RecentActivity.jsx";
import "./home/home.css";

export default function HomePage({ loadIssues = () => IssueService.getIssues() }) {
    const [readState] = useState(() => {
        try {
            const issues = loadIssues();
            return { issues: Array.isArray(issues) ? issues : [], error: false };
        } catch {
            return { issues: [], error: true };
        }
    });

    return (
        <div className="home-page">
            <Hero />
            <div className="home-container home-main-content">
                <QuickActions />
                {readState.error ? <section className="home-data-error" role="alert" aria-labelledby="home-data-error-heading"><i className="bi bi-exclamation-circle" aria-hidden="true" /><div><h2 id="home-data-error-heading">Home issue information could not be loaded</h2><p>Refresh the page to try again. You can still report or view issues.</p></div></section> : <><ImpactSummary issues={readState.issues} /><RecentActivity issues={readState.issues} /></>}
            </div>
        </div>
    );
}
