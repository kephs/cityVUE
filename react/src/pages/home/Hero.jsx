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
            <Link className="home-hero-report-link" to="/report"><i className="bi bi-pencil-square" aria-hidden="true" /><span>Report a Concern</span><i className="bi bi-arrow-right" aria-hidden="true" /></Link>
            <h1 className="visually-hidden">CityVUE resident engagement platform</h1>
        </section>
    );
}
