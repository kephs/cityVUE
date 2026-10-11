import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthRoot, useAuth } from "../src/auth/AuthContext.jsx";
import { createMsalInstance } from "../src/auth/msalConfig.js";
import {
  getStaffAccessToken,
  setStaffTokenProvider,
} from "../src/auth/tokenProvider.js";

const msal = vi.hoisted(() => {
  class InteractionRequiredAuthError extends Error {}
  return {
    InteractionRequiredAuthError,
    instance: {},
    accounts: [],
    constructor: vi.fn(),
    provider: vi.fn(),
  };
});
vi.mock("@azure/msal-browser", () => ({
  BrowserCacheLocation: { SessionStorage: "sessionStorage" },
  InteractionRequiredAuthError: msal.InteractionRequiredAuthError,
  PublicClientApplication: function (config) {
    msal.constructor(config);
    return msal.instance;
  },
}));
// This tests Reqro's boundary, not library initialization, iframe or network internals.
vi.mock("@azure/msal-react", () => ({
  MsalProvider: ({ instance, children }) => {
    msal.provider(instance);
    return children;
  },
  useMsal: () => ({ instance: msal.instance, accounts: msal.accounts }),
}));
const config = {
  webClientId: "synthetic-client",
  tenantId: "synthetic-tenant",
};
const scope = "api://synthetic-api/access";
let auth;
function Probe() {
  auth = useAuth();
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  msal.accounts = [];
  msal.instance = {
    getActiveAccount: vi.fn(() => null),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
    acquireTokenSilent: vi
      .fn()
      .mockResolvedValue({ accessToken: "synthetic-token" }),
  };
  vi.stubEnv("VITE_CITYVUE_DEPLOYMENT_PROFILE", "development");
  vi.stubEnv("PROD", false);
  vi.stubEnv("VITE_CITYVUE_DATA_SOURCE", "api");
  vi.stubEnv("VITE_CITYVUE_API_BASE_URL", "");
  vi.stubEnv("VITE_ENTRA_WEB_CLIENT_ID", config.webClientId);
  vi.stubEnv("VITE_ENTRA_TENANT_ID", config.tenantId);
  vi.stubEnv("VITE_ENTRA_API_SCOPE", scope);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setStaffTokenProvider(null);
});

test.each(["https://staff.example", "https://alias.example:8443"])(
  "factory derives both return URIs from supplied origin %s without a fixed callback host",
  (origin) => {
    createMsalInstance(config, origin);
    expect(msal.constructor).toHaveBeenCalledExactlyOnceWith({
      auth: {
        clientId: config.webClientId,
        authority: "https://login.microsoftonline.com/synthetic-tenant",
        redirectUri: `${origin}/`,
        postLogoutRedirectUri: `${origin}/`,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    const serialized = JSON.stringify(msal.constructor.mock.calls[0][0]);
    expect(serialized).not.toContain("*");
    expect(serialized).not.toContain("localhost");
    // HTTPS fixtures establish output, not a production-origin validation guarantee.
  },
);

test("default return URIs use the browser origin, excluding current path/query/hash", () => {
  const previous = window.location.href;
  try {
    window.history.replaceState(
      null,
      "",
      "/staff/requests?synthetic=1#section",
    );
    createMsalInstance(config);
    expect(msal.constructor.mock.calls[0][0].auth).toMatchObject({
      redirectUri: `${window.location.origin}/`,
      postLogoutRedirectUri: `${window.location.origin}/`,
    });
  } finally {
    window.history.replaceState(null, "", previous);
  }
});

test("absent Entra configuration leaves authentication disabled without constructing MSAL", async () => {
  for (const key of [
    "VITE_ENTRA_WEB_CLIENT_ID",
    "VITE_ENTRA_TENANT_ID",
    "VITE_ENTRA_API_SCOPE",
  ])
    vi.stubEnv(key, "");
  render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  expect(auth.enabled).toBe(false);
  expect(msal.constructor).not.toHaveBeenCalled();
  expect(msal.provider).not.toHaveBeenCalled();
  await expect(getStaffAccessToken()).rejects.toThrow(
    "staff-authentication-required",
  );
});

test("enabled auth uses the React wrapper and explicit loginRedirect with only the configured API scope", async () => {
  render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  expect(msal.provider).toHaveBeenCalledWith(msal.instance);
  expect(auth.isAuthenticated).toBe(false);
  expect(msal.instance.acquireTokenSilent).not.toHaveBeenCalled();
  await act(async () => {
    await auth.signIn();
  });
  expect(msal.instance.loginRedirect).toHaveBeenCalledExactlyOnceWith({
    scopes: [scope],
  });
  expect(msal.instance.logoutRedirect).not.toHaveBeenCalled();
});

test("account token requests are on demand and logoutRedirect carries that account without URI override", async () => {
  const account = {
    homeAccountId: "synthetic-account",
    name: "Synthetic Staff",
  };
  msal.accounts = [account];
  const view = render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  expect(msal.instance.setActiveAccount).toHaveBeenCalledWith(account);
  expect(msal.instance.acquireTokenSilent).not.toHaveBeenCalled();
  await expect(getStaffAccessToken()).resolves.toBe("synthetic-token");
  expect(msal.instance.acquireTokenSilent).toHaveBeenCalledExactlyOnceWith({
    account,
    scopes: [scope],
  });
  await act(async () => {
    await auth.signOut();
  });
  expect(msal.instance.logoutRedirect).toHaveBeenCalledExactlyOnceWith({
    account,
  });
  view.unmount();
  await expect(getStaffAccessToken()).rejects.toThrow(
    "staff-authentication-required",
  );
});

test("interaction-required failure is propagated without an automatic interactive fallback", async () => {
  msal.accounts = [{ homeAccountId: "synthetic-account" }];
  const failure = new msal.InteractionRequiredAuthError(
    "synthetic interaction required",
  );
  msal.instance.acquireTokenSilent.mockRejectedValue(failure);
  render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  await act(async () => {
    await expect(getStaffAccessToken()).rejects.toBe(failure);
  });
  expect(auth.error).toBe(
    "CityVUE API access is awaiting administrator approval.",
  );
  expect(msal.instance.loginRedirect).not.toHaveBeenCalled();
  expect(msal.instance.logoutRedirect).not.toHaveBeenCalled();
});
