import { useEffect, useId, useRef } from "react";

// Native modality supplies focus containment and makes the background inert.
export default function RequestDialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  returnFocusRef,
}) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const trigger = returnFocusRef?.current || document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`request-dialog${wide ? " request-dialog-wide" : ""}`}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter(
          (element) =>
            !element.closest("[hidden]") && element.getClientRects().length,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="request-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}
