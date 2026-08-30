import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import PrimaryNavigation from "../navigation/PrimaryNavigation.jsx";

export default function SiteHeader() {
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    const closeMenu = () => setMenuOpen(false);

    useEffect(() => {
        setMenuOpen(false);
    }, [location.pathname]);

    return (
        <header className="react-site-header bg-primary shadow-sm">
            <nav className="navbar navbar-expand-lg navbar-dark container" aria-label="Primary navigation">
                <Link className="navbar-brand fw-bold d-flex align-items-center" to="/" onClick={closeMenu} aria-label="CityVUE home">
                    <i className="bi bi-buildings-fill me-2" aria-hidden="true"></i>
                    CityVUE
                </Link>
                <button
                    className="navbar-toggler"
                    type="button"
                    aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                    aria-controls="primary-navigation"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((isOpen) => !isOpen)}
                >
                    <span className="navbar-toggler-icon" aria-hidden="true"></span>
                </button>
                <PrimaryNavigation isOpen={menuOpen} onNavigate={closeMenu} />
            </nav>
        </header>
    );
}
