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
    inProgress: "none",
    events: new Map(),
    constructor: vi.fn(),
    provider: vi.fn(),
  };
});
vi.mock("@azure/msal-browser", () => ({
  BrowserCacheLocation: { SessionStorage: "sessionStorage" },
  InteractionStatus: {
    None: "none",
    Startup: "startup",
    HandleRedirect: "handleRedirect",
    Logout: "logout",
  },
  EventType: {
    ACTIVE_ACCOUNT_CHANGED: "activeAccountChanged",
    LOGIN_FAILURE: "loginFailure",
    LOGIN_SUCCESS: "loginSuccess",
    LOGOUT_FAILURE: "logoutFailure",
    LOGOUT_START: "logoutStart",
    LOGOUT_SUCCESS: "logoutSuccess",
  },
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
  useMsal: () => ({
    instance: msal.instance,
    accounts: msal.accounts,
    inProgress: msal.inProgress,
  }),
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
  msal.inProgress = "none";
  msal.events.clear();
  msal.instance = {
    addEventCallback: vi.fn((cb) => {
      msal.events.set("event", cb);
      return "event";
    }),
    removeEventCallback: vi.fn((id) => msal.events.delete(id)),
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

test("factory wires the F067 bridge without changing authority, scope handling or cache", () => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_ENTRA_DEVELOPMENT_CALLBACK_MODE", "f067-bridge");
  createMsalInstance(config, "http://localhost:5174");
  expect(msal.constructor.mock.calls[0][0]).toEqual({
    auth: {
      clientId: config.webClientId,
      authority: "https://login.microsoftonline.com/synthetic-tenant",
      redirectUri: "http://localhost:5174/redirect.html",
      postLogoutRedirectUri: "http://localhost:5174/auth/signed-out",
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  expect(() => createMsalInstance(config, "http://localhost:5173")).toThrow(
    /origin/,
  );
});

test.each(["startup", "handleRedirect"])(
  "%s does not mount application children or expose a token provider",
  async (state) => {
    msal.inProgress = state;
    msal.accounts = [{ homeAccountId: "cached" }];
    const child = vi.fn(() => null);
    const Child = child;
    const view = render(
      <AuthRoot>
        <Child />
      </AuthRoot>,
    );
    expect(view.getByRole("status")).toHaveTextContent(
      "Checking staff session",
    );
    expect(child).not.toHaveBeenCalled();
    await expect(getStaffAccessToken()).rejects.toThrow(
      "staff-authentication-required",
    );
  },
);

test("ongoing interaction and double clicks cannot launch duplicate authentication", async () => {
  msal.inProgress = "login";
  const view = render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  await act(async () => {
    await auth.signIn();
    await auth.signOut();
  });
  expect(msal.instance.loginRedirect).not.toHaveBeenCalled();
  expect(msal.instance.logoutRedirect).not.toHaveBeenCalled();
  msal.inProgress = "none";
  view.rerender(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  let finish;
  msal.instance.loginRedirect.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending;
  await act(async () => {
    pending = auth.signIn();
    await auth.signIn();
  });
  expect(msal.instance.loginRedirect).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await pending;
  });
});

test("callback failure is sanitized, removes protected state, and unregisters its listener", async () => {
  msal.accounts = [{ homeAccountId: "cached" }];
  const view = render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  await act(async () => {
    msal.events.get("event")({
      eventType: "loginFailure",
      error: new Error("PRIVATE_RESPONSE"),
    });
  });
  expect(auth.isAuthenticated).toBe(false);
  expect(auth.error).toBe("Sign-in was not completed. Please try again.");
  expect(auth.error).not.toContain("PRIVATE");
  await expect(getStaffAccessToken()).rejects.toThrow(
    "staff-authentication-required",
  );
  expect(msal.instance.loginRedirect).not.toHaveBeenCalled();
  await act(async () => {
    msal.events.get("event")({ eventType: "loginSuccess" });
  });
  expect(auth.isAuthenticated).toBe(true);
  expect(auth.error).toBeNull();
  view.unmount();
  expect(msal.events.size).toBe(0);
});

test("cancelled login and failed logout do not retry or expose raw errors", async () => {
  msal.instance.loginRedirect.mockRejectedValue(
    new Error("user_cancelled PRIVATE"),
  );
  msal.instance.logoutRedirect.mockRejectedValue(new Error("PRIVATE_LOGOUT"));
  msal.accounts = [{ homeAccountId: "cached" }];
  render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  await act(async () => {
    await auth.signIn();
  });
  expect(auth.error).toBe("Sign-in was not completed. Please try again.");
  await act(async () => {
    await auth.signOut();
  });
  expect(auth.isAuthenticated).toBe(false);
  expect(auth.error).toBe("Sign-out was not completed. Please try again.");
  await expect(getStaffAccessToken()).rejects.toThrow(
    "staff-authentication-required",
  );
  expect(msal.instance.loginRedirect).toHaveBeenCalledTimes(1);
  expect(msal.instance.logoutRedirect).toHaveBeenCalledTimes(1);
});

test("sign-out invalidates an already pending token result", async () => {
  msal.accounts = [{ homeAccountId: "cached" }];
  let resolveToken;
  msal.instance.acquireTokenSilent.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
  );
  render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  const pending = getStaffAccessToken();
  const rejected = expect(pending).rejects.toThrow(
    "staff-authentication-required",
  );
  await act(async () => {
    await auth.signOut();
    resolveToken({ accessToken: "stale-token" });
  });
  await rejected;
});

test("old account callbacks and pending requests cannot provide tokens after account replacement", async () => {
  const first = { homeAccountId: "first" };
  msal.accounts = [first];
  let complete;
  msal.instance.acquireTokenSilent.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  const oldProvider = auth.getAccessToken;
  const pending = oldProvider();
  const rejected = expect(pending).rejects.toThrow(
    "staff-authentication-required",
  );
  msal.accounts = [{ homeAccountId: "second" }];
  view.rerender(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  await expect(oldProvider()).rejects.toThrow("staff-authentication-required");
  await act(async () => {
    complete({ accessToken: "stale" });
  });
  await rejected;
});

test("unrelated rerenders do not invalidate a token for the same cached account", async () => {
  const active = {
    homeAccountId: "same",
    tenantId: "tenant",
    localAccountId: "local",
  };
  msal.instance.getActiveAccount.mockImplementation(() => ({ ...active }));
  let complete;
  msal.instance.acquireTokenSilent.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  const pending = getStaffAccessToken();
  view.rerender(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  await act(async () => {
    complete({ accessToken: "current" });
  });
  await expect(pending).resolves.toBe("current");
});

test("active-account events invalidate a previous session even when the accounts list is unchanged", async () => {
  let active = { homeAccountId: "first" };
  msal.instance.getActiveAccount.mockImplementation(() => active);
  render(
    <AuthRoot>
      <Probe />
    </AuthRoot>,
  );
  const previous = auth.getAccessToken;
  active = { homeAccountId: "second" };
  await act(async () => {
    msal.events.get("event")({ eventType: "activeAccountChanged" });
  });
  expect(auth.account.homeAccountId).toBe("second");
  await expect(previous()).rejects.toThrow("staff-authentication-required");
});
