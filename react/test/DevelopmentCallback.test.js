import { afterEach, expect, test, vi } from "vitest";
import {
  authenticationReturnUris,
  developmentCallbackMode,
} from "../src/config/developmentCallback.mjs";
import { readResidentIntakeConfig } from "../src/config/runtimeConfig.js";
import viteConfig from "../vite.config.mjs";
const enabled = {
  DEV: true,
  PROD: false,
  VITE_CITYVUE_DEPLOYMENT_PROFILE: "development",
  VITE_ENTRA_DEVELOPMENT_CALLBACK_MODE: "f067-bridge",
};
afterEach(() => vi.unstubAllGlobals());
test("F067 returns only fixed same-origin bridge and separate logout paths", () => {
  expect(authenticationReturnUris(enabled, "http://localhost:5174")).toEqual({
    redirectUri: "http://localhost:5174/redirect.html",
    postLogoutRedirectUri: "http://localhost:5174/auth/signed-out",
  });
});
test.each([undefined, ""])(
  "unset selector %s preserves root behavior",
  (mode) => {
    for (const origin of ["http://localhost:5173", "https://staff.example"])
      expect(
        authenticationReturnUris(
          { PROD: true, VITE_ENTRA_DEVELOPMENT_CALLBACK_MODE: mode },
          origin,
        ),
      ).toEqual({
        redirectUri: `${origin}/`,
        postLogoutRedirectUri: `${origin}/`,
      });
  },
);
test.each([
  "F067-bridge",
  " f067-bridge",
  "f067-bridge ",
  " ",
  "false",
  "https://other.example",
  "/redirect.html",
  null,
  false,
  1,
])("rejects unsupported selector %s", (mode) => {
  expect(() =>
    developmentCallbackMode({
      ...enabled,
      VITE_ENTRA_DEVELOPMENT_CALLBACK_MODE: mode,
    }),
  ).toThrow(/Unsupported/);
});
test.each([
  { DEV: false },
  { DEV: undefined },
  { DEV: "true" },
  { PROD: true },
  { PROD: undefined },
  { VITE_CITYVUE_DEPLOYMENT_PROFILE: "client" },
  { VITE_CITYVUE_DEPLOYMENT_PROFILE: " development " },
  { VITE_CITYVUE_DEPLOYMENT_PROFILE: "" },
])("rejects non-development activation %j", (override) => {
  expect(() => developmentCallbackMode({ ...enabled, ...override })).toThrow();
});
test.each([
  "http://localhost:5173",
  "http://127.0.0.1:5174",
  "http://[::1]:5174",
  "https://localhost:5174",
  "http://localhost:5174.evil",
  "http://localhost:5174/",
  "https://staff.example",
  undefined,
])("rejects wrong origin %s", (origin) => {
  expect(() => authenticationReturnUris(enabled, origin)).toThrow(/origin/);
});
test("runtime rejects wrong origin even when authentication is otherwise disabled", () => {
  vi.stubGlobal("location", { origin: "http://localhost:5173" });
  expect(() => readResidentIntakeConfig(enabled)).toThrow(/origin/);
  vi.stubGlobal("location", { origin: "http://localhost:5174" });
  expect(readResidentIntakeConfig(enabled).entra.enabled).toBe(false);
});
test("Vite rejects callback mode in production before generating an artifact", () => {
  const plugin = viteConfig.plugins.find(
    (x) => x.name === "reqro-serving-configuration",
  );
  expect(() =>
    plugin.configResolved({ env: enabled, command: "serve" }),
  ).not.toThrow();
  expect(() =>
    plugin.configResolved({ env: enabled, command: "build" }),
  ).toThrow();
  expect(() =>
    plugin.configResolved({ env: { ...enabled, PROD: true, DEV: false } }),
  ).toThrow();
});
