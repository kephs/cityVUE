import { useTheme } from "../../theme/useTheme.js";

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const darkThemeActive = theme === "dark";

    return (
        <button
            className="btn btn-outline-light btn-sm"
            type="button"
            aria-label={`Switch to ${darkThemeActive ? "light" : "dark"} mode`}
            aria-pressed={darkThemeActive}
            onClick={toggleTheme}
        >
            <i className={`bi ${darkThemeActive ? "bi-sun-fill" : "bi-moon-stars-fill"} me-1`} aria-hidden="true"></i>
            {darkThemeActive ? "Light Mode" : "Dark Mode"}
        </button>
    );
}
