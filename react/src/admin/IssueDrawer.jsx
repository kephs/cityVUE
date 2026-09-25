import { useEffect, useRef } from "react";

// Native modality keeps the background inert and handles keyboard containment.
export default function IssueDrawer({
  title,
  subtitle,
  compact,
  onClose,
  children,
}) {
  const dialog = useRef(null);
  const heading = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    heading.current?.focus();
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`issue-drawer${compact ? " issue-drawer--compact" : ""}`}
      aria-labelledby="issue-drawer-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...dialog.current.querySelectorAll(
            "button, a[href], input, select, textarea, [tabindex]",
          ),
        ].filter(
          (node) =>
            node.tabIndex >= 0 &&
            !node.matches(":disabled") &&
            node.getClientRects().length,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="issue-drawer-header">
        <div>
          <h2 id="issue-drawer-title" ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onClose}
          aria-label="Close configuration"
        >
          Close
        </button>
      </header>
      <div className="issue-drawer-body">{children}</div>
    </dialog>
  );
}
