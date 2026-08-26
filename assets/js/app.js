const THEME_STORAGE_KEY = "askRockvilleTheme";

const body = document.body;
const themeButton = document.querySelector("#darkModeToggle");
const themeButtonText = themeButton?.querySelector("span");
const themeButtonIcon = themeButton?.querySelector("i");

const mobileMenuButton = document.querySelector("#mobileMenuButton");
const primaryNavigation = document.querySelector("#primaryNavigation");

/**
 * Apply the selected visual theme.
 * @param {"light" | "dark"} theme
 */
function applyTheme(theme) {
    const darkModeEnabled = theme === "dark";

    body.classList.toggle("dark-mode", darkModeEnabled);
    body.dataset.theme = theme;

    if (themeButtonText) {
        themeButtonText.textContent = darkModeEnabled
            ? "Light Mode"
            : "Dark Mode";
    }

    if (themeButtonIcon) {
        themeButtonIcon.className = darkModeEnabled
            ? "bi bi-sun-fill"
            : "bi bi-moon-stars-fill";
    }

    if (themeButton) {
        themeButton.setAttribute(
            "aria-label",
            darkModeEnabled
                ? "Switch to light mode"
                : "Switch to dark mode"
        );
    }
}

/**
 * Initialize the page theme using local storage or system preference.
 */
function initializeTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

    if (savedTheme === "light" || savedTheme === "dark") {
        applyTheme(savedTheme);
        return;
    }

    const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
    ).matches;

    applyTheme(prefersDark ? "dark" : "light");
}

themeButton?.addEventListener("click", () => {
    const nextTheme = body.classList.contains("dark-mode")
        ? "light"
        : "dark";

    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
});

mobileMenuButton?.addEventListener("click", () => {
    const isOpen = primaryNavigation.classList.toggle("open");

    mobileMenuButton.setAttribute(
        "aria-expanded",
        String(isOpen)
    );

    mobileMenuButton.innerHTML = isOpen
        ? '<i class="bi bi-x-lg"></i>'
        : '<i class="bi bi-list"></i>';
});

primaryNavigation?.addEventListener("click", (event) => {
    if (
        event.target.closest("a") &&
        window.innerWidth <= 720
    ) {
        primaryNavigation.classList.remove("open");
        mobileMenuButton?.setAttribute("aria-expanded", "false");
        mobileMenuButton.innerHTML = '<i class="bi bi-list"></i>';
    }
});

initializeTheme();
