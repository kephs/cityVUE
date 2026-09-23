import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { statusLabels } from "./requestRepository.js";

export default function RequesterHistory({
  repository,
  id,
  onAccessFailure,
  onNavigate,
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    repository.requesterHistory(id, page, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ id, page, data });
      },
      (problem) => {
        if (controller.signal.aborted) return;
        setState({ id, page, error: true });
        if ([401, 403, 404].includes(problem.status)) onAccessFailure(problem);
      },
    );
    return () => controller.abort();
  }, [repository, id, page, attempt, onAccessFailure]);
  const current = state?.id === id && state?.page === page ? state : null;
  if (!current) return <p role="status">Loading requester history…</p>;
  if (current.error)
    return (
      <div>
        <p role="alert">
          Requester history could not be loaded. Please try again.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setAttempt(attempt + 1)}
        >
          Retry requester history
        </button>
      </div>
    );
  const { data } = current;
  return (
    <div className="requester-history">
      <p role="status">
        {data.total} accessible {data.total === 1 ? "request" : "requests"}
      </p>
      <h3>Recent requests</h3>
      {data.items.length === 0 ? (
        <p>No accessible requests on this page.</p>
      ) : (
        <ul className="requester-history-list">
          {data.items.map((item) => (
            <li key={item.serviceRequestId}>
              <Link
                to={`/staff/requests/${item.serviceRequestId}`}
                onClick={onNavigate}
              >
                {item.issueName} — {item.referenceNumber}
              </Link>
              {item.current && <strong>Current request</strong>}
              <span>
                {statusLabels[item.status]} ·{" "}
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleDateString()}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(data.hasPreviousPage || data.hasNextPage) && (
        <nav
          aria-label="Requester history pages"
          className="requester-history-pages"
        >
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!data.hasPreviousPage}
            onClick={() => setPage(page - 1)}
          >
            Previous history page
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!data.hasNextPage}
            onClick={() => setPage(page + 1)}
          >
            Next history page
          </button>
        </nav>
      )}
      {data.categories.length > 0 && (
        <>
          <h3>Issue categories</h3>
          <ul>
            {data.categories.map((category, index) => (
              <li key={index}>
                {category.name} — {category.count}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
