import RequestResults from "./RequestResults.jsx";
import SubmittedInformation from "./SubmittedInformation.jsx";
import { RequestEvidence } from "../../attachments/Attachments.jsx";
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
import {
  intakeChannelLabels,
  statusLabels,
  workspaceError,
} from "./requestRepository.js";
import "./staffRequests.css";
const lifecycleLabels = {
  start_work: "Start Work",
  resume: "Resume Work",
  hold: "Place on Hold",
  close: "Close Request",
  reopen: "Reopen Request",
};
const lifecycleIcons = {
  start_work: "play-fill",
  resume: "play-fill",
  hold: "pause-fill",
  close: "check-lg",
  reopen: "arrow-counterclockwise",
};
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Unavailable"
    : parsed.toLocaleString();
};
function mutationProblem(error, completed) {
  if (error?.status && error.status < 500) return workspaceError(error);
  return completed
    ? "The change was recorded, but the latest details could not be loaded. Check the latest request details before trying again."
    : "We couldn't confirm the result. Check the latest request details before trying again.";
}
function Failure({ error, message, retry, onSignIn }) {
  return (
    <div className="workspace-feedback">
      <p role="alert">{message || workspaceError(error)}</p>
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
const listSorts = {
  issue: "Issue / Reference",
  status: "Status",
  department: "Department / Division",
  assignment: "Assigned to",
  created: "Reported",
};
function listParams(next) {
  const query = new URLSearchParams();
  for (const field of [
    "audience",
    "assignment",
    "sort",
    "direction",
    "view",
    "search",
    "q",
    "status",
    "departmentId",
    "divisionId",
    "page",
    "pageSize",
  ])
    if (next[field]) query.set(field, String(next[field]));
  return query;
}
function RequestList({ repository, onSignIn }) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.min(1000000, Number(params.get("page")) || 1));
  const filters = {
    audience: params.get("audience") || "all",
    assignment: params.get("assignment") || "all",
    sort: params.get("sort") || "created",
    direction: params.get("direction") || "desc",
    view: params.get("view") || "all",
    search: params.get("search") || "",
    q: params.get("q") || "",
    status: params.get("status") || "",
    departmentId: params.get("departmentId") || "",
    divisionId: params.get("divisionId") || "",
    page,
    pageSize: [25, 50, 100].includes(Number(params.get("pageSize")))
      ? Number(params.get("pageSize"))
      : 25,
  };
  const key = JSON.stringify(filters);
  const urlKey = params.toString();
  const [searchDraft, setSearchDraft] = useState(null);
  useEffect(() => setSearchDraft(null), [urlKey]);
  const searchInput =
    searchDraft?.urlKey === urlKey ? searchDraft.value : filters.q;
  const normalizedSearch = searchInput.trim();
  const invalidSearch =
    normalizedSearch.length === 1 || searchInput.length > 160;
  const pendingSearch = normalizedSearch !== filters.q;
  const searchField = useRef(null);
  const [draft, setDraft] = useState(filters),
    [state, setState] = useState(null),
    [options, setOptions] = useState({ departments: [], divisions: [] }),
    [retry, setRetry] = useState(0);
  const heading = useRef(null);
  useEffect(() => {
    if (!pendingSearch || invalidSearch) return;
    const timer = setTimeout(() => {
      setParams(
        listParams({ ...JSON.parse(key), q: normalizedSearch, page: 1 }),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [key, normalizedSearch, pendingSearch, invalidSearch, setParams]);
  useEffect(() => {
    setDraft(JSON.parse(key));
  }, [key]);
  useEffect(() => {
    if (pendingSearch || invalidSearch) return;
    const controller = new AbortController();
    setState(null);
    Promise.all([
      repository.list(JSON.parse(key), controller.signal),
      repository.options(controller.signal),
    ]).then(
      ([data, options]) => {
        if (!controller.signal.aborted) {
          if (data.page > 1 && !data.items.length) {
            setParams(listParams({ ...JSON.parse(key), page: 1 }), {
              replace: true,
            });
            return;
          }
          setOptions(options);
          setState({ key, data });
        }
      },
      (error) => {
        if (!controller.signal.aborted) setState({ key, error });
      },
    );
    return () => controller.abort();
  }, [repository, key, retry, pendingSearch, invalidSearch, setParams]);
  const current =
    !pendingSearch && !invalidSearch && state?.key === key ? state : null;
  const apply = (next) => {
    const query = listParams({ ...next, q: normalizedSearch });
    setSearchDraft({ urlKey: query.toString(), value: searchInput });
    setParams(query);
  };
  const clearSearch = () => {
    setSearchDraft(null);
    setParams(listParams({ ...filters, q: "", page: 1 }));
    searchField.current?.focus();
  };
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
        <div className="request-filter-row request-filter-row-primary">
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
            <label htmlFor="request-view">Request View</label>
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
              <option value="mine">Assigned to me</option>
              <option value="team">My Team</option>
              <option value="watching">Watching</option>
            </select>
          </div>
          <div>
            <label htmlFor="request-assignment">Assignment</label>
            <select
              id="request-assignment"
              className="form-select"
              value={draft.assignment}
              onChange={(e) =>
                setDraft({ ...draft, assignment: e.target.value })
              }
            >
              <option value="all">All assignments</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>
        <div className="request-filter-row request-filter-row-secondary">
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
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setSearchDraft(null);
                setParams(new URLSearchParams());
              }}
            >
              Clear search and filters
            </button>
            <button className="btn btn-primary" type="submit">
              Apply Filters
            </button>
          </div>
        </div>
      </form>
      <h2 ref={heading} tabIndex="-1" className="visually-hidden">
        Requests
      </h2>
      <div
        className="request-list-controls"
        role="group"
        aria-label="Request list controls"
      >
        <div className="request-live-search">
          <label htmlFor="request-live-search">
            <i className="bi bi-search me-2" aria-hidden="true" />
            Search Requests
          </label>
          <div className="request-live-search-controls">
            <input
              ref={searchField}
              id="request-live-search"
              type="search"
              className="form-control"
              value={searchInput}
              maxLength={160}
              placeholder="Search by request #, issue, or service location"
              aria-describedby="request-live-search-help"
              aria-invalid={invalidSearch || undefined}
              onChange={(event) =>
                setSearchDraft({ urlKey, value: event.target.value })
              }
            />
            <button
              type="button"
              className="request-search-clear"
              aria-label="Clear search"
              onClick={clearSearch}
              disabled={!searchInput}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p id="request-live-search-help">
            {searchInput.length > 160
              ? "Use 160 characters or fewer."
              : invalidSearch
                ? "Enter at least 2 characters to search."
                : "Results update as you type."}
          </p>
        </div>
        <div>
          <label htmlFor="request-sort">Sort By</label>
          <select
            id="request-sort"
            className="form-select"
            value={filters.sort}
            onChange={(e) =>
              apply({ ...filters, sort: e.target.value, page: 1 })
            }
          >
            {Object.entries(listSorts).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="request-direction">Direction</label>
          <select
            id="request-direction"
            className="form-select"
            value={filters.direction}
            onChange={(e) =>
              apply({ ...filters, direction: e.target.value, page: 1 })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setRetry((n) => n + 1)}
        >
          Refresh
        </button>
      </div>
      {!current && !invalidSearch && (
        <p role="status" className="workspace-feedback">
          {pendingSearch ? "Waiting for search…" : "Loading requests…"}
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
            {current.data.total}{" "}
            {current.data.total === 1 ? "request" : "requests"} found
          </p>
          {!current.data.items.length ? (
            <div className="workspace-feedback">
              <h3>No requests found.</h3>
              <p>Try changing your search or filters.</p>
            </div>
          ) : (
            <RequestResults
              items={current.data.items}
              page={current.data.page}
              pageSize={current.data.pageSize}
              query={params.toString()}
              sort={filters.sort}
              direction={filters.direction}
              sortLabels={listSorts}
              onSort={(key) =>
                apply({
                  ...filters,
                  sort: key,
                  direction:
                    filters.sort === key && filters.direction === "asc"
                      ? "desc"
                      : "asc",
                  page: 1,
                })
              }
            />
          )}
        </>
      )}
      <nav aria-label="Request pages" className="request-pagination">
        {current?.data && (
          <p className="request-count">
            Showing{" "}
            {current.data.total
              ? (current.data.page - 1) * current.data.pageSize + 1
              : 0}
            –
            {Math.min(
              current.data.page * current.data.pageSize,
              current.data.total,
            )}{" "}
            of {current.data.total} requests
          </p>
        )}
        <div className="request-page-size">
          <label htmlFor="request-page-size">Rows per page</label>
          <select
            id="request-page-size"
            className="form-select"
            value={filters.pageSize}
            onChange={(event) =>
              apply({
                ...filters,
                pageSize: Number(event.target.value),
                page: 1,
              })
            }
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
        {current?.data && (
          <>
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
            <span>
              Page {current.data.page} of{" "}
              {Math.max(
                1,
                Math.ceil(current.data.total / current.data.pageSize),
              )}
            </span>
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
          </>
        )}
      </nav>
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
  const routineTrigger = useRef(null);
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
  useEffect(() => {
    const trigger = routineTrigger.current;
    if (trigger && !trigger.isConnected) {
      routineTrigger.current = null;
      if (document.activeElement === document.body) heading.current?.focus();
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
              : {
                  start_work: "Work started.",
                  hold: "Request placed on hold.",
                  resume: "Work resumed.",
                  close: "Request closed.",
                  reopen: "Request reopened.",
                }[input.action],
        );
    } catch (error) {
      if (signal.aborted) return;
      if (
        management &&
        !commandCompleted &&
        ![401, 404, 409].includes(error.status)
      ) {
        if (error.status === 403) await protectedContentAccessFailure(error);
        return { error: mutationProblem(error, commandCompleted) };
      }
      if (
        !commandCompleted &&
        narrativeAction &&
        ![401, 403, 404, 409].includes(error.status)
      ) {
        setNarrativeError(mutationProblem(error, commandCompleted));
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
      } else
        setState({ error, message: mutationProblem(error, commandCompleted) });
      if (management)
        return {
          error:
            error.status === 409
              ? "This request changed. Review the latest information before trying again."
              : mutationProblem(error, commandCompleted),
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
      ? "start_work"
      : row?.status === "on_hold"
        ? "resume"
        : null;
  // Server capabilities remain the only source of available lifecycle commands.
  const lifecycleActions = [
    routineAction,
    ...(["open", "in_progress", "on_hold"].includes(row?.status)
      ? [...(row.status === "in_progress" ? ["hold"] : []), "close"]
      : row?.status === "closed"
        ? ["reopen"]
        : []),
  ].filter((action) => action && workflowActions.includes(action));
  const canRouteNow =
    row?.status !== "cancelled" && capabilities.canRoute === true;
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
          message={state.message}
          retry={() => setRetry((n) => n + 1)}
          onSignIn={onSignIn}
        />
      )}
      {row && (
        <article className="request-detail-grid request-workspace-layout">
          <ContentCard className="request-overview">
            <h3 className="visually-hidden">Overview</h3>
            <header className="request-identity">
              <IssueIcon
                icon={row.issueIcon}
                size="large"
                categoryId={row.categoryId}
              />
              <div className="request-identity-copy">
                <h2 className="request-issue-title" ref={heading} tabIndex="-1">
                  {row.issueName}
                </h2>
                <div className="request-identity-meta">
                  <ReferenceDisplay value={row.referenceNumber} />
                  <AudienceBadge value={row.audience} compact />
                  {row.intakeChannel && (
                    <span className="request-channel">
                      Intake Channel: {intakeChannelLabels[row.intakeChannel]}
                    </span>
                  )}
                  <Status value={row.status} />
                </div>
              </div>
            </header>
            <dl className="request-metadata">
              <div>
                <dt>Department / Division</dt>
                <dd>
                  {row.departmentName}
                  {row.divisionName && (
                    <span className="request-subline">{row.divisionName}</span>
                  )}
                </dd>
              </div>
              {row.categoryName && (
                <div>
                  <dt>Service Category</dt>
                  <dd>{row.categoryName}</dd>
                </div>
              )}
              <div>
                <dt>Assigned to</dt>
                <dd>
                  <TargetLabel target={row.assignment} />
                </dd>
              </div>
              <div>
                <dt>Reported</dt>
                <dd>
                  <time dateTime={row.createdAt}>{date(row.createdAt)}</time>
                </dd>
              </div>
            </dl>
            {["internal", "public"].includes(row.audience) && (
              <aside
                className={`request-audience-notice request-${row.audience}-notice`}
              >
                <i className="bi bi-info-circle-fill" aria-hidden="true" />
                <div>
                  <strong>
                    {row.audience === "internal"
                      ? "Internal Request"
                      : "Public Request"}
                  </strong>
                  <p>
                    {row.audience === "internal"
                      ? "Visible only to authorized staff."
                      : "This request is part of the public service request workflow."}
                  </p>
                </div>
              </aside>
            )}
          </ContentCard>
          <ContentCard className="request-details">
            <SectionHeading icon="file-earmark-text">
              Request Details
            </SectionHeading>
            <section className="request-description">
              <h4>Description</h4>
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
            {row.serviceLocation && (
              <section>
                <h4>Service Location</h4>
                <LocationDisplay value={row.serviceLocation} />
              </section>
            )}
          </ContentCard>
          <div className="request-column request-column-controls">
            {(lifecycleActions.length > 0 || canRouteNow) && (
              <ContentCard className="request-actions">
                <SectionHeading icon="lightning-charge">Actions</SectionHeading>
                {lifecycleActions.length > 0 && (
                  <div className="request-action-buttons">
                    {lifecycleActions.map((action) =>
                      action === routineAction ? (
                        <button
                          key={action}
                          className="btn btn-primary"
                          disabled={busy || Boolean(narrativeAction)}
                          onClick={(event) => {
                            routineTrigger.current = event.currentTarget;
                            void mutate("workflow", { action });
                          }}
                        >
                          <i
                            className={`bi bi-${lifecycleIcons[action]}`}
                            aria-hidden="true"
                          />{" "}
                          {lifecycleLabels[action]}
                        </button>
                      ) : (
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
                            className={`bi bi-${lifecycleIcons[action]}`}
                            aria-hidden="true"
                          />{" "}
                          {lifecycleLabels[action]}
                        </button>
                      ),
                    )}
                  </div>
                )}
                {canRouteNow && (
                  <button
                    ref={routeButton}
                    className="btn btn-secondary request-route-action"
                    disabled={busy || Boolean(narrativeAction)}
                    onClick={() => setRouting(true)}
                  >
                    <i className="bi bi-signpost-split" aria-hidden="true" />{" "}
                    Route Request
                  </button>
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
              </ContentCard>
            )}
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
            <ActivityPanel
              repository={repository}
              id={id}
              revision={row.revision}
              onAccessFailure={accessFailure}
            />
          </div>
          <div className="request-column request-column-content">
            <SubmittedInformation
              key={`answers:${id}`}
              id={id}
              repository={repository}
              canRead={capabilities.canReadAnswers}
              label="Additional Information"
            />
            <RequestEvidence
              key={`evidence:${id}`}
              repository={repository.attachments}
              requestId={id}
              onAccessFailure={protectedContentAccessFailure}
            />
            <CollaborationPanel
              key={id + ":" + row.audience}
              repository={repository}
              id={id}
              audience={row.audience}
              capabilities={capabilities}
              onAccessFailure={protectedContentAccessFailure}
            />
          </div>
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
          ← Back to Service Requests
        </Link>
      )}
      <header
        className={`staff-workspace-heading${requestId ? " visually-hidden" : ""}`}
      >
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
