import { lazy } from "react";
import { createBrowserRouter, redirect } from "react-router-dom";

import App from "./App.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";

const HomePage = lazy(() => import("../pages/HomePage.jsx"));
const IssuesPage = lazy(() => import("../pages/issues/IssuesPage.jsx"));
const EditIssuePage = lazy(() => import("../pages/issues/EditIssuePage.jsx"));
const DashboardPage = lazy(() => import("../pages/dashboard/DashboardPage.jsx"));
const ReportIssuePage = lazy(() => import("../pages/report/ReportIssuePage.jsx"));

function redirectLegacyReport({ request }) {
    const issueId = new URL(request.url).searchParams.get("id")?.trim();

    return redirect(issueId
        ? `/issues/${encodeURIComponent(issueId)}/edit`
        : "/report");
}

const router = createBrowserRouter([
    {
        path: "/",
        element: <App />,
        children: [
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
                element: <IssuesPage />
            },
            {
                path: "issues/:issueId/edit",
                element: <EditIssuePage />
            },
            {
                path: "dashboard",
                element: <DashboardPage />
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
