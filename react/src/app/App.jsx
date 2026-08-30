import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import AppLayout from "../components/layout/AppLayout.jsx";

export default function App() {
    return (
        <AppLayout>
            <Suspense fallback={(
                <div className="route-loading" role="status" aria-live="polite">
                    <i className="bi bi-hourglass-split" aria-hidden="true" />
                    <span>Loading page…</span>
                </div>
            )}>
                <Outlet />
            </Suspense>
        </AppLayout>
    );
}
