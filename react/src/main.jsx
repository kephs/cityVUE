import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import router from "./app/router.jsx";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import "./styles.css";
import { AuthRoot } from './auth/AuthContext.jsx';

createRoot(document.querySelector("#root")).render(
    <StrictMode>
        <ThemeProvider>
            <AuthRoot><RouterProvider router={router} /></AuthRoot>
        </ThemeProvider>
    </StrictMode>
);
