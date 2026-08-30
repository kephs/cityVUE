import { useEffect, useMemo, useState } from "react";

import { ThemeContext } from "./ThemeContext.js";
import {
    CITYVUE_THEME_KEY,
    hasExplicitThemePreference,
    isValidTheme,
    LEGACY_HOME_THEME_KEY,
    readThemePreference,
    resolveInitialTheme,
    writeThemePreferences
} from "./themePreferences.js";

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

function getBrowserStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function getInitialThemeState() {
    const storage = getBrowserStorage();
    const cityvueTheme = readThemePreference(storage, CITYVUE_THEME_KEY);
    const legacyHomeTheme = readThemePreference(storage, LEGACY_HOME_THEME_KEY);
    const prefersDark = window.matchMedia?.(DARK_MODE_QUERY).matches ?? false;

    return {
        theme: resolveInitialTheme(cityvueTheme, legacyHomeTheme, prefersDark),
        explicitPreference: hasExplicitThemePreference(cityvueTheme, legacyHomeTheme)
    };
}

export function ThemeProvider({ children }) {
    const [themeState, setThemeState] = useState(getInitialThemeState);

    useEffect(() => {
        document.documentElement.dataset.bsTheme = themeState.theme;

        // Temporary bridge for legacy home CSS. html[data-bs-theme] remains canonical.
        document.body.classList.toggle("dark-mode", themeState.theme === "dark");
    }, [themeState.theme]);

    useEffect(() => {
        if (themeState.explicitPreference || !window.matchMedia) return undefined;

        const mediaQuery = window.matchMedia(DARK_MODE_QUERY);
        const handlePreferenceChange = (event) => {
            setThemeState({
                theme: event.matches ? "dark" : "light",
                explicitPreference: false
            });
        };

        mediaQuery.addEventListener?.("change", handlePreferenceChange);
        return () => mediaQuery.removeEventListener?.("change", handlePreferenceChange);
    }, [themeState.explicitPreference]);

    const contextValue = useMemo(() => ({
        theme: themeState.theme,
        setTheme(theme) {
            if (!isValidTheme(theme)) return;
            writeThemePreferences(getBrowserStorage(), theme);
            setThemeState({ theme, explicitPreference: true });
        },
        toggleTheme() {
            const nextTheme = themeState.theme === "dark" ? "light" : "dark";
            writeThemePreferences(getBrowserStorage(), nextTheme);
            setThemeState({ theme: nextTheme, explicitPreference: true });
        }
    }), [themeState.theme]);

    return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}
