import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import { readResidentIntakeConfig } from "../../config/runtimeConfig.js";
import { HomePresentationProvider } from "./HomePresentationContext.jsx";
import { safeHomePresentation } from "./safeHomePresentation.js";
import { loadResidentExperience } from "./residentExperienceRepository.js";

export default function PublishedHomePresentationProvider({ children }) {
  const auth = useAuth();
  const { dataSource, apiBaseUrl } = readResidentIntakeConfig();
  // These values invalidate requests, never select a server Organization.
  const key = JSON.stringify([
    dataSource,
    apiBaseUrl,
    auth.enabled,
    auth.isAuthenticated,
    auth.account?.homeAccountId,
    auth.account?.localAccountId,
    auth.account?.tenantId,
  ]);
  const [state, setState] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ key, status: "loading", presentation: safeHomePresentation });
    loadResidentExperience({
      signal: controller.signal,
      config: { dataSource, apiBaseUrl },
    }).then(
      (presentation) => {
        if (current) setState({ key, status: "success", presentation });
      },
      () => {
        if (current)
          setState({
            key,
            status: "safe-failure",
            presentation: safeHomePresentation,
          });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [key, dataSource, apiBaseUrl]);
  // Clear prior-context content during render, before the replacement effect runs.
  const presentation =
    state?.key === key ? state.presentation : safeHomePresentation;
  return (
    <HomePresentationProvider value={presentation}>
      {children}
    </HomePresentationProvider>
  );
}
