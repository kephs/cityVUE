import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import StaffRouteGuard from "../auth/StaffRouteGuard.jsx";
import ThemeToggle from "../components/theme/ThemeToggle.jsx";
import { createApiClient } from "../api/apiClient.js";
import { readResidentIntakeConfig } from "../config/runtimeConfig.js";
import "./adminConfiguration.css";
import {
  ReqroBrand,
  OrganizationBrand,
  reqroBrand,
  useAdminProductIdentity,
} from "../branding/ReqroBrand.jsx";
import IntakeCollectionEditor from "./IntakeCollectionEditor.jsx";
import ParticipationAreaEditor from "./ParticipationAreaEditor.jsx";

const sections = [
  ["", "Overview"],
  ["issues", "Issues"],
  ["intake", "Intake Settings"],
  ["participation", "Participation Areas"],
  ["privacy", "Analytics & Privacy"],
  ["status", "Configuration Status"],
];
function Values({ items }) {
  return (
    <dl className="configuration-values">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Paging({ data, name, setPage }) {
  return (
    <nav
      className="d-flex flex-wrap gap-3 align-items-center my-3"
      aria-label={`${name} pages`}
    >
      <button
        className="btn btn-outline-primary"
        disabled={data.page <= 1}
        onClick={() => setPage(data.page - 1)}
      >
        Previous {name.toLowerCase()}
      </button>
      <span>
        Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
      </span>
      <button
        className="btn btn-outline-primary"
        disabled={data.page * data.pageSize >= data.total}
        onClick={() => setPage(data.page + 1)}
      >
        Next {name.toLowerCase()}
      </button>
    </nav>
  );
}

export function AdminConfiguration({ client }) {
  const { section = "" } = useParams();
  const title = sections.find(([key]) => key === section)?.[1];
  const [state, setState] = useState(null),
    [attempt, setAttempt] = useState(0);
  const [issuePage, setIssuePage] = useState(1),
    [areaPage, setAreaPage] = useState(1);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationButton = useRef(null);
  const closeNavigation = () => {
    setNavigationOpen(false);
    navigationButton.current?.focus();
  };
  const [saveNotice, setSaveNotice] = useState("");
  const saveStatus = useRef(null);
  useEffect(() => {
    if (saveNotice) saveStatus.current?.focus();
  }, [saveNotice]);
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, [section]);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    client
      .get(
        `/admin/configuration?${new URLSearchParams({ issuePage, areaPage })}`,
        { authenticated: true, signal: controller.signal },
      )
      .then(
        (data) => {
          if (!controller.signal.aborted) setState({ client, data });
        },
        (error) => {
          if (!controller.signal.aborted)
            setState({
              client,
              error: true,
              denied: [401, 403].includes(error.status),
            });
        },
      );
    return () => controller.abort();
  }, [client, attempt, issuePage, areaPage]);
  const current = state?.client === client ? state : null,
    data = current?.data;
  const refresh = () => {
    setState(null);
    setAttempt((n) => n + 1);
  };
  return (
    <div className="configuration-shell">
      <a className="skip-link" href="#configuration-main">
        Skip to administration content
      </a>
      <header className="configuration-header">
        <div className="configuration-product">
          <ReqroBrand compact />
          <div>
            <span className="configuration-portal-name">
              Reqro Administration
            </span>
            <span className="configuration-portal-subtitle">
              Organization configuration
            </span>
          </div>
        </div>
        <div className="configuration-header-actions">
          <Link to="/staff/requests">← Staff workspace</Link>
          <ThemeToggle />
        </div>
      </header>
      <div className="configuration-layout">
        <aside
          className="configuration-navigation"
          onKeyDown={(event) => {
            if (event.key === "Escape" && navigationOpen) {
              event.preventDefault();
              closeNavigation();
            }
          }}
        >
          <button
            ref={navigationButton}
            className="btn configuration-menu"
            aria-expanded={navigationOpen}
            aria-controls="configuration-navigation"
            onClick={() => setNavigationOpen(!navigationOpen)}
          >
            <i className="bi bi-list" aria-hidden="true" />{" "}
            {navigationOpen ? "Close navigation" : "Administration sections"}
          </button>
          <div
            className={
              navigationOpen
                ? "configuration-navigation-content is-open"
                : "configuration-navigation-content"
            }
          >
            <nav
              id="configuration-navigation"
              aria-label="Administration sections"
            >
              {[
                ["Workspace", sections.slice(0, 1), "grid"],
                ["Service Requests", sections.slice(1, 4), "inboxes"],
                ["Analytics & Privacy", sections.slice(4, 5), "shield-check"],
                ["System", sections.slice(5), "gear"],
              ].map(([group, items, icon]) => (
                <section className="configuration-nav-group" key={group}>
                  <h2>{group}</h2>
                  {items.map(([key, label]) => (
                    <NavLink
                      key={key}
                      to={key ? `/admin/${key}` : "/admin"}
                      end
                      onClick={() => {
                        setNavigationOpen(false);
                        heading.current?.focus();
                      }}
                    >
                      <i className={`bi bi-${icon}`} aria-hidden="true" />
                      {label}
                    </NavLink>
                  ))}
                </section>
              ))}
            </nav>
            <OrganizationBrand branding={data?.branding} />
          </div>
        </aside>
        <main
          id="configuration-main"
          className="configuration-main"
          tabIndex="-1"
        >
          <h1 tabIndex="-1" ref={heading}>
            {title || "Administration page not found"}
          </h1>
          <p>
            Service Participation collection and Participation Areas each
            require separate write permission. Other configuration is read-only.
          </p>
          {saveNotice && (
            <p role="status" tabIndex="-1" ref={saveStatus}>
              {saveNotice}
            </p>
          )}
          {!title ? (
            <Link to="/admin">Return to Administration</Link>
          ) : !current ? (
            <p role="status">Loading authorized configuration…</p>
          ) : current.error ? (
            <div>
              <p role="alert">
                {current.denied
                  ? "Administration access is not authorized."
                  : "Configuration could not be loaded. Please retry."}
              </p>
              <button className="btn btn-primary" onClick={refresh}>
                Retry configuration
              </button>
            </div>
          ) : (
            <>
              <button
                className="btn btn-outline-primary mb-4"
                onClick={refresh}
              >
                Refresh configuration
              </button>
              {section === "" && (
                <>
                  <div className="configuration-welcome">
                    <p className="configuration-eyebrow">
                      Your administration workspace
                    </p>
                    <h2>Configuration at a glance</h2>
                    <p>
                      Review your Organization’s service setup and keep intake
                      working clearly and consistently.
                    </p>
                  </div>
                  <Values
                    items={[
                      ["Issues configured", data.issues.total],
                      [
                        "Service Participation collection",
                        data.collection.enabled ? "Enabled" : "Disabled",
                      ],
                      [
                        "Active Participation Areas",
                        data.participationAreas.active,
                      ],
                      [
                        "Configuration health",
                        data.health.some((h) => h.severity === "WARNING")
                          ? "Review configuration warnings"
                          : "All checks passed",
                      ],
                    ]}
                  />
                  <p>
                    These are configuration facts, not Service Request or
                    requester statistics.
                  </p>
                  <p>
                    Each managed resource has its own revision. This page has no
                    global configuration revision.
                  </p>
                </>
              )}
              {section === "issues" && (
                <>
                  <p>
                    Published catalog versions, Issue action, identity policy
                    and default assignment have separate version/revision
                    values. Availability reflects the current catalog.
                  </p>
                  {!data.issues.total && <p>No Issues are configured.</p>}
                  <ul className="configuration-cards">
                    {data.issues.items.map((issue) => (
                      <li key={issue.key}>
                        <h2>{issue.name}</h2>
                        <Values
                          items={[
                            ["Category", issue.category],
                            [
                              "Availability",
                              issue.available ? "Available" : "Unavailable",
                            ],
                            [
                              "Requester policy",
                              issue.identityPolicy.value === "ANONYMOUS_ALLOWED"
                                ? "Anonymous submission allowed"
                                : "Identification required",
                            ],
                            [
                              "Default assignment",
                              issue.defaultAssignment.label,
                            ],
                            [
                              "Published version",
                              issue.publishedVersion ?? "Not published",
                            ],
                            ["Action revision", issue.action.revision],
                            [
                              "Identity policy revision",
                              issue.identityPolicy.revision,
                            ],
                            [
                              "Assignment revision",
                              issue.defaultAssignment.revision,
                            ],
                          ]}
                        />
                        {issue.defaultAssignment.state === "unavailable" && (
                          <p className="configuration-warning">
                            <strong>WARNING:</strong> Configured target is
                            unavailable. No repair has been performed.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Paging
                    name="Issues"
                    data={data.issues}
                    setPage={setIssuePage}
                  />
                </>
              )}
              {section === "intake" && (
                <>
                  <IntakeCollectionEditor
                    key={`${data.collection.revision}-${attempt}`}
                    client={client}
                    collection={data.collection}
                    activeAreas={data.participationAreas.active}
                    canWrite={
                      data.capabilities?.canWriteIntakeSettings === true
                    }
                    onRefresh={refresh}
                    onSaved={(result) => {
                      setState({
                        client,
                        data: {
                          ...data,
                          collection: {
                            enabled: result.enabled,
                            revision: result.revision,
                          },
                        },
                      });
                      setSaveNotice(
                        `Service Participation collection ${result.enabled ? "enabled" : "disabled"}.`,
                      );
                      setAttempt((n) => n + 1);
                    }}
                  />
                  <p>
                    When enabled and active areas are available, requesters may
                    optionally provide a self-reported service-participation
                    area. This is separate from Service Location and requester
                    identity.
                  </p>
                  <p>
                    Disabling collection does not delete historical information
                    or revoke analytics access. Issue-specific requester
                    policies are shown under Issues.
                  </p>
                </>
              )}
              {section === "participation" && (
                <>
                  <ParticipationAreaEditor
                    key={attempt}
                    client={client}
                    areas={data.participationAreas}
                    collection={data.collection}
                    canWrite={
                      data.capabilities?.canWriteParticipationAreas === true
                    }
                    onRefresh={refresh}
                    onSaved={(_result, notice) => {
                      setSaveNotice(notice);
                      refresh();
                    }}
                    onDenied={(status) => {
                      setSaveNotice(
                        status === 401
                          ? "Your staff session has expired. Please sign in again."
                          : "You are not authorized to manage Participation Areas.",
                      );
                      refresh();
                    }}
                  />
                  <Paging
                    name="Areas"
                    data={data.participationAreas}
                    setPage={setAreaPage}
                  />
                </>
              )}
              {section === "privacy" && (
                <>
                  <Values
                    items={[
                      [
                        "Service Participation collection",
                        data.collection.enabled ? "Enabled" : "Disabled",
                      ],
                      [
                        "Privacy threshold",
                        `${data.privacy.suppressionThreshold} requests`,
                      ],
                      ["Small-count suppression", "Enabled"],
                      ["Exact suppressed counts", "Not disclosed"],
                      ["Configuration ownership", "Deployment policy"],
                    ]}
                  />
                  <p>
                    Analytics access requires separate authorization and
                    existing PUBLIC request scope. Administration access does
                    not grant analytics or operational access.
                  </p>
                  <p>
                    The privacy threshold is deployment-owned. It has no
                    Admin-editable resource revision and is not editable here.
                  </p>
                </>
              )}
              {section === "status" && (
                <>
                  <p>
                    These checks describe configuration consistency. They do not
                    monitor infrastructure, scan security vulnerabilities or
                    repair configuration.
                  </p>
                  <ul className="configuration-cards">
                    {data.health.map((check) => (
                      <li key={check.resource}>
                        <h2>{check.resource}</h2>
                        <p
                          className={
                            check.severity === "WARNING"
                              ? "configuration-warning"
                              : ""
                          }
                        >
                          <strong>{check.severity}:</strong> {check.message}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {section === "" && (
            <p className="configuration-brand-message">{reqroBrand.message}</p>
          )}
        </main>
      </div>
    </div>
  );
}
export default function AdminConfigurationPage() {
  const auth = useAuth();
  useAdminProductIdentity();
  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: readResidentIntakeConfig().apiBaseUrl,
        getAccessToken: auth.getAccessToken,
      }),
    [auth.getAccessToken],
  );
  return (
    <>
      {(!auth.enabled || !auth.isAuthenticated) && (
        <div className="configuration-signin-brand">
          <ReqroBrand />
          <p>{reqroBrand.tagline}</p>
        </div>
      )}
      <StaffRouteGuard
        requireEntra
        title="Reqro Administration"
        disabledMessage="Administration requires configured staff sign-in."
        signInMessage="Sign in with an authorized staff account to view Organization configuration."
      >
        {auth.enabled && auth.isAuthenticated && (
          <AdminConfiguration
            key={auth.account?.homeAccountId || "staff"}
            client={client}
          />
        )}
      </StaffRouteGuard>
    </>
  );
}
