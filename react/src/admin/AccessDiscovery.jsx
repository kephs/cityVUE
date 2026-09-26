import AccessActions from "./AccessActions.jsx";
import { accessText, accessSource } from "./accessPresentation.js";
import { useEffect, useRef, useState } from "react";
import ConfigureAccess from "./ConfigureAccess.jsx";
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
  none: "No permissions assigned",
};
const operations = {
  update_managed_access: "Access & Permissions assignment updated",
  bootstrap_access_administration: "Access Administration established",
  provision_access_administrator: "Access Administrator access added",
  revoke_access_administrator: "Access Administrator assignment removed",
};
const membershipExplanation =
  "These determine where this staff member can perform certain activities. They are managed separately from Access & Permissions.";
// Drawer-only wording; server metadata and category/filter identities stay authoritative.
const categoryLabels = {
  "Administrative Configuration": "Administration",
  "Specialized Capabilities": "Other Capabilities",
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
export function useAccessRead(client, path, onDenied, refresh = 0) {
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
  }, [client, path, refresh]);
  return state?.path === path && state?.client === client ? state : null;
}
export function Pager({ data, onPage, onSize, label }) {
  return (
    <nav className="access-pagination" aria-label={label}>
      <span className="access-result-range">
        Showing {data.total ? (data.page - 1) * data.pageSize + 1 : 0}–
        {Math.min(data.page * data.pageSize, data.total)} of {data.total}
      </span>
      <div className="access-page-controls">
        {onSize && (
          <label className="access-page-size">
            Rows per page:
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
        <div className="access-page-navigation">
          <button
            className="btn btn-outline-secondary"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
          >
            Previous
          </button>
          <span>
            Page {data.page} of{" "}
            {Math.max(1, Math.ceil(data.total / data.pageSize))}
          </span>
          <button
            className="btn btn-outline-secondary"
            disabled={data.page * data.pageSize >= data.total}
            onClick={() => onPage(data.page + 1)}
          >
            Next
          </button>
        </div>
      </div>
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
                        {item.operation === "update_managed_access"
                          ? d.direction === "added"
                            ? "Added to Access & Permissions"
                            : "Removed from Access & Permissions"
                          : d.direction === "added"
                            ? "Assignment added"
                            : "Assignment removed"}
                        : {accessText(d.label)}
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
function Detail({ client, id, onDenied, authoritative, onConfigure }) {
  const fetched = useAccessRead(
    client,
    authoritative ? null : `/admin/access/principals/${encodeURIComponent(id)}`,
    onDenied,
  );
  const state = authoritative ? { data: authoritative } : fetched;
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
      {d.canConfigure && onConfigure && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onConfigure(d)}
        >
          Configure Access
        </button>
      )}
      {d.integrityWarning && (
        <p role="alert">
          Access configuration needs administrative attention before changes can
          be saved.
        </p>
      )}
      {!d.staff.active && <p>Inactive staff are view-only.</p>}
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
            Access Administrator status is managed outside Access &amp;
            Permissions.
          </p>
        )}
      </section>
      <section className="access-drawer-section">
        <h3>What This Staff Member Can Do</h3>
        {!d.effective.length && (
          <p>No Reqro permissions are currently assigned.</p>
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
                        <strong>
                          {accessText(p?.label) || "Unrecognized capability"}
                        </strong>
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
                        {accessText(p?.description)}
                      </p>
                      <p className="access-source-note">
                        <strong>
                          {
                            accessSource(
                              contribution?.managed,
                              contribution?.existing,
                            )[0]
                          }
                        </strong>
                        <br />
                        {
                          accessSource(
                            contribution?.managed,
                            contribution?.existing,
                          )[1]
                        }
                      </p>
                      <details className="access-permission-details">
                        <summary>Technical details</summary>
                        <dl>
                          <div>
                            <dt>Permission</dt>
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
                                        accessText(metadata.get(k)?.label) ||
                                        "Unrecognized capability",
                                    )
                                    .join(", ")
                                : "None"}
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
                        {p?.contextual && <p>{accessText(p.contextual)}</p>}
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
              summaries, but only once in the permission total.
            </p>
            <ul>
              {d.contributions.map((c) => (
                <li key={c.key}>
                  <strong>
                    {accessText(metadata.get(c.key)?.label) ||
                      "Unrecognized capability"}
                  </strong>
                  : {assignmentLabel(c)}
                  {c.sourceCount > 1 &&
                    ` · ${c.sourceCount} assignment sources`}
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
          <summary>About access scope</summary>
          <p>
            Division membership does not itself imply Department membership.
          </p>
          <p>
            Some actions may be unavailable for inactive Departments or
            Divisions. Only current memberships are shown.
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
function AccessPanel({
  client,
  selected,
  onDenied,
  close,
  onSaved,
  closeHandler,
  listed,
}) {
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState(null);
  const [notice, setNotice] = useState("");
  const loaded = useAccessRead(
    client,
    selected.configure
      ? `/admin/access/principals/${encodeURIComponent(selected.id)}`
      : null,
    onDenied,
  );
  useEffect(() => {
    if (selected.configure && loaded?.data?.canConfigure)
      setEditing(loaded.data);
  }, [loaded]);
  const configure = (data) => {
    setEditing(data);
    setNotice("");
  };
  const focusHeading = () =>
    requestAnimationFrame(() =>
      document.getElementById("issue-drawer-title")?.focus(),
    );
  const cancel = () => {
    setEditing(null);
    closeHandler.current = null;
    focusHeading();
  };
  return (
    <IssueDrawer
      title={editing ? "Configure Access" : "View Access"}
      subtitle={selected.displayName}
      onClose={() => (closeHandler.current ? closeHandler.current() : close())}
    >
      {notice && <p role="status">{notice}</p>}
      {saved && listed === false && (
        <p>
          This staff member no longer appears on the current filtered page.
          Their updated access is shown here.
        </p>
      )}
      {editing ? (
        <ConfigureAccess
          key={selected.id}
          client={client}
          detail={editing}
          onDenied={onDenied}
          registerClose={(handler) => {
            closeHandler.current = handler;
          }}
          onCancel={cancel}
          onClose={close}
          onSaved={(result) => {
            setSaved(result.detail);
            setEditing(null);
            closeHandler.current = null;
            setNotice(
              result.changed ? "Access updated." : "No changes were needed.",
            );
            onSaved();
            focusHeading();
          }}
        />
      ) : (
        <Detail
          key={`${selected.id}:${saved?.authorizationRevision || ""}`}
          client={client}
          id={selected.id}
          onDenied={onDenied}
          authoritative={saved}
          onConfigure={configure}
        />
      )}
    </IssueDrawer>
  );
}
export default function AccessDiscovery({
  client,
  onDenied,
  canManage = false,
}) {
  const [query, setQuery] = useState(defaults),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const closeHandler = useRef(null);
  const [openMenu, setOpenMenu] = useState(null);
  const trigger = useRef(null),
    searchRef = useRef(null);
  useEffect(() => {
    setSelected(null);
    closeHandler.current = null;
  }, [client]);
  const options = useAccessRead(client, "/admin/access/scopes", onDenied);
  const catalog = useAccessRead(client, "/admin/access/permissions", onDenied);
  const key = new URLSearchParams(query).toString();
  const state = useAccessRead(
    client,
    `/admin/access/principals?${key}`,
    onDenied,
    refresh,
  );
  useEffect(() => {
    if (state?.data && query.page > 1 && !state.data.items.length)
      setQuery((q) => ({
        ...q,
        page: Math.max(1, Math.ceil(state.data.total / q.pageSize)),
      }));
  }, [state, query.page]);
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
        {canManage
          ? "Status reflects whether the staff member is active in Reqro."
          : "Read-only view. Status reflects whether the staff member is active in Reqro."}
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
        Department and Division filters match memberships, not where each
        permission allows them to work.
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
                      {s.categories
                        .slice(0, 2)
                        .map((c) => categoryLabels[c] || c)
                        .join(" · ") || "No permissions assigned"}
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
                      <AccessActions
                        staff={s}
                        open={openMenu === s.id}
                        setOpen={setOpenMenu}
                        onAction={(staff, kind, event) => {
                          trigger.current = event.currentTarget;
                          setSelected({
                            ...staff,
                            configure: kind === "configure",
                          });
                        }}
                      />
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
        <AccessPanel
          key={selected.id}
          client={client}
          selected={selected}
          listed={
            state?.data
              ? state.data.items.some((s) => s.id === selected.id)
              : undefined
          }
          onDenied={onDenied}
          close={close}
          closeHandler={closeHandler}
          onSaved={() => setRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}
