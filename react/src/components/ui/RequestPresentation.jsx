import {
  safeIssueIcon,
  statusPresentation,
  normalizedStatus,
} from "./presentation.js";

export function StatusBadge({ value }) {
  const state = statusPresentation[normalizedStatus(value)];
  return (
    <span
      className={`request-status ui-status tone-${state?.tone || "created"}`}
    >
      <i
        className={`bi bi-${state?.icon || "question-circle"}`}
        aria-hidden="true"
      />
      {state?.label || "Unavailable"}
    </span>
  );
}
export function IssueIcon({ icon, size = "compact" }) {
  return (
    <span
      className={`ui-issue-icon ui-issue-icon--${["compact", "large"].includes(size) ? size : "compact"}`}
      aria-hidden="true"
    >
      <i className={`bi ${safeIssueIcon(icon)}`} />
    </span>
  );
}
export function LocationDisplay({ value }) {
  if (typeof value !== "string" || !value.trim()) return null;
  return (
    <p className="ui-location">
      <i className="bi bi-geo-alt-fill" aria-hidden="true" />
      {value}
    </p>
  );
}
export function ReferenceDisplay({ value }) {
  return (
    <span className="ui-reference">
      <span>Request #</span> <span className="ui-reference-value">{value}</span>
    </span>
  );
}
export function ContentCard({ children, className = "" }) {
  return <section className={`ui-card ${className}`}>{children}</section>;
}
export function SectionHeading({ children, icon }) {
  return (
    <h3 className="ui-section-heading">
      {icon && <i className={`bi bi-${icon}`} aria-hidden="true" />}
      {children}
    </h3>
  );
}
