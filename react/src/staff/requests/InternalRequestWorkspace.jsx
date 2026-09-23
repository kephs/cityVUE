import {
  StatusBadge as Status,
  AudienceBadge,
  IssueIcon,
  LocationDisplay,
  ReferenceDisplay,
  ContentCard,
  SectionHeading,
} from "../../components/ui/RequestPresentation.jsx";
import { TargetLabel } from "./RequestOwnership.jsx";
import ActivityPanel from "./ActivityPanel.jsx";
import RequestManagement from "./RequestManagement.jsx";
import CollaborationPanel from "./CollaborationPanel.jsx";
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
    audience: params.get("audience") || "all",
    view: params.get("view") || "all",
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
      "audience",
      "view",
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
    filters.audience !== "all" ||
    filters.view !== "all" ||
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
        <div>
          <label htmlFor="request-audience">Audience</label>
          <select
            id="request-audience"
            className="form-select"
            value={draft.audience || "all"}
            onChange={(e) => {
              const next = { ...draft, audience: e.target.value, page: 1 };
              setDraft(next);
              apply(next);
            }}
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="internal">Internal</option>
          </select>
        </div>
        <div>
          <label htmlFor="request-view">Request view</label>
          <select
            id="request-view"
            className="form-select"
            value={draft.view || "all"}
            onChange={(e) => {
              const next = { ...draft, view: e.target.value, page: 1 };
              setDraft(next);
              apply(next);
            }}
          >
            <option value="all">All Requests</option>
            <option value="mine">My Requests</option>
            <option value="team">My Team</option>
            <option value="watching">Watching</option>
          </select>
        </div>
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
                {filters.audience === "public"
                  ? "No Public requests match your filters."
                  : filters.audience === "internal"
                    ? "No Internal requests match your filters."
                    : filtered
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
                Service Requests available to you, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Issue / Reference</th>
                  <th scope="col">Status</th>
                  <th scope="col">Department / Division</th>
                  <th scope="col">Assignment</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {current.data.items.map((row) => (
                  <tr key={row.serviceRequestId}>
                    <th scope="row" data-label="Issue / Reference">
                      <Link
                        className="request-issue-link"
                        to={`/staff/requests/${encodeURIComponent(row.serviceRequestId)}?${params}`}
                      >
                        <IssueIcon icon={row.issueIcon} />
                        <span>{row.issueName}</span>
                      </Link>
                      <LocationDisplay value={row.serviceLocation} />
                      <AudienceBadge value={row.audience} />
                      <ReferenceDisplay value={row.referenceNumber} />
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
                    <td data-label="Assignment">
                      <TargetLabel target={row.assignment} />
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
  const [contactState, setContactState] = useState(null);
  const contactController = useRef(null);
  const clearContact = useCallback(() => {
    contactController.current?.abort();
    contactController.current = null;
    setContactState(null);
  }, []);
  useEffect(() => () => contactController.current?.abort(), [repository, id]);
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
  const accessFailure = useCallback(
    (error) => {
      clearContact();
      setState({ error });
      setNarrativeAction(null);
      setRouting(false);
    },
    [clearContact],
  );
  const initialFocus = useRef(false);
  const heading = useRef(null),
    routeButton = useRef(null),
    inFlight = useRef(false),
    controller = useRef(null);
  const protectedContentAccessFailure = useCallback(
    async (error) => {
      if (error.status !== 403) {
        accessFailure(error);
        return;
      }
      // A protected-content permission denial must not suppress an independently readable parent/contact.
      try {
        const signal = controller.current?.signal;
        const data = await repository.detail(id, signal);
        if (signal?.aborted) return;
        if (!data.canReadContact) clearContact();
        setState((current) => (current?.data ? { ...current, data } : current));
      } catch (parentError) {
        if (!controller.current?.signal.aborted) accessFailure(parentError);
      }
    },
    [repository, id, accessFailure, clearContact],
  );
  useEffect(() => {
    if (routing) document.getElementById("route-department")?.focus();
  }, [routing]);
  const read = async (signal) => {
    const [data, options] = await Promise.all([
      repository.detail(id, signal),
      repository.options(signal),
    ]);
    if (signal.aborted) return null;
    if (!data.canReadContact) clearContact();
    setState({ data, options });
    setDepartment(data.departmentId);
    setDivision(data.divisionId || "");
    return data;
  };
  const loadContact = async () => {
    if (!state?.data?.canReadContact || contactController.current) return;
    const request = new AbortController();
    contactController.current = request;
    setContactState({ loading: true });
    try {
      const data = await repository.contact(
        id,
        request.signal,
        state.data.audience,
      );
      if (!request.signal.aborted) setContactState({ data });
    } catch (error) {
      if (request.signal.aborted) return;
      if ([401, 404].includes(error.status)) accessFailure(error);
      else if (error.status === 403) {
        setContactState({ protected: true });
        // Recheck the parent too: loss of audience read access clears the whole request.
        try {
          await read(controller.current.signal);
        } catch (parentError) {
          if (!request.signal.aborted) accessFailure(parentError);
        }
      } else setContactState({ error: true });
    } finally {
      if (contactController.current === request)
        contactController.current = null;
    }
  };
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setState(null);
    clearContact();
    read(request.signal).catch((error) => {
      if (!request.signal.aborted) setState({ error });
    });
    return () => request.abort();
  }, [repository, id, retry]);
  useEffect(() => {
    if (state?.error) clearContact();
  }, [state?.error, clearContact]);
  useEffect(() => {
    if (state?.data && !initialFocus.current) {
      heading.current?.focus();
      initialFocus.current = true;
    }
  }, [state?.data]);
  const mutate = async (operation, input) => {
    if (
      inFlight.current ||
      !state?.data ||
      !(operation === "workflow"
        ? state.data.capabilities?.workflowActions?.includes(input.action)
        : state.data.capabilities?.[
            {
              route: "canRoute",
              assign: "canAssign",
              unassign: "canAssign",
              addWatcher: "canManageWatchers",
              removeWatcher: "canManageWatchers",
              watchSelf: "canWatchSelf",
              unwatchSelf: "canWatchSelf",
            }[operation]
          ] === true)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setNarrativeError("");
    const signal = controller.current.signal;
    const management = [
      "assign",
      "unassign",
      "addWatcher",
      "removeWatcher",
      "watchSelf",
      "unwatchSelf",
    ].includes(operation);
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
      const fresh = await read(signal);
      if (fresh)
        setNotice(
          [
            "assign",
            "unassign",
            "addWatcher",
            "removeWatcher",
            "watchSelf",
            "unwatchSelf",
          ].includes(operation)
            ? {
                assign: "Assignment updated.",
                unassign: "Request unassigned.",
                addWatcher: "Watcher added.",
                removeWatcher: "Watcher removed.",
                watchSelf: "You are now watching this request.",
                unwatchSelf: "You stopped watching this request.",
              }[operation]
            : operation === "route"
              ? "Request routed successfully."
              : `Request moved to ${statusLabels[fresh.status]}.`,
        );
    } catch (error) {
      if (signal.aborted) return;
      if (
        management &&
        !commandCompleted &&
        ![401, 404, 409].includes(error.status)
      ) {
        if (error.status === 403) await protectedContentAccessFailure(error);
        return { error: workspaceError(error) };
      }
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
      if (management)
        return {
          error:
            error.status === 409
              ? "This request changed. Review the latest information before trying again."
              : workspaceError(error),
        };
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  const row = state?.data;
  const capabilities = row?.capabilities || {};
  const workflowActions = capabilities.workflowActions || [];
  const routineAction =
    row?.status === "open"
      ? ["start_work", "Start Work"]
      : row?.status === "on_hold"
        ? ["resume", "Resume Work"]
        : null;
  return (
    <>
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
        <article className="request-detail-grid">
          <ContentCard className="request-detail">
            <header className="request-identity">
              <IssueIcon icon={row.issueIcon} size="large" />
              <div className="request-identity-copy">
                {row.categoryName && (
                  <p className="request-eyebrow">{row.categoryName}</p>
                )}
                <h2 className="request-issue-title" ref={heading} tabIndex="-1">
                  {row.issueName}
                </h2>
                <LocationDisplay value={row.serviceLocation} />
                <div className="request-identity-meta">
                  <AudienceBadge value={row.audience} />
                  <ReferenceDisplay value={row.referenceNumber} />
                </div>
              </div>
              <div className="request-current-status">
                <Status value={row.status} />
                <span>Last updated</span>
                <time dateTime={row.updatedAt}>{date(row.updatedAt)}</time>
              </div>
            </header>
            <dl className="request-metadata">
              {row.intakeChannel && (
                <div>
                  <dt>Intake channel</dt>
                  <dd>
                    {
                      {
                        web: "Web",
                        phone: "Phone",
                        walk_in: "Walk-in",
                        staff: "Staff",
                        api: "API",
                      }[row.intakeChannel]
                    }
                  </dd>
                </div>
              )}
              <div>
                <dt>
                  <i className="bi bi-buildings" aria-hidden="true" />{" "}
                  Department
                </dt>
                <dd>{row.departmentName}</dd>
              </div>
              <div>
                <dt>
                  <i className="bi bi-people" aria-hidden="true" /> Division
                </dt>
                <dd>{row.divisionName || "Department-level"}</dd>
              </div>
              <div>
                <dt>
                  <i className="bi bi-calendar3" aria-hidden="true" /> Created
                </dt>
                <dd>
                  <time dateTime={row.createdAt}>{date(row.createdAt)}</time>
                </dd>
              </div>
              <div>
                <dt>
                  <i className="bi bi-clock" aria-hidden="true" /> Updated
                </dt>
                <dd>
                  <time dateTime={row.updatedAt}>{date(row.updatedAt)}</time>
                </dd>
              </div>
            </dl>
            <section className="request-description">
              <SectionHeading icon="file-earmark-text">
                Description
              </SectionHeading>
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
            <aside className="request-internal-notice">
              <i className="bi bi-info-circle-fill" aria-hidden="true" />
              <div>
                <strong>
                  {row.audience === "public"
                    ? "Public Request"
                    : "Internal Request"}
                </strong>
                <p>
                  {row.audience === "public"
                    ? "Staff operational information is protected. Requester contact requires separate permission."
                    : "This is an internal request. Requester contact requires separate permission."}
                </p>
              </div>
            </aside>
          </ContentCard>
          <div className="request-supporting-controls">
            <ContentCard className="request-actions">
              <SectionHeading icon="lightning-charge-fill">
                Actions
              </SectionHeading>
              {!workflowActions.length && !capabilities.canRoute ? (
                <p>You have read-only access to this request.</p>
              ) : (
                <>
                  <div className="request-action-buttons">
                    {routineAction &&
                      workflowActions.includes(routineAction[0]) && (
                        <button
                          className="btn btn-primary"
                          disabled={busy || Boolean(narrativeAction)}
                          onClick={() =>
                            mutate("workflow", { action: routineAction[0] })
                          }
                        >
                          <i className="bi bi-play-fill" aria-hidden="true" />{" "}
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
                    )
                      .filter((action) => workflowActions.includes(action))
                      .map((action) => (
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
                          <i
                            className={`bi bi-${{ hold: "pause-fill", close: "check-lg", reopen: "arrow-counterclockwise" }[action]}`}
                            aria-hidden="true"
                          />{" "}
                          {
                            {
                              hold: "Place On Hold",
                              close: "Close Request",
                              reopen: "Reopen Request",
                            }[action]
                          }
                        </button>
                      ))}
                    {row.status !== "cancelled" && capabilities.canRoute && (
                      <button
                        ref={routeButton}
                        className="btn btn-secondary"
                        disabled={busy || Boolean(narrativeAction)}
                        onClick={() => setRouting(true)}
                      >
                        <i
                          className="bi bi-signpost-split"
                          aria-hidden="true"
                        />{" "}
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
            </ContentCard>
            <RequestManagement
              repository={repository}
              id={id}
              row={row}
              busy={busy || Boolean(narrativeAction) || routing}
              onMutate={mutate}
              onAccessFailure={protectedContentAccessFailure}
              contactState={contactState}
              loadContact={loadContact}
              clearContact={clearContact}
            />
          </div>
          <CollaborationPanel
            key={id + ":" + row.audience}
            repository={repository}
            id={id}
            audience={row.audience}
            capabilities={capabilities}
            onAccessFailure={protectedContentAccessFailure}
          />
          <ContentCard className="request-issue-details">
            <SectionHeading icon="tag">Issue Details</SectionHeading>
            <dl className="request-metadata">
              <div>
                <dt>Issue</dt>
                <dd>{row.issueName}</dd>
              </div>
              {row.categoryName && (
                <div>
                  <dt>Service category</dt>
                  <dd>{row.categoryName}</dd>
                </div>
              )}
            </dl>
          </ContentCard>
          <ActivityPanel
            repository={repository}
            id={id}
            revision={row.revision}
            onAccessFailure={accessFailure}
          />
        </article>
      )}
    </>
  );
}
export default function InternalRequestWorkspace({ repository, onSignIn }) {
  const { requestId } = useParams();
  const [params] = useSearchParams();
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
      {requestId && (
        <Link className="workspace-back" to={`/staff/requests?${params}`}>
          ← Back to requests
        </Link>
      )}
      <header className="staff-workspace-heading">
        <div>
          <p className="request-eyebrow">STAFF WORKSPACE</p>
          <h1 id="staff-requests-heading">
            {requestId ? "Service Request" : "Service Requests"}
          </h1>
          <p>Manage service requests within your authorized scope.</p>
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
