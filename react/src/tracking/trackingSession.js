// Evaluated before router construction. Never put this secret in router/global UI state.
export function createTrackingSession(browser = window) {
  let credential =
    browser.location.pathname === "/track"
      ? browser.location.hash.slice(1)
      : "";
  if (browser.location.pathname === "/track") {
    browser.history.replaceState(browser.history.state, "", "/track");
    browser.document.title = "Request tracking | Reqro";
    const robots = browser.document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    browser.document.head.append(robots);
  }
  let owners = 0;
  const listeners = new Set();
  const clear = () => {
    credential = "";
  };
  const receiveLink = () => {
    if (browser.location.pathname !== "/track" || !browser.location.hash)
      return;
    credential = browser.location.hash.slice(1);
    browser.history.replaceState(browser.history.state, "", "/track");
    for (const listener of listeners) listener();
  };
  browser.addEventListener("pagehide", clear);
  return {
    retain() {
      owners++;
      browser.addEventListener("hashchange", receiveLink);
      // A link may arrive after bootstrap while the lazy page is still mounting.
      receiveLink();
      return () => {
        owners--;
        queueMicrotask(() => {
          if (!owners) {
            clear();
            browser.removeEventListener("hashchange", receiveLink);
          }
        });
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load(baseUrl, signal, fetcher = fetch) {
      const requestedCredential = credential;
      if (!/^[A-Za-z0-9_-]{43}$/.test(requestedCredential))
        throw new Error("unavailable");
      let response;
      try {
        response = await fetcher(`${baseUrl}/requester-tracking`, {
          headers: {
            Accept: "application/json",
            "X-Requester-Tracking": requestedCredential,
          },
          signal,
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
      } catch {
        throw new Error("temporary");
      }
      if (!response.ok) {
        if ([400, 401, 403, 404].includes(response.status)) {
          if (credential === requestedCredential) clear();
          throw new Error("unavailable");
        }
        throw new Error("temporary");
      }
      const data = await response.json();
      if (
        typeof data.reference !== "string" ||
        typeof data.issue?.name !== "string" ||
        !["open", "in_progress", "closed", "cancelled", "unavailable"].includes(
          data.status,
        ) ||
        typeof data.description !== "string" ||
        !Number.isFinite(Date.parse(data.submittedAt)) ||
        (data.serviceLocation !== null &&
          typeof data.serviceLocation !== "string")
      )
        throw new Error("temporary");
      return {
        reference: data.reference,
        issue: {
          name: data.issue.name,
          icon: typeof data.issue.icon === "string" ? data.issue.icon : null,
        },
        status: data.status,
        submittedAt: data.submittedAt,
        description: data.description,
        serviceLocation: data.serviceLocation,
      };
    },
  };
}
export const trackingSession = createTrackingSession();
