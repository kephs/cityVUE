import { Link } from "react-router-dom";

export default function SiteFooter() {
    return (
        <footer className="border-top bg-body py-4 mt-auto">
            <div className="container d-flex flex-column flex-md-row justify-content-between align-items-center gap-2">
                <p className="text-body-secondary small mb-0">
                    &copy; 2026 CityVUE. Resident Engagement Platform.
                </p>
                <Link className="small text-decoration-none" to="/report">Report a community issue</Link>
            </div>
        </footer>
    );
}
