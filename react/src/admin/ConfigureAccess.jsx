import AccessReview from "./AccessReview.jsx";
import { accessText, accessSource } from "./accessPresentation.js";
import { useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import Confirmation from "./Confirmation.jsx";
import {
  accessDraft,
  accessPresets,
  canonical,
  presetAccess,
  requiredAccess,
  sameAccess,
} from "./accessDraft.js";
import "./configureAccess.css";

function LeaveGuard({ dirty, saving, confirm }) {
  const blocker = useBlocker(dirty || saving);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (saving) {
      blocker.reset();
      return;
    }
    confirm({
      title: "Discard Access Changes?",
      text: "You have unsaved access changes. Leave without saving?",
      label: "Discard Changes",
      action: () => blocker.proceed(),
      cancel: () => blocker.reset(),
    });
  }, [blocker.state, saving]);
  return null;
}

// Presentation grouping only; draft validation and prerequisite additions stay unchanged.
function SensitiveAccessSummary({ detail, state, label }) {
  const metadata = new Map(detail.permissions.map((p) => [p.key, p]));
  const prerequisites = new Set();
  const visit = (key) => {
    for (const required of metadata.get(key)?.requires || []) {
      if (prerequisites.has(required)) continue;
      prerequisites.add(required);
      visit(required);
    }
  };
  state.sensitive.forEach(visit);
  const ordinary = state.added.filter((key) => !state.sensitive.includes(key));
  const required = ordinary.filter((key) => prerequisites.has(key));
  const other = ordinary.filter((key) => !prerequisites.has(key));
  const list = (keys) => (
    <ul>
      {keys.map((key) => (
        <li key={key}>{label(key)}</li>
      ))}
    </ul>
  );
  return (
    <>
      <p>You're about to give {detail.staff.displayName} sensitive access:</p>
      <div className="access-sensitive-list">{list(state.sensitive)}</div>
      {required.length > 0 && (
        <>
          <p>
            {detail.staff.displayName} will also receive the required access:
          </p>
          {list(required)}
        </>
      )}
      {other.length > 0 && (
        <>
          <p>Other access being added:</p>
          {list(other)}
        </>
      )}
      <p>
        {detail.staff.displayName}'s Department and Division access will not
        change.
      </p>
    </>
  );
}

