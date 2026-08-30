import test from "node:test";
import assert from "node:assert/strict";

import {
    CITYVUE_THEME_KEY,
    hasExplicitThemePreference,
    isValidTheme,
    LEGACY_HOME_THEME_KEY,
    readThemePreference,
    resolveInitialTheme,
    writeThemePreferences
} from "../react/src/theme/themePreferences.js";

test("cityvueTheme takes precedence over the legacy home theme", () => {
    assert.equal(resolveInitialTheme("dark", "light", false), "dark");
    assert.equal(resolveInitialTheme("light", "dark", true), "light");
});

test("the legacy home theme is used when cityvueTheme is invalid or absent", () => {
    assert.equal(resolveInitialTheme(null, "dark", false), "dark");
    assert.equal(resolveInitialTheme("sepia", "light", true), "light");
});

test("OS preference is used when neither stored theme is valid", () => {
    assert.equal(resolveInitialTheme(null, null, true), "dark");
    assert.equal(resolveInitialTheme(undefined, "invalid", false), "light");
});

test("only light and dark are valid themes", () => {
    assert.equal(isValidTheme("light"), true);
    assert.equal(isValidTheme("dark"), true);
    assert.equal(isValidTheme("Dark"), false);
    assert.equal(isValidTheme("system"), false);
    assert.equal(isValidTheme(null), false);
});

test("a valid stored theme marks the preference as explicit", () => {
    assert.equal(hasExplicitThemePreference("dark", null), true);
    assert.equal(hasExplicitThemePreference(null, "light"), true);
    assert.equal(hasExplicitThemePreference("invalid", null), false);
});

test("an explicit theme is written to both compatibility keys", () => {
    const writes = [];
    const storage = { setItem: (key, value) => writes.push([key, value]) };

    writeThemePreferences(storage, "dark");

    assert.deepEqual(writes, [
        [CITYVUE_THEME_KEY, "dark"],
        [LEGACY_HOME_THEME_KEY, "dark"]
    ]);
});

test("storage read and write failures do not escape", () => {
    const failingStorage = {
        getItem() { throw new Error("blocked"); },
        setItem() { throw new Error("blocked"); }
    };

    assert.equal(readThemePreference(failingStorage, CITYVUE_THEME_KEY), null);
    assert.doesNotThrow(() => writeThemePreferences(failingStorage, "light"));
});
