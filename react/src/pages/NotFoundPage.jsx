import { Link } from "react-router-dom";

export default function NotFoundPage() {
    return (
        <section aria-labelledby="not-found-heading">
            <div className="card border-0 shadow-sm">
                <div className="card-body p-4 p-md-5">
                    <p className="text-primary fw-semibold mb-2">404</p>
                    <h1 className="card-title h2" id="not-found-heading">
                        Page not found
                    </h1>
                    <p className="card-text text-body-secondary">
                        This route is not available in the CityVUE React migration shell.
                    </p>
                    <Link className="btn btn-primary" to="/">
                        Return to Shell Home
                    </Link>
                </div>
            </div>
        </section>
    );
}
