import { Outlet } from "react-router-dom";

import AppLayout from "../components/layout/AppLayout.jsx";

export default function App() {
    return (
        <AppLayout>
            <Outlet />
        </AppLayout>
    );
}
