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
      <h2 id="disable-collection-title">
        Disable Service Participation collection?
      </h2>
      <p id="disable-collection-description">
        Requesters will no longer be asked for participation-area information.
        Existing responses and historical analytics will be preserved.
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
          {busy ? "Saving…" : "Disable collection"}
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
}) {
  const [enabled, setEnabled] = useState(collection.enabled);
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null),
    [denied, setDenied] = useState(false);
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
    <section aria-labelledby="collection-editor-title">
      <h2 id="collection-editor-title" className="h4">
        Service Participation
      </h2>
      <p>
        Collect optional self-reported service-participation area information
        from requesters.
      </p>
      <p>
        Current collection:{" "}
        <strong>{collection.enabled ? "Enabled" : "Disabled"}</strong>
      </p>
      <p>
        Disabling collection stops asking for this information on new requests.
        Existing responses and historical analytics are preserved. Analytics
        access is managed separately.
      </p>
      {canWrite && !denied && (
        <>
          <label htmlFor="collection-choice" className="form-label">
            Service Participation collection
          </label>
          <select
            id="collection-choice"
            className="form-select configuration-choice"
            value={String(enabled)}
            disabled={busy || error === "conflict"}
            aria-describedby="collection-edit-help collection-edit-feedback"
            onChange={(event) => {
              setEnabled(event.target.value === "true");
              setError(null);
            }}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
          <p id="collection-edit-help">
            {dirty
              ? "Unsaved change. Refresh configuration discards this edit."
              : "Choose a value, then save changes."}
          </p>
          {activeAreas === 0 && !collection.enabled && (
            <p>
              At least one active Participation Area is required before
              collection can be enabled. Participation Area management is not
              available in this version.
            </p>
          )}
          <div className="d-flex flex-wrap gap-2 mb-3">
            <button
              ref={saveButton}
              className="btn btn-primary"
              disabled={!dirty || busy || cannotEnable || error === "conflict"}
              onClick={() => (enabled ? save() : setConfirm(true))}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              className="btn btn-secondary"
              disabled={!dirty || busy}
              onClick={() => {
                setEnabled(collection.enabled);
                setError(null);
              }}
            >
              Cancel change
            </button>
          </div>
        </>
      )}
      {(!canWrite || denied) && (
        <p>Editing requires Intake Settings write permission.</p>
      )}
      <div id="collection-edit-feedback">
        {error && (
          <p role="alert">
            {error === "conflict"
              ? "Configuration changed since you opened this page. Refresh the latest setting before making another change."
              : error === "denied"
                ? "You are not authorized to change this setting."
                : error === "session"
                  ? "Your staff session has expired. Please sign in again."
                  : error === "areas"
                    ? "Service Participation cannot be enabled because no active Participation Areas are configured. Participation Area management is not available in this version."
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
