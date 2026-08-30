import { useEffect, useRef } from "react";

export default function DeleteIssueDialog({ issue, error, deleting, onCancel, onConfirm, returnFocusRef }) {
    const cancelRef = useRef(null);

    useEffect(() => {
        if (!issue) return undefined;
        cancelRef.current?.focus();
        const closeOnEscape = (event) => {
            if (event.key === "Escape" && !deleting) onCancel();
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [issue, deleting, onCancel]);

    useEffect(() => {
        if (!issue) returnFocusRef.current?.focus();
    }, [issue, returnFocusRef]);

    if (!issue) return null;

    return (
        <div className="delete-dialog-backdrop" role="presentation">
            <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
                <span className="delete-dialog-icon" aria-hidden="true"><i className="bi bi-exclamation-triangle" /></span>
                <h2 className="h4" id="delete-dialog-title">Delete issue?</h2>
                <p id="delete-dialog-description">You are about to delete <strong>{issue.title || "this issue"}</strong>. This action cannot be undone.</p>
                {error && <div className="alert alert-danger" role="alert">{error}</div>}
                <div className="delete-dialog-actions">
                    <button className="btn btn-outline-secondary" type="button" ref={cancelRef} onClick={onCancel} disabled={deleting}>Cancel</button>
                    <button className="btn btn-danger" type="button" onClick={onConfirm} disabled={deleting}><i className="bi bi-trash me-2" aria-hidden="true" />{deleting ? "Deleting…" : "Delete Issue"}</button>
                </div>
            </section>
        </div>
    );
}
