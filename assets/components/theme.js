// ======================================================
// Constants
// ======================================================

const STORAGE_KEY = "cityvueTheme";

const THEME_ATTRIBUTE = "data-bs-theme";

// ======================================================
// Initialize Theme
// ======================================================

export function initializeTheme() {

    const savedTheme = localStorage.getItem(STORAGE_KEY);

    if (savedTheme) {

        applyTheme(savedTheme);

    }

    else {

        const prefersDark = window.matchMedia(
            "(prefers-color-scheme: dark)"
        ).matches;

        applyTheme(
            prefersDark ? "dark" : "light"
        );

    }

    initializeThemeToggle();

}

// ======================================================
// Initialize Theme Toggle
// ======================================================

function initializeThemeToggle() {

    const button = document.querySelector("#themeToggle");

    if (!button) return;

    button.removeEventListener("click", toggleTheme);

    button.addEventListener("click", toggleTheme);

}

// ======================================================
// Toggle Theme
// ======================================================

export function toggleTheme() {

    const newTheme =

        getCurrentTheme() === "dark"

            ? "light"

            : "dark";

    applyTheme(newTheme);

}

// ======================================================
// Apply Theme
// ======================================================

export function applyTheme(theme) {

    document.documentElement.setAttribute(

        THEME_ATTRIBUTE,

        theme

    );

    localStorage.setItem(

        STORAGE_KEY,

        theme

    );

    updateThemeButton(theme);

}

// ======================================================
// Get Current Theme
// ======================================================

export function getCurrentTheme() {

    return document.documentElement.getAttribute(

        THEME_ATTRIBUTE

    ) || "light";

}

// ======================================================
// Update Theme Button
// ======================================================

function updateThemeButton(theme) {

    const button = document.querySelector("#themeToggle");

    if (!button) return;

    if (theme === "dark") {

        button.innerHTML = `

            <i class="bi bi-sun-fill me-1"></i>

            Light Mode

        `;

    }

    else {

        button.innerHTML = `

            <i class="bi bi-moon-stars-fill me-1"></i>

            Dark Mode

        `;

    }

}

// ======================================================
// Listen for Operating System Theme Changes
// ======================================================

window.matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", event => {

        const savedTheme = localStorage.getItem(STORAGE_KEY);

        // Only follow the OS theme if the user has not
        // explicitly selected a theme.

        if (!savedTheme) {

            applyTheme(

                event.matches

                    ? "dark"

                    : "light"

            );

        }

    });