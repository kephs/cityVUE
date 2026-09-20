import { useEffect, useRef, useState } from "react";
import { statusLabels } from "./requestRepository.js";
export const activityLabels = {
  request_created: "Request created",
  work_started: "Work started",
  placed_on_hold: "Placed on hold",
  work_resumed: "Work resumed",
  request_closed: "Request closed",
  request_reopened: "Request reopened",
  request_routed: "Request routed",
};
export default function RequestActivity({ repository, id, onAccessFailure }) {
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [state, setState] = useState(null);
  const heading = useRef(null),
    focusAfterPage = useRef(false);
  useEffect(() => {
    if (state?.data && focusAfterPage.current) {
      heading.current?.focus();
      focusAfterPage.current = false;
    }
  }, [state]);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    repository.activity(id, page, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, page });
      },
      (error) => {
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(error.status)) onAccessFailure(error);
        else setState({ error, page });
      },
    );
    return () => controller.abort();
  }, [repository, id, page, retry, onAccessFailure]);
  const current = state?.page === page ? state : null;
  return (
    <section
      className="request-activity"
      aria-labelledby="request-activity-heading"
    >
      <h3 id="request-activity-heading" ref={heading} tabIndex="-1">
        Request Activity
      </h3>
      <p className="text-body-secondary">Newest activity first</p>
      {!current && <p role="status">Loading activity…</p>}
      {current?.error && (
        <div>
          <p role="alert">Activity could not be loaded.</p>
          <button
            className="btn btn-secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry activity
          </button>
        </div>
      )}
      {current?.data && (
        <>
          {!current.data.items.length && (
            <p>No activity has been recorded for this request.</p>
          )}
          <ol className="request-activity-list">
            {current.data.items.map((event) => (
              <li key={event.id}>
                <h4>{activityLabels[event.type]}</h4>
                <p className="activity-attribution">
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>{" "}
                  · {event.actorDisplay}
                </p>
                {event.fromStatus && (
                  <p>
                    {statusLabels[event.fromStatus]} →{" "}
                    {statusLabels[event.toStatus]}
                  </p>
                )}
                {event.type === "request_routed" && (
                  <dl>
                    <dt>From</dt>
                    <dd>
                      {event.fromDepartment}
                      {event.fromDivision ? ` / ${event.fromDivision}` : ""}
                    </dd>
                    <dt>To</dt>
                    <dd>
                      {event.toDepartment}
                      {event.toDivision ? ` / ${event.toDivision}` : ""}
                    </dd>
                  </dl>
                )}
                {event.intakeChannel && (
                  <p>
                    Intake:{" "}
                    {{
                      web: "Web",
                      phone: "Phone",
                      walk_in: "In person",
                      staff: "Staff",
                      api: "API",
                    }[event.intakeChannel] || "Recorded intake"}
                  </p>
                )}
                {event.narrative && (
                  <>
                    <strong>
                      {event.type === "request_closed"
                        ? "Resolution"
                        : "Reason"}
                    </strong>
                    {event.narrative.length > 1000 ? (
                      <details>
                        <summary>Read narrative</summary>
                        <p className="activity-narrative">{event.narrative}</p>
                      </details>
                    ) : (
                      <p className="activity-narrative">{event.narrative}</p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
          <nav aria-label="Activity pages" className="request-pagination">
            <button
              className="btn btn-secondary"
              disabled={!current.data.hasPreviousPage}
              onClick={() => {
                focusAfterPage.current = true;
                setPage((n) => n - 1);
              }}
            >
              Newer activity
            </button>
            <span>Page {page}</span>
            <button
              className="btn btn-secondary"
              disabled={!current.data.hasNextPage}
              onClick={() => {
                focusAfterPage.current = true;
                setPage((n) => n + 1);
              }}
            >
              Older activity
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
