import { Link } from "react-router-dom";

import heroImage from "../../../../assets/cityvue-hero-home-cta.png";

export default function Hero() {
    return (
        <section className="home-hero" aria-label="CityVUE introduction">
            <img
                className="home-hero-image"
                src={heroImage}
                alt="CityVUE resident engagement app shown beside a Rockville city park and clock tower."
            />
            <Link className="home-hero-phone-link home-hero-phone-report-link" to="/report">
                <span className="visually-hidden">Report an Issue</span>
            </Link>
            <a className="home-hero-phone-link home-hero-emergency-link home-hero-police-link" href="tel:911" aria-label="Call 911 for police or fire emergency">
                <i className="bi bi-shield-fill-exclamation" aria-hidden="true" />
                <span><strong>Police or Fire Emergency</strong><small>Call 911</small></span>
                <i className="bi bi-telephone-fill" aria-hidden="true" />
            </a>
            <a className="home-hero-phone-link home-hero-emergency-link home-hero-water-link" href="tel:2403148567" aria-label="Call 240-314-8567 for water or sewer emergency">
                <i className="bi bi-droplet-fill" aria-hidden="true" />
                <span><strong>Water/Sewer Emergency</strong><small>Call 240-314-8567</small></span>
                <i className="bi bi-telephone-fill" aria-hidden="true" />
            </a>
            <a className="home-hero-phone-link home-hero-news-link" href="https://www.rockvillemd.gov/news/?page=1" target="_blank" rel="noopener noreferrer" aria-label="View City of Rockville news alerts">
                <i className="bi bi-megaphone" aria-hidden="true" />
                <span>News Alerts</span>
                <i className="bi bi-chevron-right" aria-hidden="true" />
            </a>
            <Link className="home-hero-report-link" to="/report"><i className="bi bi-pencil-square" aria-hidden="true" /><span>Report a Concern</span><i className="bi bi-arrow-right" aria-hidden="true" /></Link>
            <h1 className="visually-hidden">CityVUE resident engagement platform</h1>
        </section>
    );
}
