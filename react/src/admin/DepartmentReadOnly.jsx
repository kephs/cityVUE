import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDepartmentReader,
  departmentReadError,
} from "./departmentReader.js";
import IssueDrawer from "./IssueDrawer.jsx";
import "./issueWorkspace.css";
import "./departmentsConfiguration.css";
import "./departmentReadOnly.css";

// The loader identity is checked during render, not only in an effect, so old
// records never render while a changed request is awaiting authorization.
function useRead(load, onDenied) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => load(controller.signal))
      .then(
        (data) => {
          if (!controller.signal.aborted) setResult({ load, data });
        },
        (error) => {
          if (controller.signal.aborted) return;
          if ([401, 403].includes(error?.status)) onDenied(error);
          setResult({ load, error });
        },
      );
    return () => controller.abort();
  }, [load, onDenied]);
  return result?.load === load ? result : null;
}
function Failure({ error, retry }) {
  return (
    <div className="departments-workspace">
      <p role="alert">{departmentReadError(error)}</p>
      <button className="btn btn-outline-secondary" onClick={retry}>
        Retry
      </button>
    </div>
  );
}
function Pager({ data, onPage, label }) {
  return (
    <nav className="department-read-pager" aria-label={label}>
      <button
        className="btn btn-outline-secondary"
        disabled={data.page === 1}
        onClick={() => onPage(data.page - 1)}
      >
        Previous {label}
      </button>
      <span>
        Page {data.page} · {data.total} matching results
      </span>
      <button
        className="btn btn-outline-secondary"
        disabled={data.page * data.pageSize >= data.total || data.page >= 10000}
        onClick={() => onPage(data.page + 1)}
      >
        Next {label}
      </button>
    </nav>
  );
}
function Metadata({ record }) {
  return (
    <>
      <p>{record.description ?? "No description provided."}</p>
      <p>
        <span
          className={`department-status department-status--${record.status}`}
        >
          {record.status}
        </span>{" "}
        · Display order: {record.displayOrder}
      </p>
    </>
  );
}
function Details({ reader, departmentId, onClose, onDenied }) {
  const [divisionPage, setDivisionPage] = useState(1),
    [categoryPage, setCategoryPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const load = useMemo(
    () => async (signal) => {
      const [detail, divisions, categories] = await Promise.all([
        reader.detail(departmentId, signal),
        reader.divisions(departmentId, { page: divisionPage }, signal),
        reader.categories(departmentId, { page: categoryPage }, signal),
      ]);
      return { detail, divisions, categories };
    },
    [reader, departmentId, divisionPage, categoryPage, attempt],
  );
  const result = useRead(load, onDenied);
  return (
    <IssueDrawer
      title="Department details"
      subtitle="Read-only configuration"
      onClose={onClose}
    >
      {!result ? (
        <p role="status">Loading Department details and relationships…</p>
      ) : result.error ? (
        <Failure error={result.error} retry={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          <h3>{result.data.detail.name}</h3>
          <Metadata record={result.data.detail} />
          <p>
            {result.data.detail.divisionCount} Divisions ·{" "}
            {result.data.detail.categoryCount} Issue Categories
          </p>
          <section aria-label="Divisions">
            <h3>Divisions</h3>
            {!result.data.divisions.items.length && (
              <p>No Divisions on this page.</p>
            )}
            <ul className="department-read-relationships">
              {result.data.divisions.items.map((item) => (
                <li key={item.id}>
                  <h4>{item.name}</h4>
                  <Metadata record={item} />
                </li>
              ))}
            </ul>
            <Pager
              data={result.data.divisions}
              onPage={setDivisionPage}
              label="Divisions"
            />
          </section>
          <section aria-label="Issue Categories">
            <h3>Issue Categories</h3>
            <p>
              Service definition counts include all statuses. They are not
              counts of published resident services.
            </p>
            {!result.data.categories.items.length && (
              <p>No Issue Categories on this page.</p>
            )}
            <ul className="department-read-relationships">
              {result.data.categories.items.map((item) => (
                <li key={item.id}>
                  <h4>{item.name}</h4>
                  <Metadata record={item} />
                  <p>
                    {item.divisionId === null
                      ? "Directly under this Department; no Division."
                      : `Division ID: ${item.divisionId}`}
                  </p>
                  <p>{item.serviceDefinitionCount} service definitions</p>
                </li>
              ))}
            </ul>
            <Pager
              data={result.data.categories}
              onPage={setCategoryPage}
              label="Issue Categories"
            />
          </section>
        </>
      )}
    </IssueDrawer>
  );
}
function Directory({ client, onDenied }) {
  const reader = useMemo(() => createDepartmentReader(client), [client]);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 25,
    search: "",
    status: "all",
    sort: "displayOrder",
    direction: "asc",
  });
  const [search, setSearch] = useState(""),
    [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState(null);
  const opener = useRef(null),
    heading = useRef(null);
  const load = useMemo(
    () => (signal) => reader.departments(query, signal),
    [reader, query, attempt],
  );
  const result = useRead(load, onDenied);
  const change = (patch) =>
    setQuery((previous) => ({ ...previous, ...patch, page: 1 }));
  const close = () => {
    setSelected(null);
    (opener.current?.isConnected ? opener.current : heading.current)?.focus();
  };
  return (
    <section
      className="departments-workspace department-read-only"
      aria-label="Read-only Department directory"
    >
      <div className="department-boundary">
        <strong>Read-only Department configuration</strong>
        <p>
          Records come from your authorized Organization. Creating, editing and
          relationship changes are unavailable here.
        </p>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        Department directory
      </h2>
      <form
        className="department-controls"
        onSubmit={(event) => {
          event.preventDefault();
          change({ search });
        }}
      >
        <label>
          Search Departments
          <input
            className="form-control"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Status
          <select
            className="form-select"
            value={query.status}
            onChange={(event) => change({ status: event.target.value })}
          >
            {["all", "active", "inactive", "archived"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select
            className="form-select"
            value={query.sort}
            onChange={(event) => change({ sort: event.target.value })}
          >
            <option value="displayOrder">Display order</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label>
          Direction
          <select
            className="form-select"
            value={query.direction}
            onChange={(event) => change({ direction: event.target.value })}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <label>
          Results per page
          <select
            className="form-select"
            value={query.pageSize}
            onChange={(event) =>
              change({ pageSize: Number(event.target.value) })
            }
          >
            {[10, 25, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>
      <button
        className="btn btn-outline-secondary"
        onClick={() => setAttempt((n) => n + 1)}
      >
        Refresh Departments
      </button>
      {!result ? (
        <p role="status">Loading authorized Departments…</p>
      ) : result.error ? (
        <Failure error={result.error} retry={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          <p role="status">
            {result.data.total} matching Departments across all pages. This is
            the server total for the current filters, not an Organization-wide
            status summary.
          </p>
          {!result.data.items.length && (
            <p className="department-empty">
              No Departments on this page. Adjust the filters or return to an
              earlier page.
            </p>
          )}
          <ul className="department-directory">
            {result.data.items.map((record) => (
              <li key={record.id}>
                <h3>{record.name}</h3>
                <Metadata record={record} />
                <p>
                  {record.divisionCount} Divisions · {record.categoryCount}{" "}
                  Issue Categories
                </p>
                <button
                  className="btn btn-outline-secondary"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setSelected(record.id);
                  }}
                  aria-label={`View ${record.name}`}
                >
                  View details
                </button>
              </li>
            ))}
          </ul>
          <Pager
            data={result.data}
            label="Departments"
            onPage={(page) => setQuery((previous) => ({ ...previous, page }))}
          />
        </>
      )}
      {selected && (
        <Details
          key={selected}
          reader={reader}
          departmentId={selected}
          onClose={close}
          onDenied={onDenied}
        />
      )}
    </section>
  );
}
function Session({ client }) {
  const [denied, setDenied] = useState(null),
    [attempt, setAttempt] = useState(0);
  const onDenied = useCallback(
    (error) => setDenied({ status: error.status }),
    [],
  );
  // Any unauthorized read removes the entire live subtree, including open details.
  if (denied)
    return (
      <Failure
        error={denied}
        retry={() => {
          setDenied(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  return <Directory key={attempt} client={client} onDenied={onDenied} />;
}
export default function DepartmentReadOnly({
  client,
  authorizationContext = client,
}) {
  const [session, setSession] = useState({
    client,
    authorizationContext,
    epoch: 0,
  });
  if (
    session.client !== client ||
    session.authorizationContext !== authorizationContext
  ) {
    setSession({ client, authorizationContext, epoch: session.epoch + 1 });
    return <p role="status">Loading authorized Departments…</p>;
  }
  return <Session key={session.epoch} client={client} />;
}
