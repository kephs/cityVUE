import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import router from "./app/router.jsx";
import "./styles.css";

createRoot(document.querySelector("#root")).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>
);
