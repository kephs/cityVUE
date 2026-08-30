export const CITYVUE_THEME_KEY = "cityvueTheme";
export const LEGACY_HOME_THEME_KEY = "askRockvilleTheme";

export function isValidTheme(value) {
    return value === "light" || value === "dark";
}

export function readThemePreference(storage, key) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

export function hasExplicitThemePreference(cityvueTheme, legacyHomeTheme) {
    return isValidTheme(cityvueTheme) || isValidTheme(legacyHomeTheme);
}

export function resolveInitialTheme(cityvueTheme, legacyHomeTheme, prefersDark = false) {
    if (isValidTheme(cityvueTheme)) return cityvueTheme;
    if (isValidTheme(legacyHomeTheme)) return legacyHomeTheme;
    return prefersDark ? "dark" : "light";
}

export function writeThemePreferences(storage, theme) {
    if (!isValidTheme(theme)) return;

    for (const key of [CITYVUE_THEME_KEY, LEGACY_HOME_THEME_KEY]) {
        try {
            storage.setItem(key, theme);
        } catch {
            // A blocked storage key must not prevent the other compatibility write.
        }
    }
}
