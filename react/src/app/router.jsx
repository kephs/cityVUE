import { createBrowserRouter } from "react-router-dom";

import App from "./App.jsx";
import HomePage from "../pages/HomePage.jsx";
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
                path: "*",
                element: <NotFoundPage />
            }
        ]
    }
]);

export default router;
