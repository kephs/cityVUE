import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import { useLocation } from "react-router-dom";

export default function AppLayout({ children }) {
    const location = useLocation();
    const mainClassName = location.pathname === "/"
        ? "flex-grow-1"
        : "container flex-grow-1 py-4 py-md-5";

    return (
        <div className="app-shell d-flex min-vh-100 flex-column bg-body-tertiary text-body">
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <SiteHeader />
            <main className={mainClassName} id="main-content" tabIndex="-1">
                {children}
            </main>
            <SiteFooter />
        </div>
    );
}
