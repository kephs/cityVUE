import { lazy, Suspense } from "react";
import { createBrowserRouter, redirect } from "react-router-dom";

import App from "./App.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";
import { AuthRoot } from '../auth/AuthContext.jsx';
import StaffRouteGuard from '../auth/StaffRouteGuard.jsx';

const HomePage = lazy(() => import("../pages/HomePage.jsx"));
const AIPreviewPage = lazy(() => import("../ai/AIPreviewPage.jsx"));
const AdminPreviewPage = lazy(() => import("../admin/AdminPreviewPage.jsx"));
const MapPreviewPage = lazy(() => import("../map/MapPreviewPage.jsx"));
const AIWorkspacePage = lazy(() => import("../ai/AIWorkspacePage.jsx"));
const IssuesPage = lazy(() => import("../pages/issues/IssuesPage.jsx"));
const EditIssuePage = lazy(() => import("../pages/issues/EditIssuePage.jsx"));
const DashboardPage = lazy(() => import("../pages/dashboard/DashboardPage.jsx"));
const ReportIssuePage = lazy(() => import("../pages/report/ReportIssuePage.jsx"));
const ServiceRequestDetailsPage = lazy(() => import("../pages/issues/ServiceRequestDetailsPage.jsx"));

function redirectLegacyReport({ request }) {
    const issueId = new URL(request.url).searchParams.get("id")?.trim();

    return redirect(issueId
        ? `/issues/${encodeURIComponent(issueId)}/edit`
        : "/report");
}

const router = createBrowserRouter([
    {
        path: "/admin-preview",
        element: <Suspense fallback={<p role="status">Loading admin preview…</p>}><AdminPreviewPage /></Suspense>
    },
    {
        path: "/ai-preview",
        element: <App />,
        children: [{ index: true, element: <AIPreviewPage /> }]
    },
    {
        path: "/",
        element: <AuthRoot><App /></AuthRoot>,
        children: [
            {
                path: 'map-preview',
                element: <MapPreviewPage />
            },
            {
                path: "staff/ai",
                element: <StaffRouteGuard requireEntra><AIWorkspacePage /></StaffRouteGuard>
            },
            {
                index: true,
                element: <HomePage />
            },
            {
                path: "report",
                element: <ReportIssuePage />
            },
            {
                path: "issues",
                element: <StaffRouteGuard><IssuesPage /></StaffRouteGuard>
            },
            {
                path: "issues/:issueId/edit",
                element: <StaffRouteGuard><EditIssuePage /></StaffRouteGuard>
            },
            {
                path: "issues/:issueId",
                element: <StaffRouteGuard><ServiceRequestDetailsPage /></StaffRouteGuard>
            },
            {
                path: "dashboard",
                element: <StaffRouteGuard><DashboardPage /></StaffRouteGuard>
            },
            {
                path: "pages/report.html",
                loader: redirectLegacyReport
            },
            {
                path: "pages/issues.html",
                loader: () => redirect("/issues")
            },
            {
                path: "pages/dashboard.html",
                loader: () => redirect("/dashboard")
            },
            {
                path: "*",
                element: <NotFoundPage />
            }
        ]
    }
]);

export default router;
