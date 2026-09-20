import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import PrimaryNavigation from "../navigation/PrimaryNavigation.jsx";

export default function SiteHeader({
  brandName = "CityVUE",
  brandLogo = null,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="react-site-header shadow-sm">
      <nav
        className="navbar navbar-expand-xl navbar-dark container"
        aria-label="Primary navigation"
      >
        <Link
          className="navbar-brand fw-bold d-flex align-items-center"
          to="/"
          onClick={closeMenu}
          aria-label={`${brandName} home`}
        >
          {typeof brandLogo === "string" &&
          /^\/(?!\/)[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|svg)$/.test(
            brandLogo,
          ) ? (
            <img className="ui-brand-logo" src={brandLogo} alt="" />
          ) : (
            <i className="bi bi-buildings-fill me-2" aria-hidden="true"></i>
          )}
          {brandName}
        </Link>
        <button
          className="navbar-toggler"
          type="button"
          aria-label={
            menuOpen ? "Close navigation menu" : "Open navigation menu"
          }
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
