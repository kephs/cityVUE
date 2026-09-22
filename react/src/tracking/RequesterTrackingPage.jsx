import { useEffect, useState } from "react";
import {
  IssueIcon,
  StatusBadge,
  ReferenceDisplay,
  LocationDisplay,
} from "../components/ui/RequestPresentation.jsx";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";
import { trackingSession } from "./trackingSession.js";
import "./tracking.css";

export default function RequesterTrackingPage({
  session = trackingSession,
  baseUrl = readResidentIntakeConfig().apiBaseUrl,
}) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => session.retain(), [session]);
  useEffect(
    () =>
      session.subscribe?.(() => {
        setState({ loading: true });
        setAttempt((value) => value + 1);
      }),
    [session],
  );
  useEffect(() => {
    const controller = new AbortController();
    document.title = "Request tracking | Reqro";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.append(robots);
    setState({ loading: true });
    session
      .load(baseUrl, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            error:
              error.message === "unavailable" ? "unavailable" : "temporary",
          });
      });
    return () => {
      controller.abort();
      robots.remove();
    };
  }, [session, baseUrl, attempt]);
  return (
    <main className="requester-tracking-page">
      <header>
        <p>Reqro · Request tracking</p>
      </header>
      {state.loading ? (
        <p role="status">Loading request…</p>
      ) : state.error ? (
        <section className="ui-card">
          <h1>Request tracking</h1>
          <p role="alert">
            {state.error === "unavailable"
              ? "This tracking link is unavailable."
              : "We couldn't load this request right now. Please try again."}
          </p>
          {state.error === "temporary" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAttempt((x) => x + 1)}
            >
              Try again
            </button>
          )}
        </section>
      ) : (
        <article className="ui-card">
          <div className="tracking-issue">
            <IssueIcon icon={state.data.issue.icon} size="large" />
            <h1>{state.data.issue.name}</h1>
          </div>
          <p>
            <ReferenceDisplay value={state.data.reference} />
          </p>
          <StatusBadge value={state.data.status} />
          <p>
            Submitted{" "}
            <time dateTime={state.data.submittedAt}>
              {new Date(state.data.submittedAt).toLocaleString()}
            </time>
          </p>
          {state.data.serviceLocation && (
            <section>
              <h2>Service Location</h2>
              <LocationDisplay value={state.data.serviceLocation} />
            </section>
          )}
          <section>
            <h2>Description</h2>
            <p className="tracking-description">{state.data.description}</p>
          </section>
        </article>
      )}
    </main>
  );
}