export default function ConfigureAccess({
  client,
  detail: initial,
  onSaved,
  onCancel,
  onClose,
  onDenied,
  registerClose,
}) {
  const [detail, setDetail] = useState(initial);
  const [desired, setDesired] = useState(() =>
    canonical(initial.contributions.filter((c) => c.managed).map((c) => c.key)),
  );
  const [stage, setStage] = useState("editing");
  const [presetId, setPresetId] = useState(
    () =>
      accessPresets.find((p) =>
        sameAccess(
          p.keys,
          initial.contributions.filter((c) => c.managed).map((c) => c.key),
        ),
      )?.id || "custom",
  );
  const [error, setError] = useState(null);
  const [dependencyNotice, setDependencyNotice] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const form = useRef(null),
    feedback = useRef(null),
    reviewButton = useRef(null),
    active = useRef(true),
    inFlight = useRef(false),
    generation = useRef(0);
  const router = useContext(UNSAFE_DataRouterContext);
  const state = accessDraft(detail, desired);
  const metadata = new Map(detail.permissions.map((p) => [p.key, p]));
  const label = (k) =>
    accessText(metadata.get(k)?.label) || "Unavailable permission";
  const saving = stage === "saving";
  const reviewing = stage === "review" || saving;
  const requiredDesired = requiredAccess(detail, desired);
  const dependencyCategory = detail.permissions.find((p) =>
    state.violations.some((v) => v.key === p.key),
  )?.category;
  const focusDependencies = () =>
    requestAnimationFrame(() =>
      form.current?.querySelector(".access-dependency-feedback")?.focus(),
    );
  const blocked =
    ["stale", "uncertain", "denied"].includes(stage) ||
    refreshing ||
    !detail.canConfigure;
  const confirm = (value) =>
    setConfirmation({ ...value, returnFocus: document.activeElement });
  const leave = (action) => {
    if (inFlight.current || refreshing) return;
    if (state.dirty)
      confirm({
        title: "Discard Access Changes?",
        text: `You have unsaved access changes for ${detail.staff.displayName}.`,
        label: "Discard Changes",
        action,
      });
    else action();
  };
  const cancel = () => leave(onCancel);
  useEffect(() => {
    registerClose?.(() => leave(onClose || onCancel));
    return () => registerClose?.(null);
  });
  useEffect(() => {
    active.current = true;
    generation.current++;
    return () => {
      generation.current++;
      active.current = false;
    };
  }, [client]);
  useEffect(() => {
    if (error || stage === "review") feedback.current?.focus();
  }, [error, stage]);
  useEffect(() => {
    if (!state.dirty && !saving) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty, saving]);
  const toggle = (key) => {
    setPresetId("custom");
    setError(null);
    setDependencyNotice(null);
    setDesired((keys) =>
      canonical(
        keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
      ),
    );
  };
  const refresh = async () => {
    const requestGeneration = generation.current;
    setRefreshing(true);
    try {
      const next = await client.get(
        `/admin/access/principals/${encodeURIComponent(detail.staff.id)}`,
        { authenticated: true },
      );
      if (!active.current || generation.current !== requestGeneration) return;
      setDependencyNotice(null);
      setDetail(next);
      setDesired(
        canonical(
          next.contributions.filter((c) => c.managed).map((c) => c.key),
        ),
      );
      setPresetId("custom");
      setStage("editing");
      requestAnimationFrame(() => feedback.current?.focus());
      setError(
        next.canConfigure
          ? null
          : "This staff member is now view-only. Access changes cannot be saved here.",
      );
    } catch (e) {
      if (!active.current || generation.current !== requestGeneration) return;
      setError(
        "Access could not be refreshed. Refresh is required before another Save.",
      );
      if ([401, 403].includes(e.status)) onDenied?.();
    } finally {
      if (active.current && generation.current === requestGeneration)
        setRefreshing(false);
    }
  };
  const requestRefresh = () =>
    state.dirty
      ? confirm({
          title: "Replace Access Draft?",
          text: "Refresh will replace your unsaved selections with current access. Changes will not be merged or resubmitted.",
          label: stage === "stale" ? "Refresh Access" : "Check Current Access",
          action: refresh,
        })
      : refresh();
  const save = async () => {
    if (
      inFlight.current ||
      blocked ||
      !state.dirty ||
      state.violations.length ||
      state.changesAdministrator
    )
      return;
    const requestGeneration = generation.current;
    inFlight.current = true;
    setStage("saving");
    setError(null);
    try {
      const result = await client.patch(
        `/admin/access/principals/${encodeURIComponent(detail.staff.id)}`,
        {
          expectedAuthorizationRevision: detail.authorizationRevision,
          managedPermissionKeys: canonical(desired),
        },
        { authenticated: true },
      );
      if (active.current && generation.current === requestGeneration)
        onSaved(result);
    } catch (e) {
      if (!active.current || generation.current !== requestGeneration) return;
      if (e.status === 401) {
        onDenied?.();
        return;
      }
      if (e.status === 403) {
        setStage("denied");
        setError(
          "You can no longer configure access. Refresh to check your current access.",
        );
      } else if (
        e.code === "ACCESS_STATE_STALE" ||
        e.code === "ACCESS_PERMISSION_NOT_MANAGEABLE" ||
        e.status === 409 ||
        e.status === 404
      ) {
        setStage("stale");
        setError(
          e.code === "ACCESS_STATE_STALE"
            ? "Someone changed access after you opened this staff member. Refresh the latest access before saving."
            : e.message,
        );
      } else if (!e.status || e.status >= 500) {
        setStage("uncertain");
        setError(
          "We couldn't confirm whether the access change was saved. Refresh access before trying again.",
        );
      } else {
        setStage("editing");
        setError(
          (e.message ||
            "Access changes were not saved. Review your selections.") +
            (e.violations?.length
              ? " " +
                e.violations
                  .map((v) => `${label(v.key)} requires ${label(v.required)}.`)
                  .join(" ")
              : ""),
        );
      }
    } finally {
      inFlight.current = false;
    }
  };
  const review = () => {
    if (state.violations.length || state.changesAdministrator) {
      setError(
        state.changesAdministrator
          ? "Access Administrator status is managed elsewhere and cannot be changed here."
          : null,
      );
      form.current
        ?.querySelectorAll("details.access-edit-category")
        .forEach((node) => {
          node.open = true;
        });
      if (state.violations.length && !state.changesAdministrator)
        focusDependencies();
      return;
    }
    setError(null);
    setStage("review");
  };
  const names = (keys) => (
    <ul>
      {keys.map((k) => (
        <li key={k}>{label(k)}</li>
      ))}
    </ul>
  );
  const changeCount = state.added.length + state.removed.length;
  return (
    <div className="access-editor" ref={form}>
      {router && (
        <LeaveGuard
          dirty={state.dirty}
          saving={saving || refreshing}
          confirm={confirm}
        />
      )}
      {!reviewing && (
        <section
          className="access-overview"
          aria-labelledby="access-overview-title"
        >
          <h3 id="access-overview-title">Access Overview</h3>
          <p>{detail.staff.displayName}</p>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{detail.staff.active ? "Active" : "Inactive"} in Reqro</dd>
            </div>
            <div>
              <dt>Current access</dt>
              <dd>{detail.effective.length} permissions</dd>
            </div>
            <div>
              <dt>After changes</dt>
              <dd>{state.effective.length} permissions</dd>
            </div>
            <div>
              <dt>Access Administrator</dt>
              <dd>
                {detail.accessAdministrator ? "Yes" : "No"}
                <small>Managed outside Access &amp; Permissions</small>
              </dd>
            </div>
          </dl>
        </section>
      )}
      <div ref={feedback} tabIndex={-1} role={error ? "alert" : undefined}>
        {stage === "stale" && <h4>Access has changed</h4>}
        {error && <p>{error}</p>}
        {["stale", "uncertain", "denied"].includes(stage) && (
          <button
            type="button"
            className="btn btn-outline-primary"
            disabled={refreshing}
            onClick={requestRefresh}
          >
            {refreshing
              ? "Refreshing…"
              : stage === "stale"
                ? "Refresh Access"
                : "Check Current Access"}
          </button>
        )}
        {detail.integrityWarning && (
          <p role="alert">
            Access configuration needs administrative attention before it can be
            changed.
          </p>
        )}
        {stage === "review" && <h3>Review Changes</h3>}
      </div>
      {reviewing ? (
        <AccessReview detail={detail} state={state} />
      ) : (
        <fieldset disabled={saving || blocked} className="access-editor-fields">
          <label className="access-quick-setup-label" htmlFor="access-preset">
            Quick Setup
          </label>
          <select
            id="access-preset"
            aria-describedby="access-quick-setup-help"
            className="form-select"
            value={presetId}
            onChange={(e) => {
              const preset = accessPresets.find((p) => p.id === e.target.value);
              if (!preset) {
                setPresetId("custom");
                return;
              }
              const action = () => {
                setDependencyNotice(null);
                setPresetId(preset.id);
                setDesired(presetAccess(preset, detail));
                setError(null);
              };
              if (state.dirty)
                confirm({
                  title: "Replace Current Draft?",
                  text: "Choosing this preset will replace your current access selections.",
                  label: "Use New Preset",
                  action,
                });
              else action();
            }}
          >
            <option value="custom">Custom Access</option>
            {accessPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p id="access-quick-setup-help">
            Choose a starting point or select permissions individually. Nothing
            is saved until you review and save your changes.
          </p>
          <h3>What This Staff Member Can Do</h3>
          {[
            "Service Requests",
            "Administrative Configuration",
            "Sensitive Information",
            "Specialized Capabilities",
          ].map((category) => {
            const items = detail.permissions.filter(
              (p) =>
                p.category === category && p.classification === "manageable",
            );
            const problem = state.violations.some((v) =>
              items.some((p) => p.key === v.key),
            );
            const categoryChanges = items.filter(
              (p) =>
                state.added.includes(p.key) || state.removed.includes(p.key),
            ).length;
            const title =
              {
                "Administrative Configuration": "Administration",
                "Specialized Capabilities": "Other Capabilities",
              }[category] || category;
            return (
              <details
                key={category}
                className="access-edit-category"
                open={
                  category === "Service Requests" ||
                  problem ||
                  dependencyNotice?.category === category ||
                  undefined
                }
              >
                <summary>
                  {title}
                  <span className="access-category-counts">
                    {items.filter((p) => desired.includes(p.key)).length}{" "}
                    assigned here ·{" "}
                    {items.filter((p) => state.outside.includes(p.key)).length}{" "}
                    assigned elsewhere
                    {categoryChanges > 0 &&
                      ` · ${categoryChanges} ${categoryChanges === 1 ? "change" : "changes"}`}
                    {problem ? " · Needs attention" : ""}
                  </span>
                </summary>
                {dependencyCategory === category && (
                  <section
                    id="access-required-feedback"
                    className="access-dependency-feedback"
                    tabIndex={-1}
                    aria-labelledby="access-required-title"
                  >
                    <h4 id="access-required-title">
                      Additional access required
                    </h4>
                    {[...new Set(state.violations.map((v) => v.key))].map(
                      (key) => (
                        <div key={key}>
                          <p>
                            To give {detail.staff.displayName} {label(key)},{" "}
                            {detail.staff.displayName} also needs:
                          </p>
                          {names([
                            ...new Set(
                              state.violations
                                .filter((v) => v.key === key)
                                .map((v) => v.required),
                            ),
                          ])}
                        </div>
                      ),
                    )}
                    <p>These permissions are not currently assigned.</p>
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      disabled={sameAccess(requiredDesired, desired)}
                      onClick={() => {
                        setDependencyNotice({
                          category,
                          keys: requiredDesired.filter(
                            (key) => !desired.includes(key),
                          ),
                        });
                        setPresetId("custom");
                        setDesired(requiredDesired);
                        setError(null);
                        focusDependencies();
                      }}
                    >
                      Add Required Access
                    </button>
                    {state.violations.some(
                      (v) =>
                        metadata.get(v.required)?.classification !==
                        "manageable",
                    ) && (
                      <p>
                        Some required access must be set up separately. Remove
                        the dependent selection or contact an administrator.
                      </p>
                    )}
                  </section>
                )}
                {!state.violations.length &&
                  dependencyNotice?.category === category && (
                    <section
                      className="access-dependency-feedback"
                      tabIndex={-1}
                      role="status"
                      aria-labelledby="access-added-title"
                    >
                      <h4 id="access-added-title">
                        Required access added to this draft
                      </h4>
                      {names(dependencyNotice.keys)}
                      <p>Nothing has been saved yet.</p>
                    </section>
                  )}
                {items.map((p) => {
                  const outsideOnly =
                    state.outside.includes(p.key) &&
                    !state.managed.includes(p.key);
                  const missing = state.violations.filter(
                    (v) => v.key === p.key,
                  );
                  const id = `access-permission-${p.key.replaceAll(".", "-")}`;
                  return (
                    <div className="access-edit-permission" key={p.key}>
                      {outsideOnly ? (
                        <strong>{accessText(p.label)}</strong>
                      ) : (
                        <label>
                          <input
                            id={id}
                            type="checkbox"
                            checked={desired.includes(p.key)}
                            onChange={() => toggle(p.key)}
                            aria-describedby={`${id}-description${missing.length ? " access-required-feedback" : ""}`}
                            aria-invalid={missing.length ? true : undefined}
                          />{" "}
                          <span>
                            {accessText(p.label)}{" "}
                            <small className="access-assignment-label">
                              Assign in Access &amp; Permissions
                            </small>
                          </span>
                        </label>
                      )}
                      {p.sensitive && (
                        <span className="badge text-bg-secondary">
                          Sensitive access
                        </span>
                      )}
                      <div id={`${id}-description`}>
                        <p>{accessText(p.description)}</p>
                        <p className="access-source-note">
                          <strong>
                            {
                              accessSource(
                                desired.includes(p.key),
                                state.outside.includes(p.key),
                              )[0]
                            }
                          </strong>
                          <br />
                          {
                            accessSource(
                              desired.includes(p.key),
                              state.outside.includes(p.key),
                            )[1]
                          }
                        </p>
                      </div>
                      <details className="access-permission-details">
                        <summary>Technical details</summary>
                        <dl>
                          <div>
                            <dt>Permission</dt>
                            <dd>
                              <code>{p.key}</code>
                            </dd>
                          </div>
                          <div>
                            <dt>Requires</dt>
                            <dd>
                              {(p.requires || []).map(label).join(", ") ||
                                "None"}
                            </dd>
                          </div>
                        </dl>
                        {p.contextual && <p>{accessText(p.contextual)}</p>}
                      </details>
                    </div>
                  );
                })}
              </details>
            );
          })}
        </fieldset>
      )}
      {!reviewing && (
        <>
          <details>
            <summary>
              Assigned Outside Access &amp; Permissions — {state.outside.length}{" "}
              permissions
            </summary>
            {names(state.outside)}
            <p>
              Outside assignments cannot be changed here. Source counts may
              overlap.
            </p>
          </details>
          <section
            className="access-scope"
            aria-labelledby="access-scope-title"
          >
            <h3 id="access-scope-title">Departments &amp; Divisions</h3>
            <p>
              These determine where this staff member can perform certain
              activities. They are managed separately from Access &amp;
              Permissions.
            </p>
            <dl>
              <div>
                <dt>Departments</dt>
                <dd>
                  {detail.departments.length
                    ? detail.departments.map((d) => (
                        <div key={d.id}>
                          {d.name}
                          {d.status === "inactive" ? " · Inactive" : ""}
                        </div>
                      ))
                    : "None"}
                </dd>
              </div>
              <div>
                <dt>Divisions</dt>
                <dd>
                  {detail.divisions.length
                    ? detail.divisions.map((d) => (
                        <div key={d.id}>
                          {d.name}
                          {d.status === "inactive" ? " · Inactive" : ""}
                        </div>
                      ))
                    : "None"}
                </dd>
              </div>
            </dl>
            <details>
              <summary>About access scope</summary>
              <p>
                Some permissions apply across the Organization. Division
                membership does not imply Department membership.
              </p>
            </details>
          </section>
        </>
      )}
      <footer className="access-editor-actions">
        <span className="access-change-summary" role="status">
          <strong>
            {changeCount
              ? reviewing
                ? `${changeCount} ${changeCount === 1 ? "change" : "changes"} ready to save`
                : `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`
              : "No unsaved changes"}
          </strong>
          {changeCount > 0 && (
            <small>
              {state.added.length} to add · {state.removed.length} to remove
            </small>
          )}
        </span>
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={saving || refreshing}
          onClick={
            stage === "review"
              ? () => {
                  setStage("editing");
                  requestAnimationFrame(() => reviewButton.current?.focus());
                }
              : cancel
          }
        >
          {stage === "review" ? "Back to Editing" : "Cancel"}
        </button>
        {stage === "review" || saving ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              saving ||
              blocked ||
              !state.dirty ||
              !!state.violations.length ||
              state.changesAdministrator
            }
            onClick={() =>
              state.sensitive.length
                ? confirm({
                    title: "Grant Sensitive Access?",
                    cancelLabel: "Keep Reviewing",
                    text: (
                      <SensitiveAccessSummary
                        detail={detail}
                        state={state}
                        label={label}
                      />
                    ),
                    label: "Grant Access",
                    action: save,
                  })
                : save()
            }
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked || !state.dirty}
            ref={reviewButton}
            onClick={review}
          >
            Review Changes
          </button>
        )}
      </footer>
      {confirmation && (
        <Confirmation
          title={confirmation.title}
          cancelLabel={confirmation.cancelLabel || "Keep Editing"}
          confirmLabel={confirmation.label}
          returnFocus={confirmation.returnFocus}
          onCancel={() => {
            confirmation.cancel?.();
            setConfirmation(null);
          }}
          onConfirm={() => {
            const action = confirmation.action;
            setConfirmation(null);
            action();
          }}
        >
          {confirmation.text}
        </Confirmation>
      )}
    </div>
  );
}
