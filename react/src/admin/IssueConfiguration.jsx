import { useEffect, useRef, useState } from "react";

const policyLabel = (value) =>
  value === "ANONYMOUS_ALLOWED"
    ? "Anonymous requests allowed"
    : "Identification required";
const targetKey = (target) => (target ? `${target.type}:${target.id}` : "");
const fields = (issue) => ({
  name: issue?.name ?? "",
  description: issue?.description ?? "",
  displayOrder: String(issue?.displayOrder ?? 0),
  requesterPolicy: issue?.requesterPolicy ?? "IDENTIFIED_REQUIRED",
  target: targetKey(issue?.defaultAssignment),
  templateId: "",
});
function Confirmation({
  title,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  returnFocus,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = returnFocus;
    const node = dialog.current;
    node.showModal();
    return () => {
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="configuration-dialog"
      aria-labelledby="issue-confirm-title"
      aria-describedby="issue-confirm-description"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="issue-confirm-title">{title}</h2>
      <p id="issue-confirm-description">{children}</p>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        <button autoFocus className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
export default function IssueConfiguration({ client, onDenied }) {
  const [data, setData] = useState(null),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null),
    [draft, setDraft] = useState(fields()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null),
    [notice, setNotice] = useState(null),
    [confirmation, setConfirmation] = useState(null);
  const [targets, setTargets] = useState([]),
    [targetSearch, setTargetSearch] = useState(""),
    [targetsLoading, setTargetsLoading] = useState(false),
    [targetError, setTargetError] = useState(false);
  const mutation = useRef(null),
    mounted = useRef(true),
    input = useRef(null),
    feedback = useRef(null),
    origin = useRef(null),
    restoreFocus = useRef(false),
    refreshFocus = useRef(null),
    cards = useRef(new Map()),
    add = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutation.current?.abort();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    client
      .get(`/admin/issues?page=${page}`, {
        authenticated: true,
        signal: abort.signal,
      })
      .then(
        (result) => {
          if (!abort.signal.aborted) {
            setData(result);
            setLoading(false);
            if (refreshFocus.current) {
              setNotice({
                id: refreshFocus.current.id,
                message: "Issue configuration refreshed.",
              });
              refreshFocus.current = null;
            }
          }
        },
        (failure) => {
          if (!abort.signal.aborted) {
            setData(null);
            setLoading(false);
            setError({
              message: [401, 403].includes(failure.status)
                ? "You are not authorized to view Issue configuration."
                : "Issue configuration could not be loaded. Try Refresh.",
              blocked: true,
            });
          }
        },
      );
    return () => abort.abort();
  }, [client, page, attempt]);
  useEffect(() => {
    if (edit) input.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      origin.current?.focus();
    }
  }, [edit]);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  useEffect(() => {
    if (notice && !loading)
      (cards.current.get(notice.id) || feedback.current)?.focus();
  }, [notice, loading]);
  const targetIssue = edit?.issue?.id || draft.templateId;
  useEffect(() => {
    if (!edit || !targetIssue) {
      setTargets([]);
      return;
    }
    const abort = new AbortController();
    setTargetsLoading(true);
    setTargetError(false);
    client
      .get(
        `/admin/issues/${encodeURIComponent(targetIssue)}/assignment-targets?search=${encodeURIComponent(targetSearch)}`,
        { authenticated: true, signal: abort.signal },
      )
      .then(
        (result) => {
          if (!abort.signal.aborted) {
            setTargets(result.items);
            setTargetsLoading(false);
          }
        },
        () => {
          if (!abort.signal.aborted) {
            setTargets([]);
            setTargetsLoading(false);
            setTargetError(true);
          }
        },
      );
    return () => abort.abort();
  }, [client, edit, targetIssue, targetSearch]);
  const dirty =
    !!edit && JSON.stringify(draft) !== JSON.stringify(fields(edit.issue));
  const name = draft.name.trim(),
    description = draft.description.trim();
  const valid =
    name.length > 0 &&
    Array.from(name).length <= 200 &&
    Array.from(description).length <= 1000 &&
    !/[<>\p{Cs}\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
      name + description,
    ) &&
    !/[\r\n\t]/u.test(name) &&
    /^\d+$/.test(draft.displayOrder) &&
    Number(draft.displayOrder) <= 2147483647 &&
    (edit?.issue || draft.templateId);
  function open(issue, kind, event) {
    origin.current = event.currentTarget;
    setEdit({ issue, kind });
    setDraft(fields(issue));
    setTargetSearch("");
    setError(null);
    setNotice(null);
  }
  function cancel() {
    restoreFocus.current = true;
    setEdit(null);
    if (!error?.blocked) setError(null);
  }
  function refresh(nextPage = page) {
    const action = () => {
      refreshFocus.current = { id: edit?.issue?.id };
      setEdit(null);
      setNotice(null);
      setError(null);
      setPage(nextPage);
      setAttempt((n) => n + 1);
    };
    if (edit)
      setConfirmation({
        kind: "discard",
        action,
        returnFocus: document.activeElement,
      });
    else action();
  }
  function payload(issue, values) {
    const [type, id] = values.target.split(":");
    return {
      name: values.name.trim(),
      description: values.description.trim(),
      displayOrder: Number(values.displayOrder),
      requesterPolicy: values.requesterPolicy,
      defaultAssignment: values.target ? { type, id } : null,
      ...(issue
        ? {
            active: issue.active,
            expectedCoreRevision: issue.coreRevision,
            expectedActionRevision: issue.actionRevision,
            expectedPolicyRevision: issue.policyRevision,
            expectedAssignmentRevision: issue.assignmentRevision,
          }
        : { templateId: values.templateId }),
    };
  }
  async function save(issue, body) {
    if (mutation.current) return;
    const abort = new AbortController();
    mutation.current = abort;
    setBusy(true);
    setError(null);
    setConfirmation(null);
    try {
      const result = issue
        ? await client.patch(
            `/admin/issues/${encodeURIComponent(issue.id)}`,
            body,
            { authenticated: true, signal: abort.signal },
          )
        : await client.post("/admin/issues", body, {
            authenticated: true,
            signal: abort.signal,
          });
      if (abort.signal.aborted) return;
      setEdit(null);
      setNotice({
        id: result.issue.id,
        message: result.changed
          ? issue
            ? "Issue configuration updated."
            : "Issue created Inactive. Review it before activation."
          : "Issue configuration is unchanged.",
      });
      const next = await client.get(`/admin/issues?page=${page}`, {
        authenticated: true,
        signal: abort.signal,
      });
      if (!abort.signal.aborted) setData(next);
    } catch (failure) {
      if (abort.signal.aborted) return;
      if ([401, 403].includes(failure.status)) {
        setEdit(null);
        setData(null);
        onDenied();
        return;
      }
      setError({
        blocked: failure.status !== 400,
        message:
          failure.status === 409
            ? "This Issue changed since you opened it. Refresh the latest configuration before making another change."
            : failure.status === 400
              ? failure.code === "ISSUE_DUPLICATE"
                ? "An Issue with this name already exists. Inactive names remain reserved; reactivate the existing Issue to use its name again."
                : "Check the Issue name, description and assignment. Names must be unique, including inactive Issues. Refresh if a selected target is no longer available."
              : "The Issue could not be saved or refreshed. Refresh to check its current state before trying again.",
      });
    } finally {
      if (mounted.current) {
        mutation.current = null;
        setBusy(false);
      }
    }
  }
  const set = (key, value) => setDraft((old) => ({ ...old, [key]: value }));
  return (
    <div className="issue-configuration">
      <div className="participation-section-heading">
        <div>
          <p>Manage the request types available for new requests.</p>
          {data && (
            <p>
              {data.active} active · {data.total - data.active} inactive
            </p>
          )}
        </div>
        <button
          className="btn btn-outline-primary"
          disabled={busy || loading}
          onClick={() => refresh()}
        >
          Refresh Issues
        </button>
      </div>
      <div ref={feedback} tabIndex="-1">
        {error && <p role="alert">{error.message}</p>}
        {notice && <p role="status">{notice.message}</p>}
      </div>
      {loading && <p role="status">Loading Issues…</p>}
      {data && (
        <>
          <p className="participation-order-help">
            Within each Category, lower numbers appear first. Issues with the
            same number are sorted by name.
          </p>
          {data.canWrite && (
            <button
              ref={add}
              className="btn btn-primary mb-3"
              disabled={busy || loading || !!edit || error?.blocked}
              onClick={(e) => open(null, "create", e)}
            >
              + Add issue
            </button>
          )}
          {!data.total && (
            <p>
              No Issues are configured.
              {!data.canWrite && " This page is read-only."}
            </p>
          )}
          {edit && data.canWrite && (
            <form
              className="configuration-area-form mb-4"
              aria-labelledby="issue-editor-title"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && dirty && !busy && !error?.blocked)
                  save(edit.issue, payload(edit.issue, draft));
              }}
            >
              <h2 id="issue-editor-title">
                {edit.kind === "create"
                  ? "Add issue"
                  : edit.kind === "order"
                    ? `Change order for ${edit.issue.name}`
                    : `Edit ${edit.issue.name}`}
              </h2>
              {!edit.issue && (
                <>
                  <p>
                    New Issues are created Inactive. You can review the Issue
                    before making it available for new requests.
                  </p>
                  <label htmlFor="issue-template">Intake template</label>
                  <select
                    id="issue-template"
                    className="form-select"
                    value={draft.templateId}
                    disabled={busy}
                    onChange={(e) => {
                      set("templateId", e.target.value);
                      set("target", "");
                    }}
                    required
                  >
                    <option value="">Choose an existing Issue</option>
                    {data.items
                      .filter((i) => i.templateEligible)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} — {i.category}
                        </option>
                      ))}
                  </select>
                  <p>
                    Copies this Issue’s Category and intake form/settings once.
                    Later template changes do not affect the new Issue.
                    Templates shown are from this page.
                  </p>
                </>
              )}
              {edit.kind !== "order" && (
                <>
                  <label htmlFor="issue-name">Issue name</label>
                  <input
                    ref={input}
                    id="issue-name"
                    className="form-control"
                    value={draft.name}
                    disabled={busy}
                    onChange={(e) => set("name", e.target.value)}
                    required
                    maxLength={200}
                    aria-describedby="issue-validation"
                  />
                  <label htmlFor="issue-description">Description</label>
                  <textarea
                    id="issue-description"
                    className="form-control"
                    value={draft.description}
                    disabled={busy}
                    onChange={(e) => set("description", e.target.value)}
                    maxLength={1000}
                    aria-describedby="issue-description-help issue-validation"
                  />
                  <p id="issue-description-help">
                    Optional plain text, up to 1,000 characters.
                  </p>
                  <fieldset disabled={busy}>
                    <legend className="h5">Who can submit this request?</legend>
                    {["IDENTIFIED_REQUIRED", "ANONYMOUS_ALLOWED"].map(
                      (policy) => (
                        <label className="d-block" key={policy}>
                          <input
                            type="radio"
                            name="issue-policy"
                            value={policy}
                            checked={draft.requesterPolicy === policy}
                            onChange={() => set("requesterPolicy", policy)}
                          />{" "}
                          {policyLabel(policy)}
                        </label>
                      ),
                    )}
                    <p>
                      {draft.requesterPolicy === "ANONYMOUS_ALLOWED"
                        ? "Requesters may submit this request without identifying themselves."
                        : "Requesters must provide the required identity information for this request."}
                    </p>
                  </fieldset>
                  <label htmlFor="issue-target-search">
                    Find an assignment target
                  </label>
                  <input
                    id="issue-target-search"
                    className="form-control"
                    value={targetSearch}
                    disabled={busy || !targetIssue}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    maxLength={100}
                  />
                  <label htmlFor="issue-assignment">Default assignment</label>
                  <select
                    id="issue-assignment"
                    className="form-select"
                    value={draft.target}
                    disabled={busy || targetsLoading || !targetIssue}
                    onChange={(e) => set("target", e.target.value)}
                    aria-describedby="issue-assignment-help"
                  >
                    <option value="">No default assignment</option>
                    {edit.issue?.defaultAssignment &&
                      !targets.some(
                        (t) =>
                          targetKey(t) ===
                          targetKey(edit.issue.defaultAssignment),
                      ) && (
                        <option value={targetKey(edit.issue.defaultAssignment)}>
                          {edit.issue.defaultAssignment.displayName} (current
                          selection)
                        </option>
                      )}
                    {targets.map((target) => (
                      <option key={targetKey(target)} value={targetKey(target)}>
                        {target.displayName} —{" "}
                        {target.type === "staff"
                          ? "Staff"
                          : target.type === "role"
                            ? "Role"
                            : "Team"}
                      </option>
                    ))}
                  </select>
                  <p id="issue-assignment-help">
                    New requests use this assignment by default. Existing
                    assignments are not changed.
                  </p>
                  {targetError && (
                    <p role="alert">
                      Assignment targets could not be loaded. Refresh before
                      saving.
                    </p>
                  )}
                </>
              )}
              <label htmlFor="issue-order">Display order</label>
              <input
                ref={edit.kind === "order" ? input : undefined}
                id="issue-order"
                type="number"
                className="form-control"
                min="0"
                max="2147483647"
                step="1"
                value={draft.displayOrder}
                disabled={busy}
                onChange={(e) => set("displayOrder", e.target.value)}
                aria-describedby="issue-validation"
              />
              <p id="issue-validation">
                {!valid
                  ? "Enter a plain-text name, valid template and a whole-number order of zero or greater."
                  : dirty
                    ? "Unsaved changes."
                    : "No unsaved changes."}
              </p>
              <div className="d-flex gap-2 flex-wrap">
                <button
                  className="btn btn-primary"
                  disabled={
                    !valid ||
                    !dirty ||
                    busy ||
                    error?.blocked ||
                    targetError ||
                    targetsLoading
                  }
                >
                  {busy
                    ? "Saving…"
                    : edit.issue
                      ? "Save changes"
                      : "Create issue"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={cancel}
                >
                  Cancel edit
                </button>
              </div>
            </form>
          )}
          <ul className="configuration-cards participation-area-list">
            {data.items.map((issue) => (
              <li
                key={issue.id}
                tabIndex="-1"
                aria-label={issue.name}
                ref={(node) => {
                  if (node) cards.current.set(issue.id, node);
                  else cards.current.delete(issue.id);
                }}
              >
                <div className="participation-area-heading">
                  <h2>{issue.name}</h2>
                  <span
                    className={`participation-state ${issue.active ? "is-active" : ""}`}
                  >
                    {issue.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p>{issue.description}</p>
                <p>{issue.category}</p>
                <dl>
                  <dt>Requester</dt>
                  <dd>{policyLabel(issue.requesterPolicy)}</dd>
                  <dt>Default assignment</dt>
                  <dd>
                    {issue.defaultAssignment?.displayName ??
                      "No default assignment"}
                  </dd>
                </dl>
                <p>Order {issue.displayOrder}</p>
                {data.canWrite && (
                  <div className="d-flex gap-2 flex-wrap">
                    <button
                      className="btn btn-outline-primary"
                      disabled={busy || loading || !!edit || error?.blocked}
                      aria-label={`Edit configuration for ${issue.name}`}
                      onClick={(e) => open(issue, "edit", e)}
                    >
                      Edit configuration
                    </button>
                    <button
                      className="btn btn-outline-primary"
                      disabled={busy || loading || !!edit || error?.blocked}
                      aria-label={`Change order for ${issue.name}`}
                      onClick={(e) => open(issue, "order", e)}
                    >
                      Change order
                    </button>
                    <button
                      className="btn btn-outline-primary"
                      disabled={busy || loading || !!edit || error?.blocked}
                      aria-label={`${issue.active ? "Deactivate" : "Activate"} ${issue.name}`}
                      onClick={() => {
                        const command = () =>
                          save(issue, {
                            ...payload(issue, fields(issue)),
                            active: !issue.active,
                          });
                        if (issue.active)
                          setConfirmation({
                            returnFocus: document.activeElement,
                            kind: "deactivate",
                            action: command,
                          });
                        else command();
                      }}
                    >
                      {issue.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {data.total > data.pageSize && (
            <nav
              aria-label="Issue pages"
              className="d-flex gap-3 align-items-center mt-3"
            >
              <button
                className="btn btn-outline-primary"
                disabled={page === 1 || busy || loading}
                onClick={() => refresh(page - 1)}
              >
                Previous Issues
              </button>
              <span>
                Page {page} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <button
                className="btn btn-outline-primary"
                disabled={page * data.pageSize >= data.total || busy || loading}
                onClick={() => refresh(page + 1)}
              >
                Next Issues
              </button>
            </nav>
          )}
        </>
      )}
      {confirmation && (
        <Confirmation
          returnFocus={confirmation.returnFocus}
          title={
            confirmation.kind === "discard"
              ? "Discard unsaved changes?"
              : "Deactivate this Issue?"
          }
          confirmLabel={
            confirmation.kind === "discard"
              ? "Discard and refresh"
              : "Deactivate issue"
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action;
            setConfirmation(null);
            action();
          }}
        >
          {confirmation.kind === "discard"
            ? "Refresh will replace your edits with the latest configuration."
            : "It will no longer be available for new requests. Existing requests and history will be kept."}
        </Confirmation>
      )}
    </div>
  );
}
