import { NavLink, Outlet } from "react-router-dom";

export default function App() {
    return (
        <div className="d-flex min-vh-100 flex-column bg-body-tertiary text-body">
            <header className="border-bottom bg-primary text-white shadow-sm">
                <div className="container py-3">
                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
                        <div>
                            <p className="mb-1 small text-white-50">
                                Parallel front-end migration
                            </p>
                            <h1 className="h3 mb-0">CityVUE</h1>
                        </div>

                        <nav aria-label="React shell navigation">
                            <NavLink
                                className="btn btn-sm btn-outline-light"
                                to="/"
                                end
                            >
                                <i className="bi bi-house-door me-2" aria-hidden="true"></i>
                                Shell Home
                            </NavLink>
                        </nav>
                    </div>
                </div>
            </header>

            <main className="container flex-grow-1 py-5" id="main-content">
                <Outlet />
            </main>
        </div>
    );
}
