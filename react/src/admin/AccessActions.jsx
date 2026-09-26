import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export default function AccessActions({ staff, open, setOpen, onAction }) {
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
    menu.current.querySelector("button")?.focus({ preventScroll: true });
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
    onAction(staff, kind, { currentTarget: trigger.current });
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-outline-secondary issue-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Manage Access for ${staff.displayName}`}
        onClick={() => setOpen(open ? null : staff.id)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(staff.id);
          }
        }}
      >
        Manage Access <span aria-hidden="true">⋮</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={`Manage Access for ${staff.displayName}`}
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
                trigger.current.focus({ preventScroll: true });
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
                buttons[next].focus({ preventScroll: true });
              } else if (event.key === "Tab") {
                setOpen(null);
                trigger.current.focus({ preventScroll: true });
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => choose("view")}
            >
              View Access
            </button>
            {staff.canConfigure && (
              <button
                type="button"
                role="menuitem"
                onClick={() => choose("configure")}
              >
                Configure Access
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
