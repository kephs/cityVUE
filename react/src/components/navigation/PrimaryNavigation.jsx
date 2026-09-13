import { NavLink } from "react-router-dom";

import ThemeToggle from "../theme/ThemeToggle.jsx";
import { useAuth } from '../../auth/AuthContext.jsx';

const navigationItems = [
    { label: "Home", to: "/", end: true },
    { label: "Report an Issue", to: "/report" },
    { label: "Issue List", to: "/issues" },
    { label: "Dashboard", to: "/dashboard" }
];

export default function PrimaryNavigation({ isOpen, onNavigate }) {
    const auth = useAuth();
    return (
        <div className={`navbar-collapse${isOpen ? " show" : " collapse"}`} id="primary-navigation">
            <ul className="navbar-nav ms-auto align-items-lg-center gap-lg-1">
                {navigationItems.map(({ label, to, end }) => (
                    <li className="nav-item" key={to}>
                        <NavLink
                            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                            to={to}
                            end={end}
                            onClick={onNavigate}
                        >
                            {label}
                        </NavLink>
                    </li>
                ))}
                <li className="nav-item ms-lg-3 mt-2 mt-lg-0"><ThemeToggle /></li>
                {auth.enabled && <li className="nav-item ms-lg-2 mt-2 mt-lg-0 d-flex align-items-center gap-2">
                    {auth.isAuthenticated && <span className="navbar-text text-white">{auth.displayName}</span>}
                    <button className="btn btn-sm btn-outline-light" onClick={auth.isAuthenticated ? auth.signOut : auth.signIn}>
                        {auth.isAuthenticated ? 'Sign out' : 'Sign in'}
                    </button>
                </li>}
            </ul>
        </div>
    );
}
