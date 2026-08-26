// Bootstrap
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "bootstrap";

// CSS
import "../css/styles.css";
import "../css/darkmode.css";

// Components
import { initializeToast } from "../components/toast.js";
import { initializeTheme } from "../components/theme.js";

document.addEventListener("DOMContentLoaded", () => {
    initializeToast();
    initializeTheme();
});