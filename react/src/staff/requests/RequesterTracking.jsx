import { useEffect, useRef, useState } from "react";
import RequestDialog from "./RequestDialog.jsx";
import "../../tracking/tracking.css";

const labels = {
  not_issued: "Not issued",
  active: "Active",
  revoked: "Revoked",
};
export default function RequesterTracking({
  repository,
  id,
  allowed,
  onAccessFailure,
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  if (!allowed)
    return (
      <div className="request-management-row">
        <div>
          <h4>Requester Tracking</h4>
          <p>Protected</p>
        </div>
      </div>
    );
  return (
    <div className="request-management-row">
      <div>
        <h4>Requester Tracking</h4>
        <p>{labels[summary] || "Manage requester access"}</p>
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen(true)}
        aria-label="Manage requester tracking"
      >
        Manage
      </button>
      {open && (
        <TrackingDialog
          key={id}
          repository={repository}
          id={id}
          onClose={() => setOpen(false)}
          onState={setSummary}
          onAccessFailure={onAccessFailure}
        />
      )}
    </div>
  );
}
function TrackingDialog({ repository, id, onClose, onState, onAccessFailure }) {
  const [state, setState] = useState(null),
    [link, setLink] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const [confirm, setConfirm] = useState(null);
  const flight = useRef(false),
    alive = useRef(false),
    abort = useRef(null);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    abort.current = controller;
    repository
      .trackingState(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setState(value);
          onState(value.status);
        }
      })
      .catch((problem) => {
        if (!controller.signal.aborted) {
          setError(
            "Tracking management is unavailable. Close and reopen to try again.",
          );
          onAccessFailure?.(problem);
        }
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [repository, id, onState, onAccessFailure]);
  const change = async (operation) => {
    if (flight.current || !state) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setFeedback("");
    setLink("");
    try {
      const value = await repository.changeTracking(
        id,
        operation,
        state.version,
        abort.current.signal,
      );
      if (!alive.current) return;
      setState({ status: value.status, version: value.version });
      onState(value.status);
      setConfirm(null);
      if (value.credential)
        setLink(`${window.location.origin}/track#${value.credential}`);
      setFeedback(
        operation === "revoke"
          ? "Tracking link revoked."
          : "Tracking link created.",
      );
    } catch (problem) {
      if (alive.current) {
        setError(
          "Tracking management could not be completed. Close and reopen to check the current state before retrying.",
        );
        setState(null);
        onAccessFailure?.(problem);
      }
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      if (alive.current) setFeedback("Tracking link copied.");
    } catch {
      if (alive.current)
        setFeedback("Copy is unavailable. Select and copy the link manually.");
    }
  };
  return (
    <RequestDialog title="Requester Tracking" onClose={onClose} busy={busy}>
      {error && <p role="alert">{error}</p>}
      {!state && !error && <p role="status">Loading tracking management…</p>}
      <p role="status">{busy ? "Updating tracking…" : feedback}</p>
      {link && (
        <section>
          <p>
            This tracking link provides access to requester-safe request
            information. Share it only with the requester.
          </p>
          <p>
            Copy this link now. Reqro does not retain the raw tracking
            credential.
          </p>
          <label htmlFor="new-tracking-link">New tracking link</label>
          <textarea
            id="new-tracking-link"
            className="form-control tracking-link"
            readOnly
            value={link}
          />
          <button type="button" className="btn btn-secondary" onClick={copy}>
            Copy tracking link
          </button>
        </section>
      )}
      {state && (
        <>
          <p>{labels[state.status]}</p>
          {confirm ? (
            <section>
              <p>
                {confirm === "rotate"
                  ? "Creating a new tracking link will invalidate the current link."
                  : "The requester will no longer be able to use the current tracking link."}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => change(confirm)}
              >
                Confirm {confirm === "rotate" ? "rotation" : "revocation"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </section>
          ) : state.status === "active" ? (
            <div className="d-flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirm("rotate")}
              >
                Rotate tracking link
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirm("revoke")}
              >
                Revoke tracking link
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => change("issue")}
            >
              {state.status === "revoked"
                ? "Create new tracking link"
                : "Create tracking link"}
            </button>
          )}
        </>
      )}
    </RequestDialog>
  );
}
