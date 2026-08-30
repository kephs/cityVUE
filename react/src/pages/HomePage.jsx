import Hero from "./home/Hero.jsx";
import ImpactSummary from "./home/ImpactSummary.jsx";
import QuickActions from "./home/QuickActions.jsx";
import RecentActivity from "./home/RecentActivity.jsx";
import ServiceHighlights from "./home/ServiceHighlights.jsx";
import "./home/home.css";

export default function HomePage() {
    return (
        <div className="home-page">
            <Hero />
            <ServiceHighlights />
            <div className="home-container home-main-content">
                <QuickActions />
                <ImpactSummary />
                <RecentActivity />
            </div>
        </div>
    );
}
