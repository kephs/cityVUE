import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EventType,
  InteractionStatus,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";
import { MsalProvider, useMsal } from "@azure/msal-react";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";
import { createMsalInstance } from "./msalConfig.js";
import { setStaffTokenProvider } from "./tokenProvider.js";

const AuthContext = createContext({
  enabled: false,
  isAuthenticated: false,
  account: null,
  displayName: "",
  error: null,
});
function ActiveAuthProvider({ scope, children }) {
  const { instance, accounts, inProgress } = useMsal();
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [accountRevision, setAccountRevision] = useState(0);
  const interaction = useRef(false);
  const generation = useRef(0);
  const tokenAccount = useRef(null);
  const starting =
    inProgress === InteractionStatus.Startup ||
    inProgress === InteractionStatus.HandleRedirect;
  // Keep a logical session stable across unrelated renders. MSAL may return a
  // new AccountInfo object each time getActiveAccount reads its cache.
  const account = useMemo(
    () =>
      blocked || starting || inProgress === InteractionStatus.Logout
        ? null
        : instance.getActiveAccount() || accounts[0] || null,
    [blocked, starting, inProgress, instance, accounts, accountRevision],
  );
  const busy = inProgress !== InteractionStatus.None;

  useEffect(() => {
    const id = instance.addEventCallback((event) => {
      if (event.eventType === EventType.ACTIVE_ACCOUNT_CHANGED) {
        generation.current++;
        tokenAccount.current = null;
        setStaffTokenProvider(null);
        setAccountRevision((revision) => revision + 1);
      }
      if (
        [EventType.LOGIN_FAILURE, EventType.LOGOUT_FAILURE].includes(
          event.eventType,
        )
      ) {
        generation.current++;
        tokenAccount.current = null;
        setStaffTokenProvider(null);
        setBlocked(true);
        interaction.current = false;
        setError(
          event.eventType === EventType.LOGOUT_FAILURE
            ? "Sign-out was not completed. Please try again."
            : "Sign-in was not completed. Please try again.",
        );
      } else if (event.eventType === EventType.LOGIN_SUCCESS) {
        setBlocked(false);
        setError(null);
        interaction.current = false;
      } else if (
        [EventType.LOGOUT_START, EventType.LOGOUT_SUCCESS].includes(
          event.eventType,
        )
      ) {
        generation.current++;
        tokenAccount.current = null;
        setStaffTokenProvider(null);
        setBlocked(true);
      }
    });
    return () => {
      if (id) instance.removeEventCallback(id);
    };
  }, [instance]);
  useEffect(() => {
    if (account && !instance.getActiveAccount())
      instance.setActiveAccount(account);
  }, [account, instance]);
  const getAccessToken = useCallback(async () => {
    if (!account || tokenAccount.current !== account)
      throw new Error("staff-authentication-required");
    const current = generation.current;
    try {
      const result = await instance.acquireTokenSilent({
        account,
        scopes: [scope],
      });
      if (current !== generation.current)
        throw new Error("staff-authentication-required");
      return result.accessToken;
    } catch (cause) {
      if (
        current === generation.current &&
        cause instanceof InteractionRequiredAuthError
      ) {
        setError("CityVUE API access is awaiting administrator approval.");
      }
      throw cause;
    }
  }, [account, instance, scope]);
  useEffect(() => {
    tokenAccount.current = account;
    setStaffTokenProvider(account ? getAccessToken : null);
    return () => {
      generation.current++;
      tokenAccount.current = null;
      setStaffTokenProvider(null);
    };
  }, [account, getAccessToken]);

  const value = useMemo(
    () => ({
      enabled: true,
      isAuthenticated: Boolean(account),
      account,
      displayName: account?.name || account?.username || "",
      error,
      busy,
      signIn: async () => {
        if (busy || interaction.current) return;
        interaction.current = true;
        setError(null);
        try {
          await instance.loginRedirect({ scopes: [scope] });
        } catch {
          setError("Sign-in was not completed. Please try again.");
        } finally {
          interaction.current = false;
        }
      },
      signOut: async () => {
        if (busy || interaction.current) return;
        interaction.current = true;
        generation.current++;
        tokenAccount.current = null;
        setStaffTokenProvider(null);
        setBlocked(true);
        setError(null);
        try {
          await instance.logoutRedirect({
            account:
              account || instance.getActiveAccount() || accounts[0] || null,
          });
        } catch {
          setError("Sign-out was not completed. Please try again.");
        } finally {
          interaction.current = false;
        }
      },
      getAccessToken,
    }),
    [account, accounts, busy, error, getAccessToken, instance, scope],
  );
  return (
    <AuthContext.Provider value={value}>
      {starting ? <p role="status">Checking staff session…</p> : children}
    </AuthContext.Provider>
  );
}
export function AuthRoot({ children }) {
  const config = readResidentIntakeConfig();
  const [instance] = useState(() =>
    config.entra.enabled ? createMsalInstance(config.entra) : null,
  );
  if (!instance)
    return (
      <AuthContext.Provider
        value={{
          enabled: false,
          isAuthenticated: false,
          account: null,
          displayName: "",
          error: null,
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  return (
    <MsalProvider instance={instance}>
      <ActiveAuthProvider scope={config.entra.apiScope}>
        {children}
      </ActiveAuthProvider>
    </MsalProvider>
  );
}
export const useAuth = () => useContext(AuthContext);
