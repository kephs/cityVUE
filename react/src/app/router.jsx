import { createBrowserRouter } from "react-router-dom";

import App from "./App.jsx";
import HomePage from "../pages/HomePage.jsx";
import IssuesPage from "../pages/issues/IssuesPage.jsx";
import EditIssuePage from "../pages/issues/EditIssuePage.jsx";
import DashboardPage from "../pages/dashboard/DashboardPage.jsx";
import ReportIssuePage from "../pages/report/ReportIssuePage.jsx";
import NotFoundPage from "../pages/NotFoundPage.jsx";

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
                path: "*",
                element: <NotFoundPage />
            }
        ]
    }
]);

export default router;
