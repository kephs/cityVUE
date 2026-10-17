import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import RequesterRouteGuard from "./RequesterRouteGuard.jsx";
import { createMyRequestsRepository } from "./myRequestsRepository.js";
import {
  IssueIcon,
  LocationDisplay,
  ReferenceDisplay,
  StatusBadge,
} from "../components/ui/RequestPresentation.jsx";
import "./MyInternalRequestsPage.css";

function Timestamp({ value }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

function ServiceTeamUpdates({ updates }) {
  return (
    <section>
      <h2>Updates from the Service Team</h2>
      {updates.length ? (
        <ol
          className="my-request-updates"
          aria-label="Updates from the service team, newest first"
        >
          {updates.map((update) => (
            <li key={update.id} className="my-request-update">
              <div className="my-request-update-attribution">
                <strong>{update.sender.displayName}</strong>
                <Timestamp value={update.createdAt} />
              </div>
              <p className="my-request-update-body">{update.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          There are no updates yet. Any updates the service team adds to this
          request will appear here.
        </p>
      )}
    </section>
  );
}

function RequestDetail({ detail, onBack }) {
  return (
    <article className="ui-card my-request-detail">
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        Back to my requests
      </button>
      <div className="my-request-heading">
        <IssueIcon icon={detail.issue.icon} size="large" />
        <h1>{detail.issue.name}</h1>
      </div>
      <p>
        <ReferenceDisplay value={detail.reference} />
      </p>
      <StatusBadge value={detail.status} />
      <p>
        Submitted <Timestamp value={detail.submittedAt} />
      </p>
      {detail.lastUpdateAt && (
        <p>
          Last update <Timestamp value={detail.lastUpdateAt} />
        </p>
      )}
      {detail.serviceLocation && (
        <section>
          <h2>Service Location</h2>
          <LocationDisplay value={detail.serviceLocation} />
        </section>
      )}
      <section>
        <h2>Description</h2>
        <p className="my-request-description">{detail.description}</p>
      </section>
      <ServiceTeamUpdates updates={detail.updates} />
    </article>
  );
}

export default function MyInternalRequestsPage() {
  const auth = useAuth();
  const repository = useMemo(
    () => createMyRequestsRepository({ getAccessToken: auth.getAccessToken }),
    [auth.getAccessToken],
  );
  return (
    <RequesterRouteGuard>
      {auth.enabled && auth.isAuthenticated && (
        <MyInternalRequests repository={repository} />
      )}
    </RequesterRouteGuard>
  );
}

export function MyInternalRequests({ repository }) {
  const [state, setState] = useState({ loading: true });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback((error) => {
    setState({
      error:
        error?.code === "authentication-required"
          ? "Your session has expired. Please sign in again."
          : error?.code === "access-denied"
            ? "Your account is not able to view internal requests."
            : "We couldn't load your requests right now. Please try again.",
      retryable: !["authentication-required", "access-denied"].includes(
        error?.code,
      ),
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    const load = selected
      ? repository.detail(selected, controller.signal).then((detail) => ({ detail }))
      : repository.list(page, controller.signal).then((list) => ({ list }));
    load
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) fail(error);
      });
    return () => controller.abort();
  }, [repository, page, selected, attempt, fail]);

  return (
    <main className="my-internal-requests-page">
      {state.loading ? (
        <>
          <h1>My Internal Requests</h1>
          <p role="status">Loading your requests…</p>
        </>
      ) : state.error ? (
        <section className="ui-card">
          <h1>My Internal Requests</h1>
          <p role="alert">{state.error}</p>
          {state.retryable && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          )}
        </section>
      ) : state.detail ? (
        <RequestDetail
          detail={state.detail}
          onBack={() => {
            setSelected(null);
            setState({ loading: true });
          }}
        />
      ) : (
        <section className="ui-card">
          <h1>My Internal Requests</h1>
          {state.list.items.length ? (
            <>
              <ol
                className="my-request-list"
                aria-label="My internal requests, newest first"
              >
                {state.list.items.map((item) => (
                  <li key={item.id} className="my-request-summary">
                    <div className="my-request-heading">
                      <IssueIcon icon={item.issue.icon} />
                      <h2>{item.issue.name}</h2>
                    </div>
                    <p>
                      <ReferenceDisplay value={item.reference} />
                    </p>
                    <StatusBadge value={item.status} />
                    <p>
                      Submitted <Timestamp value={item.submittedAt} />
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setSelected(item.id);
                        setState({ loading: true });
                      }}
                    >
                      Open request {item.reference}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="my-request-pagination">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={page === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </button>
                <p role="status">Page {page}</p>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={!state.list.hasMore}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <p>
              You have not submitted any internal requests yet. Requests you
              submit will appear here.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
