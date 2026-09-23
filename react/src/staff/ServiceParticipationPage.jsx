import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import StaffRouteGuard from "../auth/StaffRouteGuard.jsx";
import { createApiClient } from "../api/apiClient.js";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";

export function ParticipationPreview({ client }) {
  const [dates, setDates] = useState(() => {
    const now = new Date();
    return {
      startDate: new Date(now.getTime() - 364 * 86400000)
        .toISOString()
        .slice(0, 10),
      endDate: now.toISOString().slice(0, 10),
    };
  });
  const [authorized, setAuthorized] = useState(false);
  const [query, setQuery] = useState(dates),
    [attempt, setAttempt] = useState(0),
    [state, setState] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    client
      .get(
        `/staff/analytics/service-participation?${new URLSearchParams(query)}`,
        { authenticated: true, signal: controller.signal },
      )
      .then(
        (data) => {
          if (!controller.signal.aborted) {
            setAuthorized(true);
            setState({ data });
          }
        },
        (error) => {
          if (!controller.signal.aborted && [401, 403].includes(error.status))
            setAuthorized(false);
          if (!controller.signal.aborted)
            setState({
              denied: [401, 403].includes(error.status),
              error: true,
            });
        },
      );
    return () => controller.abort();
  }, [client, query, attempt]);
  const cell = (v) =>
    v.suppressed
      ? `Fewer than ${state.data.suppressionThreshold} requests`
      : `${v.count} requests`;
  return (
    <main id="main-content" className="container py-4">
      <h1>Service Participation</h1>
      <p>
        Counts represent requests in your authorized PUBLIC scope, not people or
        households. Areas are self-reported participation information, not
        Service Location or verified residence.
      </p>
      {authorized && (
        <form
          className="d-flex flex-wrap gap-3 align-items-end mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ ...dates });
          }}
        >
          <div>
            <label htmlFor="participation-start" className="form-label">
              Start date (UTC)
            </label>
            <input
              id="participation-start"
              type="date"
              className="form-control"
              value={dates.startDate}
              onChange={(e) =>
                setDates({ ...dates, startDate: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label htmlFor="participation-end" className="form-label">
              End date (UTC, inclusive)
            </label>
            <input
              id="participation-end"
              type="date"
              className="form-control"
              value={dates.endDate}
              onChange={(e) => setDates({ ...dates, endDate: e.target.value })}
              required
            />
          </div>
          <button className="btn btn-primary">Apply period</button>
        </form>
      )}
      {!state ? (
        <p role="status">Loading service participation…</p>
      ) : state.error ? (
        <div>
          <p role="alert">
            {state.denied
              ? "Service participation access is not authorized."
              : "Service participation could not be loaded. Use a UTC period of 28 to 366 days ending no later than today."}
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => setAttempt(attempt + 1)}
          >
            Retry service participation
          </button>
        </div>
      ) : (
        <>
          <p role="status">
            {state.data.period.startDate} through {state.data.period.endDate}{" "}
            (UTC). Positive counts below {state.data.suppressionThreshold} are
            suppressed.
          </p>
          <dl className="row" style={{ overflowWrap: "anywhere" }}>
            {[
              ...state.data.areas.map((a) => ({
                key: a.areaId,
                label: a.label,
                ...a,
              })),
              {
                key: "declined",
                label: "Prefer not to say",
                ...state.data.declined,
              },
              {
                key: "not-collected",
                label: "Not collected",
                ...state.data.notCollected,
              },
            ].map((row) => (
              <div key={row.key} className="col-12 col-md-6 mb-3">
                <dt>{row.label}</dt>
                <dd>{cell(row)}</dd>
              </div>
            ))}
          </dl>
          <p>
            Prefer not to say records an explicit choice. Not collected means no
            area choice was recorded, including older requests. These counts do
            not measure population participation or equitable access.
          </p>
        </>
      )}
    </main>
  );
}
export default function ServiceParticipationPage() {
  const auth = useAuth();
  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: readResidentIntakeConfig().apiBaseUrl,
        getAccessToken: auth.getAccessToken,
      }),
    [auth.getAccessToken],
  );
  return (
    <StaffRouteGuard
      requireEntra
      title="Service Participation"
      disabledMessage="Staff analytics access is not enabled. Staff sign-in must be configured."
      signInMessage="Sign in with an authorized staff account to view service participation."
    >
      {auth.enabled && auth.isAuthenticated && (
        <ParticipationPreview
          key={auth.account?.homeAccountId || "staff"}
          client={client}
        />
      )}
    </StaffRouteGuard>
  );
}
