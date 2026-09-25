import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IssueIcon } from "../components/ui/RequestPresentation.jsx";
import { availabilityLabels } from "./IssueHandling.jsx";

function Actions({ issue, canWrite, open, setOpen, disabled, onAction }) {
  const trigger = useRef(null),
    menu = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const bounds = trigger.current.getBoundingClientRect();
    const { height, width } = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(bounds.right - width, window.innerWidth - width - 8),
      ),
      top: Math.max(
        8,
        Math.min(bounds.bottom + 4, window.innerHeight - height - 8),
      ),
    });
    menu.current.querySelector("button")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(null);
    };
    const dismiss = () => setOpen(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, setOpen]);
  const choose = (kind) => {
    setOpen(null);
    onAction(issue, kind, { currentTarget: trigger.current });
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-outline-secondary issue-actions-trigger"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${issue.name}`}
        onClick={() => setOpen(open ? null : issue.id)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(issue.id);
          }
        }}
      >
        Actions <span aria-hidden="true">⋮</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={`Actions for ${issue.name}`}
            className="issue-actions-menu"
            style={position}
            onKeyDown={(event) => {
              const buttons = [
                ...menu.current.querySelectorAll('[role="menuitem"]'),
              ];
              const index = buttons.indexOf(document.activeElement);
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(null);
                trigger.current.focus();
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length;
                buttons[next].focus();
              } else if (event.key === "Tab") {
                setOpen(null);
                trigger.current.focus();
              }
            }}
          >
            <button
              role="menuitem"
              onClick={() => choose(canWrite ? "edit" : "view")}
            >
              {canWrite ? "Configure" : "View Configuration"}
            </button>
            {canWrite && (
              <>
                <button role="menuitem" onClick={() => choose("order")}>
                  Change Order
                </button>
                <button
                  role="menuitem"
                  className="issue-lifecycle-action"
                  onClick={() => choose("state")}
                >
                  {issue.active ? "Deactivate" : "Activate"}
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export default function IssueResults({
  data,
  loading,
  disabled,
  onAction,
  rows,
}) {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (disabled || loading) setOpen(null);
  }, [disabled, loading]);
  return (
    <table className="issue-workspace-table" aria-busy={loading}>
      <caption className="visually-hidden">
        Issue configuration summaries
      </caption>
      <thead>
        <tr>
          {[
            "Issue",
            "Category",
            "Availability",
            "Handling",
            "Status",
            "Actions",
          ].map((label) => (
            <th key={label} scope="col">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {!loading &&
          data.items.map((issue) => (
            <tr
              key={issue.id}
              aria-label={issue.name}
              ref={(node) => {
                if (node) rows.current.set(issue.id, node);
                else rows.current.delete(issue.id);
              }}
              tabIndex={-1}
            >
              <td>
                <div className="issue-table-identity">
                  <IssueIcon categoryId={issue.categoryId} />
                  <button
                    className="btn btn-link issue-name-action"
                    disabled={disabled}
                    aria-label={`${data.canWrite ? "Configure" : "View Configuration for"} ${issue.name}`}
                    onClick={(event) =>
                      onAction(issue, data.canWrite ? "edit" : "view", event)
                    }
                  >
                    {issue.name}
                  </button>
                </div>
              </td>
              <td>
                <span className="issue-mobile-label">Category</span>
                {issue.category}
              </td>
              <td>
                <span className="issue-mobile-label">Availability</span>
                {availabilityLabels[issue.availability] || "Unavailable"}
              </td>
              <td>
                <span className="issue-mobile-label">Handling</span>
                {issue.actionType === "external_redirect"
                  ? "External Redirect"
                  : "Reqro Intake"}
              </td>
              <td>
                <span className="issue-mobile-label">Status</span>
                <span
                  className={`participation-state ${issue.active ? "is-active" : ""}`}
                >
                  {issue.active ? "Active" : "Inactive"}
                </span>
              </td>
              <td>
                <Actions
                  issue={issue}
                  canWrite={data.canWrite}
                  open={open === issue.id}
                  setOpen={setOpen}
                  disabled={disabled}
                  onAction={onAction}
                />
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
