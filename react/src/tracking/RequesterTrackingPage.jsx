import { useEffect, useState } from "react";
import {
  IssueIcon,
  StatusBadge,
  ReferenceDisplay,
  LocationDisplay,
} from "../components/ui/RequestPresentation.jsx";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";
import { trackingSession } from "./trackingSession.js";
import {
  lastResidentUpdateAt,
  residentStatusSummary,
} from "./residentTracking.js";
import "./tracking.css";

function Timestamp({ value }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

/**
 * F067: the resident-visible update history.
 *
 * Every entry is correspondence the service team addressed to the requester.
 * The projection carries no status-change records, so none are rendered and
 * none are synthesized from the status field -- the heading says what these
 * entries actually are instead of implying a complete activity history.
 */
function UpdateTimeline({ updates }) {
  // A read through the session is always an array, but the page stays
  // tolerant of an absent collection rather than failing the whole view.
  const entries = Array.isArray(updates) ? updates : [];
  return (
    <section aria-labelledby="tracking-updates-heading">
      <h2 id="tracking-updates-heading">Updates from the Service Team</h2>
      {entries.length ? (
        <>
          <p className="tracking-update-count">
            {entries.length === 1
              ? "1 update, newest first."
              : `${entries.length} updates, newest first.`}
          </p>
          <ol
            className="tracking-updates"
            aria-label="Updates from the service team, newest first"
          >
            {entries.map((update) => (
              <li key={update.id} className="tracking-update">
                <div className="tracking-update-attribution">
                  <strong>{update.sender.displayName}</strong>
                  <Timestamp value={update.createdAt} />
                </div>
                <p className="tracking-update-body">{update.body}</p>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p>
          There are no updates yet. Any updates the service team adds to this
          request will appear here.
        </p>
      )}
    </section>
  );
}

/**
 * F067: the reference is the one identifier a resident can safely keep and
 * quote to the service team. The tracking credential is never copied here --
 * this page never receives it, and only the reference reaches the clipboard.
 */
function ReferenceActions({ reference, browser }) {
  const [feedback, setFeedback] = useState("");
  const copy = async () => {
    try {
      await browser.navigator.clipboard.writeText(reference);
      setFeedback("Request reference copied.");
    } catch {
      setFeedback("Copy is unavailable. Select and copy the reference above.");
    }
  };
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
        Copy request reference
      </button>
      <p role="status" className="tracking-feedback">
        {feedback}
      </p>
    </>
  );
}

/**
 * F067: guidance for a link that did not resolve.
 *
 * Expired, revoked and never-valid links deliberately share one message. The
 * server answers all three identically and the session collapses them into a
 * single `unavailable` outcome, so saying which one occurred would disclose
 * whether a request exists behind the link.
 */
function UnavailableGuidance() {
  return (
    <>
      <p role="alert">This tracking link is unavailable.</p>
      <p>
        A tracking link stops working once it expires or is turned off, and a
        link that was mistyped or only partly copied will not open either.
      </p>
      <p>
        If you still have the original link, open it again in full. Otherwise
        contact the service team with your request reference and ask them to
        issue a new tracking link.
      </p>
      <p>
        <a className="btn btn-secondary" href="/">
          Go to the Reqro home page
        </a>
      </p>
    </>
  );
}

export default function RequesterTrackingPage({
  session = trackingSession,
  baseUrl = readResidentIntakeConfig().apiBaseUrl,
  browser = window,
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
  const status = state.data ? residentStatusSummary(state.data.status) : null;
  const lastUpdate = state.data
    ? lastResidentUpdateAt(state.data.updates)
    : null;
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
          {state.error === "unavailable" ? (
            <UnavailableGuidance />
          ) : (
            <>
              <p role="alert">
                {"We couldn't load this request right now. Please try again."}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setAttempt((x) => x + 1)}
              >
                Try again
              </button>
            </>
          )}
        </section>
      ) : (
        <article className="ui-card">
          <div className="tracking-issue">
            <IssueIcon icon={state.data.issue.icon} size="large" />
            <h1>{state.data.issue.name}</h1>
          </div>
          <div className="tracking-reference">
            <ReferenceDisplay value={state.data.reference} />
            <ReferenceActions
              reference={state.data.reference}
              browser={browser}
            />
          </div>
          <section
            className="tracking-status"
            aria-labelledby="tracking-status-heading"
          >
            <h2 id="tracking-status-heading" className="visually-hidden">
              Current status
            </h2>
            <div className="tracking-status-badges">
              <StatusBadge value={state.data.status} />
              <span
                className={`tracking-lifecycle tracking-lifecycle--${status.lifecycle}`}
              >
                <i className={`bi bi-${status.icon}`} aria-hidden="true" />
                {status.label}
              </span>
            </div>
            <p className="tracking-status-description">{status.description}</p>
          </section>
          <dl className="tracking-dates">
            <div>
              <dt>Submitted</dt>
              <dd>
                <Timestamp value={state.data.submittedAt} />
              </dd>
            </div>
            <div>
              <dt>Last update</dt>
              <dd>
                {lastUpdate ? (
                  <Timestamp value={lastUpdate} />
                ) : (
                  "No updates yet"
                )}
              </dd>
            </div>
          </dl>
          {state.data.serviceLocation && (
            <section aria-labelledby="tracking-location-heading">
              <h2 id="tracking-location-heading">Service Location</h2>
              <LocationDisplay value={state.data.serviceLocation} />
            </section>
          )}
          <section aria-labelledby="tracking-description-heading">
            <h2 id="tracking-description-heading">Description</h2>
            <p className="tracking-description">{state.data.description}</p>
          </section>
          <UpdateTimeline updates={state.data.updates} />
          <footer className="tracking-footer">
            <p>
              Keep your tracking link private. Anyone who has it can view this
              request.
            </p>
            <a href="/report">Report another request</a>
          </footer>
        </article>
      )}
    </main>
  );
}
