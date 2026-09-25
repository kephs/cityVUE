import IssueDrawer from "./IssueDrawer.jsx";
import IssueResults from "./IssueResults.jsx";
import "./issueWorkspace.css";
import FollowUpQuestions, {
  questionPayload,
  validQuestions,
} from "./FollowUpQuestions.jsx";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  issueQueryDefaults,
  issueQueryParams,
  readIssueQuery,
} from "./issueDiscovery.js";
import IssueDiscoveryControls from "./IssueDiscoveryControls.jsx";
import IssueTemplatePicker from "./IssueTemplatePicker.jsx";
import IssueHandling, {
  availabilityLabels,
  handlingPayload,
  validHandoff,
} from "./IssueHandling.jsx";

const policyLabel = (value) =>
  value === "ANONYMOUS_ALLOWED"
    ? "Anonymous requests allowed"
    : "Identification required";
const targetKey = (target) => (target ? `${target.type}:${target.id}` : "");
const fields = (issue) => ({
  availability: issue?.availability ?? "",
  actionType: issue?.actionType ?? "internal_intake",
  destination: issue?.handling?.redirect?.destination ?? "",
  message: issue?.handling?.redirect?.message ?? "",
  label: issue?.handling?.redirect?.label ?? "Continue to external service",
  questions: issue?.questions ?? [],
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
  const [params, setParams] = useSearchParams();
  const query = readIssueQuery(params),
    queryKey = issueQueryParams(query).toString();
  const page = Number(query.page);
  const [search, setSearch] = useState(query.search),
    [categories, setCategories] = useState([]),
    [categoryError, setCategoryError] = useState(false),
    [categoryAttempt, setCategoryAttempt] = useState(0),
    [detailLoading, setDetailLoading] = useState(false);
  const detailAbort = useRef(null);
  const listAbort = useRef(null);
  const editorFeedback = useRef(null);
  const [detailError, setDetailError] = useState(null);
  const latestQuery = useRef(queryKey);
  latestQuery.current = queryKey;
  const updateQuery = (changes, replace = false) =>
    setParams(issueQueryParams({ ...query, ...changes }), { replace });
  const clearFilters = () => {
    setSearch("");
    updateQuery({
      ...issueQueryDefaults,
      pageSize: query.pageSize,
      sort: query.sort,
      direction: query.direction,
    });
  };
  useEffect(() => {
    if (params.toString() !== queryKey) setParams(queryKey, { replace: true });
  }, [queryKey, params, setParams]);
  useEffect(() => {
    setSearch(query.search);
  }, [query.search]);
  useEffect(() => {
    if (search.trim() === query.search) return;
    const timer = setTimeout(
      () => updateQuery({ search: search.trim(), page: "1" }),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, queryKey]);
  useEffect(() => {
    const abort = new AbortController();
    setCategoryError(false);
    client
      .get("/admin/issues/categories", {
        authenticated: true,
        signal: abort.signal,
      })
      .then(
        (result) => {
          if (!abort.signal.aborted) setCategories(result.items);
        },
        (failure) => {
          if (!abort.signal.aborted) {
            setCategories([]);
            setCategoryError(true);
            if ([401, 403].includes(failure.status)) onDenied();
          }
        },
      );
    return () => abort.abort();
  }, [client, categoryAttempt, onDenied]);
  const [data, setData] = useState(null),
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
      detailAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    listAbort.current = abort;
    setLoading(true);
    setError((previous) => (edit ? previous : null));
    client
      .get(`/admin/issues/summaries?${queryKey}`, {
        authenticated: true,
        signal: abort.signal,
      })
      .then(
        (result) => {
          if (!abort.signal.aborted) {
            setData(result);
            if (result.page !== page)
              updateQuery({ page: String(result.page) }, true);
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
            if ([401, 403].includes(failure.status)) {
              setEdit(null);
              setDraft(fields());
              setTargets([]);
              onDenied();
            }
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
  }, [client, queryKey, attempt]);
  useEffect(() => {
    if (edit && !edit.loading) input.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      (origin.current?.isConnected
        ? origin.current
        : add.current || feedback.current
      )?.focus();
    }
  }, [edit]);
  useEffect(() => {
    if (error) (edit ? editorFeedback.current : feedback.current)?.focus();
  }, [error]);
  useEffect(() => {
    if (notice && !loading)
      (cards.current.get(notice.id) || feedback.current)?.focus();
  }, [notice, loading]);
  const targetIssue = edit?.issue?.id || draft.templateId;
  useEffect(() => {
    if (
      !edit ||
      edit.loading ||
      edit.kind === "view" ||
      edit.kind === "order" ||
      !targetIssue
    ) {
      setTargets([]);
      setTargetsLoading(false);
      setTargetError(false);
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
    !!edit &&
    !edit.loading &&
    !detailError &&
    edit.kind !== "view" &&
    JSON.stringify(draft) !== JSON.stringify(fields(edit.issue));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const leave = (e) => {
      const link = e.target.closest?.("a[href]");
      if (link && !window.confirm("Discard unsaved Issue changes?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty]);
  const name = draft.name.trim(),
    description = draft.description.trim();
  const valid =
    validQuestions(draft.questions) &&
    name.length > 0 &&
    Array.from(name).length <= 200 &&
    Array.from(description).length <= 1000 &&
    !/[<>\p{Cs}\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
      name + description,
    ) &&
    !/[\r\n\t]/u.test(name) &&
    /^\d+$/.test(draft.displayOrder) &&
    Number(draft.displayOrder) <= 2147483647 &&
    (edit?.issue || (draft.templateId && draft.availability)) &&
    (!edit?.issue?.canManageHandling || validHandoff(draft));
  async function open(issue, kind, event) {
    if (event?.currentTarget) origin.current = event.currentTarget;
    setError(null);
    setNotice(null);
    setDetailError(null);
    if (issue) {
      if (kind !== "state") {
        setEdit({ issue, kind, loading: true });
        setDraft(fields());
      }
      detailAbort.current?.abort();
      const abort = new AbortController();
      detailAbort.current = abort;
      setDetailLoading(true);
      try {
        const result = await client.get(
          `/admin/issues/${encodeURIComponent(issue.id)}`,
          { authenticated: true, signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        issue = result.issue;
      } catch (failure) {
        if (!abort.signal.aborted) {
          if ([401, 403].includes(failure.status)) {
            setEdit(null);
            setDraft(fields());
            setData(null);
            onDenied();
          } else if (kind !== "state") {
            setDetailError(
              failure.status === 404
                ? "This Issue is no longer available. Close configuration and refresh Issues."
                : "The latest Issue configuration could not be loaded. Retry configuration.",
            );
          } else
            setError({
              message:
                "The latest Issue configuration could not be loaded. Try the action again.",
              blocked: false,
            });
        }
        return;
      } finally {
        if (!abort.signal.aborted) setDetailLoading(false);
      }
    }
    if (kind === "state") {
      const command = () =>
        save(issue, {
          ...payload(issue, fields(issue)),
          active: !issue.active,
        });
      if (issue.active)
        setConfirmation({
          returnFocus: origin.current,
          kind: "deactivate",
          action: command,
        });
      else command();
      return;
    }
    setEdit({ issue, kind });
    setDraft(fields(issue));
    setTargetSearch("");
  }
  function closeEditor() {
    detailAbort.current?.abort();
    setDetailLoading(false);
    restoreFocus.current = true;
    setEdit(null);
    setDraft(fields());
    setDetailError(null);
    if (!error?.blocked) setError(null);
  }
  function cancel() {
    if (busy || dirty)
      setConfirmation({
        kind: busy ? "pending" : "discard-close",
        action: closeEditor,
        returnFocus: document.activeElement,
      });
    else closeEditor();
  }
  function refresh(nextPage = page) {
    const action = () => {
      refreshFocus.current = { id: edit?.issue?.id };
      setEdit(null);
      setNotice(null);
      setError(null);
      if (nextPage !== page) updateQuery({ page: String(nextPage) });
      else setAttempt((n) => n + 1);
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
            questions: questionPayload(values.questions),
            active: issue.active,
            expectedCoreRevision: issue.coreRevision,
            expectedActionRevision: issue.actionRevision,
            expectedPolicyRevision: issue.policyRevision,
            expectedAssignmentRevision: issue.assignmentRevision,
          }
        : { templateId: values.templateId, availability: values.availability }),
      ...(issue?.canManageHandling &&
      JSON.stringify(handlingPayload(values)) !==
        JSON.stringify(handlingPayload(fields(issue)))
        ? { handling: handlingPayload(values) }
        : {}),
    };
  }
  async function save(issue, body) {
    if (mutation.current) return;
    const abort = new AbortController();
    mutation.current = abort;
    listAbort.current?.abort();
    setLoading(false);
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
      const savedQuery = latestQuery.current;
      const next = await client.get(`/admin/issues/summaries?${savedQuery}`, {
        authenticated: true,
        signal: abort.signal,
      });
      if (!abort.signal.aborted && latestQuery.current === savedQuery) {
        setData(next);
        const currentQuery = readIssueQuery(new URLSearchParams(savedQuery));
        if (next.page !== Number(currentQuery.page))
          setParams(
            issueQueryParams({ ...currentQuery, page: String(next.page) }),
            { replace: true },
          );
      }
    } catch (failure) {
      if (abort.signal.aborted) return;
      if ([401, 403].includes(failure.status)) {
        setEdit(null);
        setDraft(fields());
        setTargets([]);
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
                : "Check the Issue name, description, follow-up questions, assignment and external handoff settings. Use a public HTTPS destination without sign-in credentials. Names must be unique, including inactive Issues. Refresh if a selected target is no longer available."
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
              {data.active} active · {data.inactive} inactive
            </p>
          )}
        </div>
        <div className="d-flex flex-wrap gap-2">
          {data?.canWrite && (
            <button
              ref={add}
              className="btn btn-primary"
              disabled={
                busy || loading || detailLoading || !!edit || error?.blocked
              }
              onClick={(event) => open(null, "create", event)}
            >
              + Add Issue
            </button>
          )}
          <button
            className="btn btn-outline-primary"
            disabled={busy || loading}
            onClick={() => refresh()}
          >
            Refresh Issues
          </button>
        </div>
      </div>
      <IssueDiscoveryControls
        query={query}
        search={search}
        setSearch={setSearch}
        update={updateQuery}
        clear={clearFilters}
        categories={categories}
        categoryError={categoryError}
        retryCategories={() => setCategoryAttempt((n) => n + 1)}
        disabled={busy || !!edit || detailLoading}
      />
      <div ref={feedback} tabIndex="-1">
        {error && !edit && <p role="alert">{error.message}</p>}
        {notice && (
          <p role="status">
            {notice.message}{" "}
            {notice.id &&
              data &&
              !data.items.some((i) => i.id === notice.id) && (
                <>
                  This Issue is outside the current page or filters.{" "}
                  <button
                    className="btn btn-link"
                    disabled={busy || !!edit}
                    onClick={(event) => open({ id: notice.id }, "edit", event)}
                  >
                    Review saved Issue
                  </button>
                </>
              )}
          </p>
        )}
      </div>
      {loading && <p role="status">Loading Issues…</p>}
      {detailLoading && !edit && (
        <p role="status">Loading the latest Issue configuration…</p>
      )}
      {data && (
        <>
          {!loading && !data.total && (
            <p>
              {data.organizationTotal === 0
                ? "No Issues are configured."
                : "No Issues match these filters."}
              {data.organizationTotal > 0 && (
                <button className="btn btn-link" onClick={clearFilters}>
                  Clear filters and try again
                </button>
              )}
              {!data.canWrite && " This page is read-only."}
            </p>
          )}
          {edit && (
            <IssueDrawer
              compact={edit.kind === "order"}
              title={
                edit.kind === "create"
                  ? "Add Issue"
                  : edit.kind === "order"
                    ? "Change Display Order"
                    : edit.kind === "view"
                      ? "View Configuration"
                      : "Configure Issue"
              }
              subtitle={edit.issue?.name}
              onClose={cancel}
            >
              <div ref={editorFeedback} tabIndex={-1}>
                {error && <p role="alert">{error.message}</p>}
                {error?.blocked && (
                  <button
                    className="btn btn-outline-primary"
                    onClick={() =>
                      setConfirmation({
                        kind: "discard",
                        returnFocus: document.activeElement,
                        action: () => open(edit.issue, edit.kind),
                      })
                    }
                  >
                    Refresh Configuration
                  </button>
                )}
              </div>
              {edit.loading && !detailError && (
                <p role="status">Loading the latest Issue configuration…</p>
              )}
              {detailError && (
                <div>
                  <p role="alert">{detailError}</p>
                  <button
                    className="btn btn-outline-primary"
                    onClick={() => open(edit.issue, edit.kind)}
                  >
                    Retry Configuration
                  </button>
                </div>
              )}
              {!edit.loading && !detailError && !data.canWrite && (
                <>
                  <section>
                    <h3>General</h3>
                    <p>{edit.issue.description}</p>
                    <p>Category: {edit.issue.category}</p>
                    <p>Status: {edit.issue.active ? "Active" : "Inactive"}</p>
                  </section>
                  <section>
                    <h3>Intake &amp; Access</h3>
                    <IssueHandling issue={edit.issue} draft={draft} readOnly />
                    <p>
                      Requester Policy:{" "}
                      {policyLabel(edit.issue.requesterPolicy)}
                    </p>
                  </section>
                  <section>
                    <h3>Assignment</h3>
                    <p>
                      {edit.issue.defaultAssignment?.displayName ||
                        "No default assignment"}
                    </p>
                  </section>
                  <FollowUpQuestions questions={draft.questions} readOnly />
                  <button className="btn btn-secondary" onClick={cancel}>
                    Close Configuration
                  </button>
                </>
              )}
              {!edit.loading && !detailError && data.canWrite && (
                <form
                  className="configuration-area-form issue-editor-form"
                  aria-labelledby="issue-editor-title"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      valid &&
                      dirty &&
                      !busy &&
                      !error?.blocked &&
                      !targetError &&
                      !targetsLoading
                    )
                      save(edit.issue, payload(edit.issue, draft));
                  }}
                >
                  <h3 id="issue-editor-title" className="visually-hidden">
                    Issue Configuration Fields
                  </h3>
                  {!edit.issue && (
                    <>
                      <p>
                        New Issues are created Inactive. You can review the
                        Issue before making it available for new requests.
                      </p>
                      <IssueTemplatePicker
                        client={client}
                        disabled={busy}
                        onDenied={onDenied}
                        onChange={(id) => set("templateId", id)}
                      />
                    </>
                  )}
                  {edit.kind !== "order" && (
                    <>
                      <section className="issue-editor-section">
                        <h3>General</h3>
                        {edit.issue && <p>Category: {edit.issue.category}</p>}
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
                      </section>
                      <section className="issue-editor-section">
                        <h3>Intake &amp; Access</h3>
                        <IssueHandling
                          issue={edit.issue}
                          draft={draft}
                          set={set}
                          disabled={busy}
                        />
                        <div hidden={draft.actionType === "external_redirect"}>
                          <fieldset disabled={busy}>
                            <legend className="h5">
                              Who can submit this request?
                            </legend>
                            {["IDENTIFIED_REQUIRED", "ANONYMOUS_ALLOWED"].map(
                              (policy) => (
                                <label className="d-block" key={policy}>
                                  <input
                                    type="radio"
                                    name="issue-policy"
                                    value={policy}
                                    checked={draft.requesterPolicy === policy}
                                    onChange={() =>
                                      set("requesterPolicy", policy)
                                    }
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
                        </div>
                      </section>
                      <section
                        className="issue-editor-section"
                        hidden={draft.actionType === "external_redirect"}
                      >
                        <h3>Assignment</h3>
                        <div>
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
                          <label htmlFor="issue-assignment">
                            Default assignment
                          </label>
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
                                <option
                                  value={targetKey(
                                    edit.issue.defaultAssignment,
                                  )}
                                >
                                  {edit.issue.defaultAssignment.displayName}{" "}
                                  (current selection)
                                </option>
                              )}
                            {targets.map((target) => (
                              <option
                                key={targetKey(target)}
                                value={targetKey(target)}
                              >
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
                            New requests use this assignment by default.
                            Existing assignments are not changed.
                          </p>
                          {targetError && (
                            <p role="alert">
                              Assignment targets could not be loaded. Refresh
                              before saving.
                            </p>
                          )}
                        </div>
                      </section>
                    </>
                  )}
                  {edit.issue &&
                    edit.kind !== "order" &&
                    draft.actionType !== "external_redirect" && (
                      <section className="issue-editor-section">
                        <FollowUpQuestions
                          questions={draft.questions}
                          onChange={(value) => set("questions", value)}
                          disabled={busy}
                        />
                      </section>
                    )}
                  {(edit.kind === "order" || !edit.issue) && (
                    <>
                      <label htmlFor="issue-order">Display Order</label>
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
                      <p>
                        Lower numbers appear first within the Category. Ties are
                        sorted by name.
                      </p>
                    </>
                  )}
                  <p id="issue-validation">
                    {!valid
                      ? "Complete the required fields above. Use a plain-text name and a whole-number order of zero or greater."
                      : dirty
                        ? "Unsaved changes."
                        : "No unsaved changes."}
                  </p>
                  <div className="issue-editor-actions">
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
                          ? "Save Changes"
                          : "Create Issue"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={cancel}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </IssueDrawer>
          )}
          <p role="status" className="issue-result-count">
            {!loading && `${data.total} Issues`}
          </p>
          <IssueResults
            data={data}
            loading={loading}
            disabled={
              busy || loading || detailLoading || !!edit || error?.blocked
            }
            onAction={open}
            rows={cards}
          />
          <nav aria-label="Issue pages" className="issue-workspace-pagination">
            <label htmlFor="issue-page-size">Rows per page</label>
            <select
              id="issue-page-size"
              className="form-select"
              value={query.pageSize}
              disabled={busy || loading || !!edit}
              onChange={(event) =>
                updateQuery({ pageSize: event.target.value, page: "1" })
              }
            >
              {[25, 50, 100, 250, 500].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>
              {data.total ? (data.page - 1) * data.pageSize + 1 : 0}–
              {Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </span>
            <button
              className="btn btn-outline-primary"
              disabled={page === 1 || busy || loading || !!edit}
              onClick={() => refresh(page - 1)}
            >
              Previous Issues
            </button>
            <span>
              Page {data.page} of{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              className="btn btn-outline-primary"
              disabled={
                page * data.pageSize >= data.total || busy || loading || !!edit
              }
              onClick={() => refresh(page + 1)}
            >
              Next Issues
            </button>
          </nav>
        </>
      )}
      {confirmation && (
        <Confirmation
          returnFocus={confirmation.returnFocus}
          title={
            confirmation.kind.startsWith("discard")
              ? "Discard unsaved changes?"
              : confirmation.kind === "pending"
                ? "Close while saving?"
                : "Deactivate this Issue?"
          }
          confirmLabel={
            confirmation.kind.startsWith("discard")
              ? confirmation.kind === "discard-close"
                ? "Discard and close"
                : "Discard and refresh"
              : confirmation.kind === "pending"
                ? "Close configuration"
                : "Deactivate issue"
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action;
            setConfirmation(null);
            action();
          }}
        >
          {confirmation.kind.startsWith("discard")
            ? confirmation.kind === "discard-close"
              ? "Your unsaved configuration changes will be discarded."
              : "Refresh will replace your edits with the latest configuration."
            : confirmation.kind === "pending"
              ? "Saving is still in progress. Closing does not cancel the submitted change. The result will appear in the Issue list."
              : "It will no longer be available for new requests. Existing requests and history will be kept."}
        </Confirmation>
      )}
    </div>
  );
}
