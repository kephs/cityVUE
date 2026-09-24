import { useEffect, useRef, useState } from "react";

function DisableConfirmation({ onCancel, onConfirm, busy, returnFocus }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="configuration-dialog"
      aria-labelledby="disable-collection-title"
      aria-describedby="disable-collection-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="disable-collection-title">Turn off Service Participation?</h2>
      <p id="disable-collection-description">
        Requesters will no longer be asked to choose a Participation Area.
        Existing responses and historical analytics will be kept.
      </p>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={onCancel}
          autoFocus
        >
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Saving…" : "Turn off"}
        </button>
      </div>
    </dialog>
  );
}

export default function IntakeCollectionEditor({
  client,
  collection,
  activeAreas,
  canWrite,
  onSaved,
  onRefresh,
  onDenied,
  onDirtyChange,
  onBusyChange,
  notice,
}) {
  const [enabled, setEnabled] = useState(collection.enabled);
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null),
    [denied, setDenied] = useState(false);
  const switchControl = useRef(null),
    feedback = useRef(null);
  const saveButton = useRef(null),
    inFlight = useRef(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);
  const dirty = enabled !== collection.enabled;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    setEnabled(collection.enabled);
  }, [collection.enabled, collection.revision]);
  useEffect(() => {
    if (notice) switchControl.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  const cannotEnable = enabled && !collection.enabled && activeAreas === 0;
  async function save() {
    if (inFlight.current || !dirty || denied || !canWrite) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await client.patch(
        "/admin/intake-settings/service-participation",
        { enabled, expectedRevision: collection.revision },
        { authenticated: true, signal: controller.signal },
      );
      if (!mounted.current || controller.signal.aborted) return;
      setConfirm(false);
      onSaved(result);
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      setConfirm(false);
      if ([401, 403].includes(failure.status)) {
        setDenied(true);
        setEnabled(collection.enabled);
        onDenied?.(failure.status);
      }
      setError(
        failure.status === 409
          ? "conflict"
          : failure.status === 403
            ? "denied"
            : failure.status === 401
              ? "session"
              : failure.status === 400
                ? "areas"
                : "failure",
      );
    } finally {
      inFlight.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      className="participation-section collection-section"
      aria-labelledby="collection-editor-title"
      id="service-participation"
    >
      <div className="participation-section-heading">
        <div>
          <h2 id="collection-editor-title">Service Participation</h2>
          <p>Ask requesters for an optional Participation Area.</p>
        </div>
        {canWrite && !denied ? (
          <label className="participation-switch" htmlFor="collection-choice">
            <input
              ref={switchControl}
              id="collection-choice"
              className="form-check-input"
              type="checkbox"
              role="switch"
              aria-label="Service Participation collection"
              checked={enabled}
              disabled={busy || error === "conflict" || error === "failure"}
              aria-describedby="collection-edit-help collection-edit-feedback"
              onChange={(event) => {
                setEnabled(event.target.checked);
                setError(null);
              }}
            />
            <span>{enabled ? "On" : "Off"}</span>
          </label>
        ) : (
          <strong
            className="participation-state"
            aria-label={`Service Participation: ${collection.enabled ? "On" : "Off"}`}
          >
            {collection.enabled ? "On" : "Off"}
          </strong>
        )}
      </div>
      <p className="participation-context">
        {collection.enabled
          ? "Participation Areas are available on new requests. Turning this off hides them; existing information is kept."
          : "Participation Areas are hidden from new requests. Existing information is kept."}
      </p>
      {canWrite && !denied && (
        <>
          <p
            id="collection-edit-help"
            className="participation-dirty"
            role={dirty ? "status" : undefined}
          >
            {dirty
              ? `Unsaved change. Currently ${collection.enabled ? "On" : "Off"}.`
              : ""}
          </p>
          {activeAreas === 0 && !collection.enabled && (
            <p>
              Add or reactivate at least one Participation Area before turning
              this on.
            </p>
          )}
          <div className="d-flex flex-wrap gap-2">
            <button
              ref={saveButton}
              className="btn btn-primary"
              disabled={
                !dirty ||
                busy ||
                cannotEnable ||
                error === "conflict" ||
                error === "failure"
              }
              onClick={() => (enabled ? save() : setConfirm(true))}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            {dirty && (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  setEnabled(collection.enabled);
                  if (error !== "conflict" && error !== "failure")
                    setError(null);
                  switchControl.current?.focus();
                }}
              >
                Cancel change
              </button>
            )}
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="participation-notice">
          {notice}
        </p>
      )}
      <div id="collection-edit-feedback" ref={feedback} tabIndex="-1">
        {error && (
          <p role="alert">
            {error === "conflict"
              ? "Configuration changed since you opened this page. Refresh the latest setting before making another change."
              : error === "denied"
                ? "You are not authorized to change this setting."
                : error === "session"
                  ? "Your staff session has expired. Please sign in again."
                  : error === "areas"
                    ? "Add or reactivate at least one Participation Area before turning this on."
                    : "The setting could not be saved. Refresh to check its current state before retrying."}
          </p>
        )}
        {error && (
          <button
            className="btn btn-outline-primary"
            onClick={onRefresh}
            disabled={busy}
          >
            Refresh latest setting
          </button>
        )}
      </div>
      {confirm && (
        <DisableConfirmation
          busy={busy}
          returnFocus={saveButton}
          onCancel={() => setConfirm(false)}
          onConfirm={save}
        />
      )}
    </section>
  );
}
