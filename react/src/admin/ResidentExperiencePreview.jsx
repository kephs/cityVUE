import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { HomePresentationProvider } from "../pages/home/HomePresentationContext.jsx";
import { HomeHeader, HomeFooter } from "../pages/home/HomeShell.jsx";
import HomePage from "../pages/HomePage.jsx";
import ThemeToggle from "../components/theme/ThemeToggle.jsx";

export default function ResidentExperiencePreview({ presentation, onClose }) {
  // Reuse the renderer without putting protected draft text in browser titles.
  const previewPresentation = useMemo(
    () => ({
      ...presentation,
      title: "Unpublished preview | Reqro Administration",
      description: "Protected saved resident experience preview.",
    }),
    [presentation],
  );
  const close = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const intercept = (event) => {
    if (event.target.closest("a,button,form")) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return createPortal(
    <section
      className="resident-preview"
      role="dialog"
      aria-modal="true"
      aria-label="Unpublished Preview"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "Tab") {
          const nodes = [
            ...event.currentTarget.querySelectorAll(
              'button,a,input,[tabindex="0"]',
            ),
          ].filter((n) => !n.disabled && n.getClientRects().length);
          const first = nodes[0],
            last = nodes.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="resident-preview-toolbar">
        <strong>Unpublished Preview</strong>
        <span>Saved draft only. Resident actions are disabled.</span>
        <ThemeToggle />
        <button ref={close} className="btn btn-secondary" onClick={onClose}>
          Close preview
        </button>
      </div>
      <div
        onClickCapture={intercept}
        onAuxClickCapture={intercept}
        onContextMenuCapture={intercept}
        onDragStartCapture={intercept}
        onSubmitCapture={intercept}
        onKeyDownCapture={(event) => {
          if (["Enter", " "].includes(event.key)) intercept(event);
        }}
      >
        <HomePresentationProvider value={previewPresentation}>
          <HomeHeader />
          <main className="reqro-home-main">
            <HomePage />
          </main>
          <HomeFooter />
        </HomePresentationProvider>
      </div>
    </section>,
    document.body,
  );
}
