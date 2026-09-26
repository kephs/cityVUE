import { useEffect, useRef, useState } from "react";
import IssueDrawer from "./IssueDrawer.jsx";
import "./issueWorkspace.css";
import "./accessDiscovery.css";

const defaults = {
  status: "all",
  category: "",
  department: "",
  division: "",
  source: "all",
  search: "",
  page: 1,
  pageSize: 25,
};
const sources = {
  managed: "Assigned in Access & Permissions",
  existing: "Assigned outside Access & Permissions",
  mixed: "Assigned from multiple sources",
  none: "No effective permissions",
};
const operations = {
  update_managed_access: "Access & Permissions assignment updated",
  bootstrap_access_administration: "Access Administration established",
  provision_access_administrator: "Access Administrator provisioned",
  revoke_access_administrator: "Access Administrator contribution removed",
};
const membershipExplanation =
  "Departments and divisions determine which areas of the organization this staff member can work with for certain requests. Some permissions apply across the entire organization.";
// Drawer-only wording; server metadata and category/filter identities stay authoritative.
const categoryLabels = {
  "Administrative Configuration": "Administration",
  "Specialized Capabilities": "Other Capabilities",
};
const descriptionLabels = {
  "Inspect access configuration and history.":
    "View staff access settings and access history.",
};
const countLabel = (count, singular) =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;
const assignmentLabel = (contribution) =>
  contribution?.managed
    ? contribution.existing
      ? sources.mixed
      : sources.managed
    : contribution?.existing
      ? sources.existing
      : "No assignment information";
