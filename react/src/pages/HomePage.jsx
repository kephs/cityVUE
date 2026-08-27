export default function HomePage() {
    return (
        <section aria-labelledby="shell-heading">
            <div className="card border-0 shadow-sm">
                <div className="card-body p-4 p-md-5">
                    <p className="text-primary fw-semibold mb-2">
                        Stage 1 technical shell
                    </p>
                    <h2 className="card-title" id="shell-heading">
                        React migration shell is active
                    </h2>
                    <p className="card-text text-body-secondary mb-0">
                        The existing Parcel application remains the working CityVUE MVP.
                        Current pages and workflows have not been migrated into this shell.
                    </p>
                </div>
            </div>
        </section>
    );
}
