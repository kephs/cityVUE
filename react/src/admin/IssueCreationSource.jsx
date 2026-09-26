import Confirmation from "./Confirmation.jsx";
import { useEffect, useRef, useState } from "react";
import IssueCreationPicker from "./IssueCreationPicker.jsx";

export default function IssueCreationSource({
  client,
  draft,
  setDraft,
  disabled,
  onDenied,
  onReviewed,
}) {
  const pending = useRef(null),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState(null);
  useEffect(() => () => pending.current?.abort(), []);
  function select(item) {
    if (
      draft.templateId ||
      draft.questions.length ||
      draft.defaultPriority ||
      draft.locationPolicy ||
      draft.geographicEligibilityMode
    ) {
      setConfirmation({
        action: () => applySource(item),
        returnFocus: document.activeElement,
      });
    } else applySource(item);
  }
  async function applySource(item) {
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    setError("");
    setDraft((d) => ({ ...d, sourcePending: true }));
    try {
      const { source } = await client.get(
        `/admin/issues/creation/sources/${encodeURIComponent(item.id)}?categoryId=${encodeURIComponent(draft.category.id)}`,
        { authenticated: true, signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      setDraft((d) => ({
        ...d,
        templateId: source.id,
        expectedSourceVersion: source.catalogVersionId,
        source,
        defaultPriority:
          source.defaultPriority === "urgent" ? "" : source.defaultPriority,
        locationPolicy: source.locationPolicy,
        geographicEligibilityMode: source.supportedGeography
          ? source.geographicEligibilityMode
          : "",
        questions: source.questions,
        sourcePending: false,
      }));
      onReviewed();
      if (source.defaultPriority === "urgent")
        setError(
          "This source uses Urgent. Select Low, Medium or High before creating the Issue.",
        );
      if (!source.supportedGeography)
        setError(
          "The source geographic policy is not supported for new Issues. Review and explicitly choose a supported Geographic Eligibility policy.",
        );
    } catch (failure) {
      if (abort.signal.aborted) return;
      setDraft((d) => ({ ...d, sourcePending: false }));
      setError(
        "Source configuration could not be loaded. Review an available source Issue.",
      );
      if ([401, 403].includes(failure.status)) onDenied();
    }
  }
  function reset(copyExisting) {
    if (draft.templateId)
      setConfirmation({
        action: () => applyReset(copyExisting),
        returnFocus: document.activeElement,
        discard: true,
      });
    else applyReset(copyExisting);
  }
  function applyReset(copyExisting) {
    pending.current?.abort();
    setError("");
    setDraft((d) => ({
      ...d,
      copyExisting,
      templateId: "",
      expectedSourceVersion: "",
      source: null,
      sourcePending: false,
      questions: d.templateId ? [] : d.questions,
      defaultPriority: d.templateId ? "" : d.defaultPriority,
      locationPolicy: d.templateId ? "" : d.locationPolicy,
      geographicEligibilityMode: d.templateId
        ? ""
        : d.geographicEligibilityMode,
    }));
  }
  return (
    <section className="issue-editor-section">
      <h3>
        Start From an Existing Issue <small>(Optional)</small>
      </h3>
      <fieldset disabled={disabled || draft.sourcePending}>
        <legend className="h6">
          Would you like to copy configuration from an existing Issue?
        </legend>
        <label className="d-block">
          <input
            type="radio"
            name="issue-copy"
            checked={!draft.copyExisting}
            onChange={() => reset(false)}
          />{" "}
          No, start with a new configuration
        </label>
        <label className="d-block">
          <input
            type="radio"
            name="issue-copy"
            checked={draft.copyExisting}
            onChange={() => setDraft((d) => ({ ...d, copyExisting: true }))}
          />{" "}
          Yes, copy an existing Issue
        </label>
      </fieldset>
      {draft.copyExisting && (
        <>
          <IssueCreationPicker
            client={client}
            endpoint={
              draft.category
                ? `/admin/issues/creation/sources?categoryId=${encodeURIComponent(draft.category.id)}`
                : null
            }
            label="Search existing Issues"
            selection={draft.source}
            disabled={disabled || draft.sourcePending}
            onSelect={select}
            onClear={() => reset(true)}
            onDenied={onDenied}
          />
          {draft.source && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={disabled || draft.sourcePending}
              onClick={() => select(draft.source)}
            >
              Refresh source configuration
            </button>
          )}
          {draft.source && (
            <p>
              Starting From <strong>{draft.source.name}</strong> ·{" "}
              {draft.source.category}. Configuration will be copied once. Future
              changes to the original Issue will not affect this Issue.
            </p>
          )}
          <p>
            Only eligible Reqro Intake Issues in the selected Category are
            available. Category, name, description, Availability, Handling,
            Requester Policy, assignment and order remain your new Issue
            choices.
          </p>
        </>
      )}
      {draft.sourcePending && (
        <p role="status">Loading source configuration…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {confirmation && (
        <Confirmation
          title={
            confirmation.discard
              ? "Discard Copied Configuration?"
              : "Replace Copied Configuration?"
          }
          cancelLabel="Keep Current Configuration"
          confirmLabel={
            confirmation.discard
              ? "Discard Configuration"
              : "Replace Configuration"
          }
          returnFocus={confirmation.returnFocus}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action;
            setConfirmation(null);
            action();
          }}
        >
          {confirmation.discard
            ? "Discard the copied settings and your changes?"
            : "Choosing another Issue will replace the copied settings and any changes you have made to them."}
        </Confirmation>
      )}
    </section>
  );
}