// Abort plus request identity protects even clients which finish after cancellation.
export function useAccessRead(client, path, onDenied) {
  const [state, setState] = useState(null);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    if (path)
      client.get(path, { authenticated: true, signal: controller.signal }).then(
        (data) => {
          if (!controller.signal.aborted) setState({ path, client, data });
        },
        (error) => {
          if (controller.signal.aborted) return;
          if ([401, 403].includes(error.status)) denied.current?.();
          setState({
            path,
            client,
            error: true,
            unavailable: error.status === 404,
          });
        },
      );
    return () => controller.abort();
  }, [client, path]);
  return state?.path === path && state?.client === client ? state : null;
}
function Pager({ data, onPage, onSize, label }) {
  return (
    <nav className="access-pagination" aria-label={label}>
      <button
        className="btn btn-outline-secondary"
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
      </span>
      <button
        className="btn btn-outline-secondary"
        disabled={data.page * data.pageSize >= data.total}
        onClick={() => onPage(data.page + 1)}
      >
        Next
      </button>
      {onSize && (
        <label>
          Rows per page{" "}
          <select
            className="form-select"
            value={data.pageSize}
            onChange={(e) => onSize(Number(e.target.value))}
          >
            {[25, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
function History({ client, id, onDenied }) {
  const [page, setPage] = useState(1);
  const state = useAccessRead(
    client,
    `/admin/access/principals/${encodeURIComponent(id)}/history?page=${page}&pageSize=25`,
    onDenied,
  );
  return (
    <section aria-label="Recorded access history">
      <p>
        Reqro records access changes made through the current access-management
        system. Older access may not appear here.
      </p>
      {!state ? (
        <p role="status">Loading access history…</p>
      ) : state.error ? (
        <p role="alert">Access history is unavailable.</p>
      ) : (
        <>
          {!state.data.items.length ? (
            <p>
              No access changes have been recorded by Reqro for this staff
              member yet.
            </p>
          ) : (
            <ol className="access-history">
              {state.data.items.map((item) => (
                <li key={item.id}>
                  <h4>
                    {operations[item.operation] ||
                      "Access configuration changed"}
                  </h4>
                  <p>
                    {item.actor} ·{" "}
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </p>
                  <ul>
                    {item.deltas.map((d) => (
                      <li key={d.key}>
                        {d.direction === "added" ? "Added" : "Removed"}:{" "}
                        {d.label}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          <Pager
            data={state.data}
            onPage={setPage}
            label="Access history pages"
          />
        </>
      )}
    </section>
  );
}
function Detail({ client, id, onDenied }) {
  const state = useAccessRead(
    client,
    `/admin/access/principals/${encodeURIComponent(id)}`,
    onDenied,
  );
  const [history, setHistory] = useState(false);
  if (!state) return <p role="status">Loading access details…</p>;
  if (state.error)
    return (
      <p role="alert">
        {state.unavailable
          ? "This staff member is unavailable."
          : "Access details could not be loaded."}
      </p>
    );
  const d = state.data,
    metadata = new Map(d.permissions.map((p) => [p.key, p])),
    categories = [
      ...new Set(d.effective.map((k) => metadata.get(k)?.category || "Other")),
    ];
  const managed = d.contributions.filter((c) => c.managed).length,
    existing = d.contributions.filter((c) => c.existing).length;
  const sourceSummary = managed
    ? existing
      ? sources.mixed
      : sources.managed
    : existing
      ? sources.existing
      : "No access currently assigned";
  return (
    <>
      <p>
        {d.staff.displayName} · {d.staff.active ? "Active" : "Inactive"} in
        Reqro · Read-only
      </p>
      <section
        className="access-drawer-section access-summary"
        aria-labelledby="access-summary-title"
      >
        <h3 id="access-summary-title">Access Overview</h3>
        <dl>
          <div>
            <dt>Permissions</dt>
            <dd>{countLabel(d.effective.length, "permission")}</dd>
          </div>
          <div>
            <dt>How access is assigned</dt>
            <dd>{sourceSummary}</dd>
          </div>
          <div>
            <dt>Access Administrator</dt>
            <dd>{d.accessAdministrator ? "Yes" : "No"}</dd>
          </div>
        </dl>
        {d.accessAdministrator && (
          <p>
            Access Administration authority is managed through controlled
            provisioning.
          </p>
        )}
      </section>
      <section className="access-drawer-section">
        <h3>What This Staff Member Can Do</h3>
        {!d.effective.length && (
          <p>No Reqro permissions are currently effective.</p>
        )}
        {categories.map((category) => (
          <details className="access-category" key={category}>
            <summary>
              <span className="access-category-heading">
                <h4>{categoryLabels[category] || category}</h4>
                <span className="access-category-count">
                  {countLabel(
                    d.effective.filter(
                      (k) =>
                        (metadata.get(k)?.category || "Other") === category,
                    ).length,
                    "permission",
                  )}
                </span>
              </span>
            </summary>
            <ul className="access-permissions" role="list">
              {d.effective
                .filter(
                  (k) => (metadata.get(k)?.category || "Other") === category,
                )
                .map((key) => {
                  const p = metadata.get(key);
                  const contribution = d.contributions.find(
                    (c) => c.key === key,
                  );
                  const categorySources = new Set(
                    d.contributions
                      .filter(
                        (c) =>
                          (metadata.get(c.key)?.category || "Other") ===
                          category,
                      )
                      .map(assignmentLabel),
                  );
                  const distinguishSource =
                    managed > 0 &&
                    existing > 0 &&
                    (categorySources.size > 1 ||
                      (contribution?.managed && contribution?.existing));
                  return (
                    <li key={key}>
                      <div className="access-permission-heading">
                        <strong>{p?.label || "Unrecognized capability"}</strong>
                        {p?.sensitive && (
                          <span className="badge text-bg-secondary">
                            Sensitive access
                          </span>
                        )}
                        {distinguishSource && (
                          <span className="badge text-bg-secondary">
                            {assignmentLabel(contribution)}
                          </span>
                        )}
                      </div>
                      <p className="access-permission-description">
                        {descriptionLabels[p?.description] || p?.description}
                      </p>
                      <details className="access-permission-details">
                        <summary>Details</summary>
                        <dl>
                          <div>
                            <dt>Permission key</dt>
                            <dd>
                              <code>{key}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Requires</dt>
                            <dd>
                              {p?.requires?.length
                                ? p.requires
                                    .map(
                                      (k) =>
                                        metadata.get(k)?.label ||
                                        "Unrecognized capability",
                                    )
                                    .join(", ")
                                : "No permission prerequisites listed"}
                            </dd>
                          </div>
                          <div>
                            <dt>Access assigned</dt>
                            <dd>{assignmentLabel(contribution)}</dd>
                          </div>
                          {p?.classification === "provisioning-only" && (
                            <div>
                              <dt>Assignment policy</dt>
                              <dd>
                                Set up separately by an administrator; not
                                managed through Access &amp; Permissions.
                              </dd>
                            </div>
                          )}
                        </dl>
                        {p?.contextual && <p>{p.contextual}</p>}
                      </details>
                    </li>
                  );
                })}
            </ul>
          </details>
        ))}
      </section>
      <section className="access-drawer-section">
        <h3>How Access Is Assigned</h3>
        <p>
          Access can be assigned in Access &amp; Permissions or set up
          separately by an administrator. This page is read-only.
        </p>
        <ul>
          <li>
            Assigned outside Access &amp; Permissions —{" "}
            {countLabel(existing, "permission")}
          </li>
          <li>
            Assigned in Access &amp; Permissions —{" "}
            {countLabel(managed, "permission")}
          </li>
        </ul>
        {!!d.contributions.length && (
          <details>
            <summary>View assignment details</summary>
            <p>
              Permissions supplied by both sources count in both source
              summaries, but only once in effective permissions.
            </p>
            <ul>
              {d.contributions.map((c) => (
                <li key={c.key}>
                  <strong>
                    {metadata.get(c.key)?.label || "Unrecognized capability"}
                  </strong>
                  : {assignmentLabel(c)}
                  {c.sourceCount > 1 &&
                    ` · ${c.sourceCount} contributing roles`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="access-drawer-section">
        <h3>Departments &amp; Divisions</h3>
        <p>{membershipExplanation}</p>
        <h4>Department memberships</h4>
        {!d.departments.length ? (
          <p>No current Department memberships.</p>
        ) : (
          <ul>
            {d.departments.map((m) => (
              <li key={m.id}>
                {m.name}
                {m.status === "inactive" && (
                  <span className="badge text-bg-secondary access-unit-status">
                    Inactive
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <h4>Division memberships</h4>
        {!d.divisions.length ? (
          <p>No current Division memberships.</p>
        ) : (
          <ul>
            {d.divisions.map((m) => (
              <li key={m.id}>
                {m.name}
                {m.status === "inactive" && (
                  <span className="badge text-bg-secondary access-unit-status">
                    Inactive
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p>Division access is listed separately from department access.</p>
        <details>
          <summary>About departments and divisions</summary>
          <p>
            Division membership does not itself imply Department membership.
          </p>
          <p>
            Behavior involving inactive organizational units can vary by
            operation. This view preserves those existing semantics. Inactive
            membership rows are omitted.
          </p>
        </details>
      </section>
      <section className="access-drawer-section">
        <h3>Recent Access Changes</h3>
        <button
          className="btn btn-outline-secondary"
          aria-expanded={history}
          onClick={() => setHistory(!history)}
        >
          {history ? "Hide Access History" : "View Access History"}
        </button>
        {history && (
          <History key={id} client={client} id={id} onDenied={onDenied} />
        )}
      </section>
    </>
  );
}
export default function AccessDiscovery({ client, onDenied }) {
  const [query, setQuery] = useState(defaults),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null);
  const trigger = useRef(null),
    searchRef = useRef(null);
  const options = useAccessRead(client, "/admin/access/scopes", onDenied);
  const catalog = useAccessRead(client, "/admin/access/permissions", onDenied);
  const key = new URLSearchParams(query).toString();
  const state = useAccessRead(
    client,
    `/admin/access/principals?${key}`,
    onDenied,
  );
  useEffect(() => {
    const timeout = setTimeout(
      () => setQuery((q) => ({ ...q, search: search.trim(), page: 1 })),
      250,
    );
    return () => clearTimeout(timeout);
  }, [search]);
  const change = (key, value) =>
    setQuery((q) => ({
      ...q,
      [key]: value,
      ...(key === "department" ? { division: "" } : {}),
      page: 1,
    }));
  const close = () => {
    setSelected(null);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else searchRef.current?.focus();
    });
  };
  const filters = [
    [
      "status",
      "Reqro Status",
      [
        ["all", "All"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ],
    ],
    [
      "category",
      "Access Category",
      [
        ["", "All categories"],
        ...[
          ...new Set((catalog?.data?.items || []).map((p) => p.category)),
        ].map((c) => [c, c]),
      ],
    ],
    [
      "department",
      "Department Membership",
      [
        ["", "All Departments"],
        ...(options?.data?.departments || []).map((d) => [
          d.id,
          `${d.name}${d.status !== "active" ? " (inactive)" : ""}`,
        ]),
      ],
    ],
    [
      "division",
      "Division Membership",
      [
        ["", "All Divisions"],
        ...(options?.data?.divisions || [])
          .filter(
            (d) => !query.department || d.departmentId === query.department,
          )
          .map((d) => [
            d.id,
            `${d.name}${d.status !== "active" ? " (inactive)" : ""}`,
          ]),
      ],
    ],
    [
      "source",
      "Access Source",
      [
        ["all", "All sources"],
        ...Object.entries(sources).filter(([k]) => k !== "none"),
      ],
    ],
  ];
  return (
    <div className="access-discovery">
      <p>Review staff access and administrative permissions.</p>
      <p>
        Read-only view. Status reflects whether the staff member is active in
        Reqro.
      </p>
      <div className="access-filters">
        {filters.map(([key, label, values]) => (
          <label key={key}>
            {label}
            <select
              className="form-select"
              value={query[key]}
              onChange={(e) => change(key, e.target.value)}
            >
              {values.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          className="btn btn-outline-secondary"
          onClick={() =>
            setQuery({
              ...defaults,
              search: query.search,
              pageSize: query.pageSize,
            })
          }
        >
          Clear Filters
        </button>
      </div>
      <p className="small">
        Department and Division filters match memberships, not
        permission-specific scope.
      </p>
      {(options?.error || catalog?.error) && (
        <p role="alert">Filter options could not be loaded.</p>
      )}
      <div className="issue-workspace-search">
        <label htmlFor="access-search">Search Staff</label>
        <div className="access-search">
          <input
            ref={searchRef}
            id="access-search"
            className="form-control"
            type="search"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-describedby="access-search-help"
          />
          <button
            className="btn btn-outline-secondary"
            onClick={() => {
              setSearch("");
              change("search", "");
            }}
          >
            Clear Search
          </button>
        </div>
        <p id="access-search-help">Results update as you type.</p>
      </div>
      {!state ? (
        <p role="status">Loading staff members…</p>
      ) : state.error ? (
        <p role="alert">Staff access could not be loaded.</p>
      ) : (
        <>
          <p role="status">{state.data.total} Staff Members Found</p>
          {!state.data.items.length ? (
            <p>
              {state.data.organizationTotal
                ? "No staff members match your search or filters."
                : "No staff members are available."}
            </p>
          ) : (
            <table className="access-table">
              <thead>
                <tr>
                  {[
                    "#",
                    "Staff Member",
                    "Access Summary",
                    "Operational Scope",
                    "Status",
                    "Actions",
                  ].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((s, i) => (
                  <tr key={s.id}>
                    <td data-label="Result">
                      {(state.data.page - 1) * state.data.pageSize + i + 1}
                    </td>
                    <th scope="row">{s.displayName}</th>
                    <td data-label="Access Summary">
                      {s.accessAdministrator && (
                        <strong>Access Administrator · </strong>
                      )}
                      {s.categories.slice(0, 2).join(" · ") ||
                        "No effective permissions"}
                      {s.categories.length > 2 &&
                        ` +${s.categories.length - 2} more`}
                      <small>{sources[s.source]}</small>
                    </td>
                    <td data-label="Operational Scope">
                      {countLabel(s.departments, "Department")} ·{" "}
                      {countLabel(s.divisions, "Division")}
                    </td>
                    <td data-label="Reqro Status">
                      {s.active ? "Active" : "Inactive"}
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-primary"
                        aria-label={`View Access for ${s.displayName}`}
                        onClick={(e) => {
                          trigger.current = e.currentTarget;
                          setSelected(s);
                        }}
                      >
                        View Access
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager
            data={state.data}
            label="Staff pages"
            onPage={(page) => setQuery((q) => ({ ...q, page }))}
            onSize={(size) => change("pageSize", size)}
          />
        </>
      )}
      {selected && (
        <IssueDrawer
          title="View Access"
          subtitle={selected.displayName}
          onClose={close}
        >
          <Detail
            key={selected.id}
            client={client}
            id={selected.id}
            onDenied={onDenied}
          />
        </IssueDrawer>
      )}
    </div>
  );
}
