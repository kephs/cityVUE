import { activityPresentation } from "../../components/ui/presentation.js";
import { StatusBadge } from "../../components/ui/RequestPresentation.jsx";
import { useEffect, useRef, useState } from "react";
import { statusLabels } from "./requestRepository.js";
export const activityLabels = Object.fromEntries(
  Object.entries(activityPresentation).map(([type, meta]) => [
    type,
    meta.label,
  ]),
);
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
      className="request-activity ui-card"
      aria-labelledby="request-activity-heading"
    >
      <h3 id="request-activity-heading" ref={heading} tabIndex="-1">
        <i className="bi bi-clock-history" aria-hidden="true" /> Request
        Activity
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
              <li
                key={event.id}
                className={`activity-item tone-${activityPresentation[event.type]?.tone || "created"}`}
              >
                <span className="activity-marker" aria-hidden="true">
                  <i
                    className={`bi bi-${activityPresentation[event.type]?.icon || "file-earmark-text"}`}
                  />
                </span>
                <div className="activity-content">
                  <h4>{activityLabels[event.type] || "Recorded activity"}</h4>
                  <p className="activity-attribution">
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleString()}
                    </time>{" "}
                    · {event.actorDisplay}
                  </p>
                  {event.fromStatus && (
                    <p>
                      {statusLabels[event.fromStatus]} →{" "}
                      <StatusBadge value={event.toStatus} />
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
                  {(event.fromTargetName || event.toTargetName) && (
                    <dl className="activity-targets">
                      {event.fromTargetName && (
                        <div>
                          <dt>
                            {event.type === "request_reassigned"
                              ? "From"
                              : event.type === "watcher_removed"
                                ? "Watcher removed"
                                : "Previous assignment"}
                          </dt>
                          <dd>
                            {event.fromTargetName}{" "}
                            <span className="text-body-secondary">
                              ·{" "}
                              {
                                { staff: "Staff", role: "Role", group: "Team" }[
                                  event.fromTargetType
                                ]
                              }
                            </span>
                          </dd>
                        </div>
                      )}
                      {event.toTargetName && (
                        <div>
                          <dt>
                            {event.type === "request_reassigned"
                              ? "To"
                              : event.type === "watcher_added"
                                ? "Watcher"
                                : "Assigned to"}
                          </dt>
                          <dd>
                            {event.toTargetName}{" "}
                            <span className="text-body-secondary">
                              ·{" "}
                              {
                                { staff: "Staff", role: "Role", group: "Team" }[
                                  event.toTargetType
                                ]
                              }
                            </span>
                          </dd>
                        </div>
                      )}
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
                    <div className="activity-narrative-card">
                      <strong>
                        {event.type === "request_closed"
                          ? "Resolution"
                          : "Reason"}
                      </strong>
                      {event.narrative.length > 1000 ? (
                        <details>
                          <summary>Read narrative</summary>
                          <p className="activity-narrative">
                            {event.narrative}
                          </p>
                        </details>
                      ) : (
                        <p className="activity-narrative">{event.narrative}</p>
                      )}
                    </div>
                  )}
                </div>
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
