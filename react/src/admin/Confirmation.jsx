import { useEffect, useRef } from "react";

export default function Confirmation({
  title,
  cancelLabel = "Cancel",
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
    node.querySelector("button")?.focus();
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
      aria-modal="true"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const buttons = [...dialog.current.querySelectorAll("button")].filter(
          (button) => !button.disabled,
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onCancel();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      <h2 id="issue-confirm-title">{title}</h2>
      <p id="issue-confirm-description">{children}</p>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        <button
          type="button"
          autoFocus
          className="btn btn-secondary"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
