import RequestActivity from "./RequestActivity.jsx";
import WorkflowNarrativeForm from "./WorkflowNarrativeForm.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { statusLabels, workspaceError } from "./requestRepository.js";
import "./staffRequests.css";
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Unavailable"
    : parsed.toLocaleString();
};
function Status({ value }) {
  return (
    <span className={`request-status status-${value}`}>
      {statusLabels[value] || "Unavailable"}
    </span>
  );
}
function Failure({ error, retry, onSignIn }) {
  return (
    <div className="workspace-feedback">
      <p role="alert">{workspaceError(error)}</p>
      {error?.status === 401 && onSignIn ? (
        <button className="btn btn-primary" onClick={onSignIn}>
          Sign in again
        </button>
      ) : (
        <button className="btn btn-secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
function ScopeFields({
  options,
  departmentId,
  divisionId,
  onDepartment,
  onDivision,
  prefix,
}) {
  return (
    <>
      <div>
        <label htmlFor={`${prefix}-department`}>Department</label>
        <select
          id={`${prefix}-department`}
          className="form-select"
          value={departmentId}
          onChange={(e) => onDepartment(e.target.value)}
        >
          <option value="">
            {prefix === "route"
              ? "Choose a department"
              : "All available departments"}
          </option>
          {options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}-division`}>Division</label>
        <select
          id={`${prefix}-division`}
          className="form-select"
          value={divisionId}
          onChange={(e) => onDivision(e.target.value)}
          disabled={!departmentId}
        >
          <option value="">
            {prefix === "route"
              ? "Department-level routing"
              : "All available divisions"}
          </option>
          {options.divisions
            .filter((d) => d.departmentId === departmentId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      </div>
    </>
  );
}
function RequestList({ repository, onSignIn }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(1000000, Number(params.get("page")) || 1));
  const filters = {
    search: params.get("search") || "",
    status: params.get("status") || "",
    departmentId: params.get("departmentId") || "",
    divisionId: params.get("divisionId") || "",
    page,
    pageSize: 25,
  };
  const key = JSON.stringify(filters);
  const [draft, setDraft] = useState(filters),
    [state, setState] = useState(null),
    [retry, setRetry] = useState(0);
  const heading = useRef(null);
  useEffect(() => {
    setDraft(JSON.parse(key));
    const controller = new AbortController();
    setState(null);
    Promise.all([
      repository.list(JSON.parse(key), controller.signal),
      repository.options(controller.signal),
    ]).then(
      ([data, options]) => {
        if (!controller.signal.aborted) setState({ key, data, options });
      },
      (error) => {
        if (!controller.signal.aborted) setState({ key, error });
      },
    );
    return () => controller.abort();
  }, [repository, key, retry]);
  const current = state?.key === key ? state : null;
  const options = current?.options || { departments: [], divisions: [] };
  const apply = (next) => {
    const query = new URLSearchParams();
    for (const field of [
      "search",
      "status",
      "departmentId",
      "divisionId",
      "page",
    ])
      if (next[field]) query.set(field, String(next[field]));
    setParams(query);
  };
  const filtered = Boolean(
    filters.search ||
    filters.status ||
    filters.departmentId ||
    filters.divisionId,
  );
  return (
    <>
      <form
        className="request-filters"
        aria-label="Request filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...draft, page: 1 });
        }}
      >
        <div className="request-search">
          <label htmlFor="request-search">Reference</label>
          <input
            id="request-search"
            type="search"
            className="form-control"
            maxLength={100}
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            placeholder="Enter a complete reference"
          />
        </div>
        <div>
          <label htmlFor="request-status">Status</label>
          <select
            id="request-status"
            className="form-select"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <ScopeFields
          options={options}
          departmentId={draft.departmentId}
          divisionId={draft.divisionId}
          onDepartment={(value) =>
            setDraft({ ...draft, departmentId: value, divisionId: "" })
          }
          onDivision={(value) => setDraft({ ...draft, divisionId: value })}
          prefix="filter"
        />
        <div className="filter-actions">
          <button className="btn btn-primary" type="submit">
            Apply filters
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => apply({})}
          >
            Reset
          </button>
        </div>
      </form>
      <div className="request-results-heading">
        <h2 ref={heading} tabIndex="-1">
          Requests
        </h2>
        <button
          className="btn btn-secondary"
          onClick={() => setRetry((n) => n + 1)}
        >
          Refresh
        </button>
      </div>
      {!current && (
        <p role="status" className="workspace-feedback">
          Loading requests…
        </p>
      )}
      {current?.error && (
        <Failure
          error={current.error}
          retry={() => setRetry((n) => n + 1)}
          onSignIn={onSignIn}
        />
      )}
      {current?.data && (
        <>
          <p role="status" className="request-count">
            {current.data.total} requests · Page {current.data.page}
          </p>
          {!current.data.items.length ? (
            <div className="workspace-feedback">
              <h3>
                {filtered
                  ? "No requests match your current filters."
                  : "No requests to display."}
              </h3>
              <p>
                {filtered
                  ? "Try another search or reset your filters."
                  : "Requests available to you will appear here."}
              </p>
            </div>
          ) : (
            <table className="staff-request-table">
              <caption className="visually-hidden">
                Internal Service Requests available to you, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Reference / Issue</th>
                  <th scope="col">Status</th>
                  <th scope="col">Department / Division</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {current.data.items.map((row) => (
                  <tr key={row.serviceRequestId}>
                    <th scope="row" data-label="Reference / Issue">
                      <Link
                        className="request-reference-link"
                        to={`/staff/requests/${encodeURIComponent(row.serviceRequestId)}?${params}`}
                      >
                        {row.referenceNumber}
                      </Link>
                      <span className="request-subline">{row.issueName}</span>
                    </th>
                    <td data-label="Status">
                      <Status value={row.status} />
                    </td>
                    <td data-label="Department / Division">
                      {row.departmentName}
                      {row.divisionName && (
                        <span className="request-subline">
                          {row.divisionName}
                        </span>
                      )}
                    </td>
                    <td data-label="Created">
                      <time dateTime={row.createdAt}>
                        {date(row.createdAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <nav aria-label="Request pages" className="request-pagination">
            <button
              className="btn btn-secondary"
              disabled={!current.data.hasPreviousPage}
              onClick={() => {
                apply({ ...filters, page: page - 1 });
                heading.current?.focus();
              }}
            >
              Previous
            </button>
            <span>Page {current.data.page}</span>
            <button
              className="btn btn-secondary"
              disabled={!current.data.hasNextPage}
              onClick={() => {
                apply({ ...filters, page: page + 1 });
                heading.current?.focus();
              }}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </>
  );
}
function RequestDetail({ repository, id, onSignIn }) {
  const [params] = useSearchParams();
  const [state, setState] = useState(null),
    [retry, setRetry] = useState(0),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [routing, setRouting] = useState(false),
    [department, setDepartment] = useState(""),
    [division, setDivision] = useState("");
  const [narrativeAction, setNarrativeAction] = useState(null),
    [narrativeError, setNarrativeError] = useState("");
  const narrativeTrigger = useRef(null);
  const accessFailure = useCallback((error) => {
    setState({ error });
    setNarrativeAction(null);
    setRouting(false);
  }, []);
  const heading = useRef(null),
    routeButton = useRef(null),
    inFlight = useRef(false),
    controller = useRef(null);
  useEffect(() => {
    if (routing) document.getElementById("route-department")?.focus();
  }, [routing]);
  const read = async (signal) => {
    const [data, options] = await Promise.all([
      repository.detail(id, signal),
      repository.options(signal),
    ]);
    if (signal.aborted) return null;
    setState({ data, options });
    setDepartment(data.departmentId);
    setDivision(data.divisionId || "");
    return data;
  };
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setState(null);
    read(request.signal).catch((error) => {
      if (!request.signal.aborted) setState({ error });
    });
    return () => request.abort();
  }, [repository, id, retry]);
  useEffect(() => {
    if (state?.data) heading.current?.focus();
  }, [state?.data]);
  const mutate = async (operation, input) => {
    if (inFlight.current || !state?.data || !state.options.canUpdate) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setNarrativeError("");
    const signal = controller.current.signal;
    let commandCompleted = false;
    try {
      await repository[operation](
        id,
        { ...input, expectedRevision: state.data.revision },
        signal,
      );
      if (signal.aborted) return;
      commandCompleted = true;
      setRouting(false);
      setNarrativeAction(null);
      setState(null);
      const fresh = await read(signal);
      if (fresh)
        setNotice(
          operation === "route"
            ? "Request routed successfully."
            : `Request moved to ${statusLabels[fresh.status]}.`,
        );
    } catch (error) {
      if (signal.aborted) return;
      if (
        !commandCompleted &&
        narrativeAction &&
        ![401, 403, 404, 409].includes(error.status)
      ) {
        setNarrativeError(workspaceError(error));
        return;
      }
      setNarrativeAction(null);
      setRouting(false);
      setState(null);
      if (error.status === 409) {
        try {
          await read(signal);
          if (!signal.aborted)
            setNotice(
              "This request changed. The latest information has been loaded. Review it before trying again.",
            );
        } catch (refreshError) {
          if (!signal.aborted) setState({ error: refreshError });
        }
      } else setState({ error });
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  const row = state?.data;
  const routineAction =
    row?.status === "open"
      ? ["start_work", "Start Work"]
      : row?.status === "on_hold"
        ? ["resume", "Resume Work"]
        : null;
  return (
    <>
      <Link className="workspace-back" to={`/staff/requests?${params}`}>
        ← Back to requests
      </Link>
      <p role="status" className="workspace-notice">
        {busy ? "Updating request…" : notice}
      </p>
      {!state && (
        <p role="status" className="workspace-feedback">
          Loading request…
        </p>
      )}
      {state?.error && (
        <Failure
          error={state.error}
          retry={() => setRetry((n) => n + 1)}
          onSignIn={onSignIn}
        />
      )}
      {row && (
        <article className="request-detail">
          <header>
            <div>
              <p className="request-eyebrow">INTERNAL REQUEST</p>
              <h2
                className="request-detail-reference"
                ref={heading}
                tabIndex="-1"
              >
                {row.referenceNumber}
              </h2>
              <p>{row.issueName}</p>
            </div>
            <Status value={row.status} />
          </header>
          <dl className="request-metadata">
            <div>
              <dt>Department</dt>
              <dd>{row.departmentName}</dd>
            </div>
            <div>
              <dt>Division</dt>
              <dd>{row.divisionName || "Department-level"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time dateTime={row.createdAt}>{date(row.createdAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>
                <time dateTime={row.updatedAt}>{date(row.updatedAt)}</time>
              </dd>
            </div>
          </dl>
          <section className="request-description">
            <h3>Description</h3>
            {row.description.length > 1200 ? (
              <>
                <p>{row.description.slice(0, 1200)}…</p>
                <details>
                  <summary>Read full description</summary>
                  <p>{row.description}</p>
                </details>
              </>
            ) : (
              <p>{row.description}</p>
            )}
          </section>
          <section className="request-actions">
            <h3>Actions</h3>
            {!state.options.canUpdate ? (
              <p>You have read-only access to this request.</p>
            ) : (
              <>
                <div className="request-action-buttons">
                  {routineAction && (
                    <button
                      className="btn btn-primary"
                      disabled={busy || Boolean(narrativeAction)}
                      onClick={() =>
                        mutate("workflow", { action: routineAction[0] })
                      }
                    >
                      {routineAction[1]}
                    </button>
                  )}
                  {(["open", "in_progress", "on_hold"].includes(row.status)
                    ? [
                        ...(row.status === "in_progress" ? ["hold"] : []),
                        "close",
                      ]
                    : row.status === "closed"
                      ? ["reopen"]
                      : []
                  ).map((action) => (
                    <button
                      key={action}
                      className="btn btn-secondary"
                      disabled={busy || Boolean(narrativeAction)}
                      onClick={(e) => {
                        narrativeTrigger.current = e.currentTarget;
                        setRouting(false);
                        setNarrativeError("");
                        setNarrativeAction(action);
                      }}
                    >
                      {
                        {
                          hold: "Place On Hold",
                          close: "Close Request",
                          reopen: "Reopen Request",
                        }[action]
                      }
                    </button>
                  ))}
                  {row.status !== "cancelled" && (
                    <button
                      ref={routeButton}
                      className="btn btn-secondary"
                      disabled={busy || Boolean(narrativeAction)}
                      onClick={() => setRouting(true)}
                    >
                      Route Request
                    </button>
                  )}
                </div>
                {row.status === "cancelled" && (
                  <p>Cancelled requests have no workflow actions.</p>
                )}
                {narrativeAction && (
                  <WorkflowNarrativeForm
                    key={narrativeAction}
                    action={narrativeAction}
                    busy={busy}
                    error={narrativeError}
                    onCancel={() => {
                      setNarrativeAction(null);
                      setNarrativeError("");
                      requestAnimationFrame(() =>
                        narrativeTrigger.current?.focus(),
                      );
                    }}
                    onSubmit={(input) => mutate("workflow", input)}
                  />
                )}
                {routing && (
                  <form
                    className="routing-form"
                    aria-label="Route Request"
                    onSubmit={(e) => {
                      e.preventDefault();
                      mutate("route", {
                        departmentId: department,
                        divisionId: division || null,
                      });
                    }}
                  >
                    <h4>Route Request</h4>
                    <fieldset disabled={busy}>
                      <legend className="visually-hidden">
                        Choose an authorized destination
                      </legend>
                      <ScopeFields
                        options={state.options}
                        departmentId={department}
                        divisionId={division}
                        onDepartment={(value) => {
                          setDepartment(value);
                          setDivision("");
                        }}
                        onDivision={setDivision}
                        prefix="route"
                      />
                      <div className="request-action-buttons">
                        <button
                          className="btn btn-primary"
                          disabled={
                            !department ||
                            (department === row.departmentId &&
                              (division || null) === (row.divisionId || null))
                          }
                        >
                          Confirm routing
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setRouting(false);
                            routeButton.current?.focus();
                          }}
                        >
                          Cancel routing
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </>
            )}
          </section>
          <RequestActivity
            key={`${id}:${row.revision}`}
            repository={repository}
            id={id}
            onAccessFailure={accessFailure}
          />
        </article>
      )}
    </>
  );
}
export default function InternalRequestWorkspace({ repository, onSignIn }) {
  const { requestId } = useParams();
  useEffect(() => {
    const previous = document.title;
    document.title = "Service Requests | CityVUE";
    return () => {
      document.title = previous;
    };
  }, []);
  return (
    <section
      className="staff-request-workspace"
      aria-labelledby="staff-requests-heading"
    >
      <header className="staff-workspace-heading">
        <div>
          <p className="request-eyebrow">STAFF WORKSPACE</p>
          <h1 id="staff-requests-heading">Service Requests</h1>
          <p>Manage internal requests within your authorized scope.</p>
        </div>
      </header>
      {requestId ? (
        <RequestDetail
          key={requestId}
          id={requestId}
          repository={repository}
          onSignIn={onSignIn}
        />
      ) : (
        <RequestList repository={repository} onSignIn={onSignIn} />
      )}
    </section>
  );
}
