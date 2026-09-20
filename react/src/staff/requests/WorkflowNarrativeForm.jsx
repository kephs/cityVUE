import { useEffect, useRef, useState } from "react";
const labels = {
  hold: "Place On Hold",
  close: "Close Request",
  reopen: "Reopen Request",
};
export default function WorkflowNarrativeForm({
  action,
  busy,
  error,
  onCancel,
  onSubmit,
}) {
  const [text, setText] = useState(""),
    [validation, setValidation] = useState("");
  const input = useRef(null);
  const maximum = action === "close" ? 2000 : 500;
  useEffect(() => {
    input.current?.focus();
  }, []);
  const label =
    action === "close"
      ? "Resolution"
      : action === "hold"
        ? "Hold reason"
        : "Reopen reason";
  return (
    <form
      className="workflow-narrative-form"
      aria-label={labels[action]}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !text.trim() ||
          text.length > maximum ||
          /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(
            text,
          )
        ) {
          setValidation(
            "Enter meaningful text within the limit, without control characters.",
          );
          input.current?.focus();
          return;
        }
        setValidation("");
        onSubmit({
          action,
          ...(action === "close"
            ? { resolutionSummary: text }
            : { reason: text }),
        });
      }}
    >
      <h4>{labels[action]}</h4>
      <label htmlFor="workflow-narrative">{label} (required)</label>
      <p id="workflow-narrative-help">
        Plain text, up to {maximum} characters. Saved in request activity.
      </p>
      <textarea
        ref={input}
        id="workflow-narrative"
        className="form-control"
        rows="4"
        required
        maxLength={maximum}
        disabled={busy}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={Boolean(validation || error)}
        aria-describedby="workflow-narrative-help workflow-narrative-error"
      />
      <p id="workflow-narrative-error" role="alert">
        {validation || error}
      </p>
      <div className="request-action-buttons">
        <button
          className="btn btn-secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : labels[action]}
        </button>
      </div>
    </form>
  );
}
