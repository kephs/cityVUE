import {
  safeIssueIcon,
  statusPresentation,
  normalizedStatus,
} from "./presentation.js";
import { categoryAccent } from "./categoryAccent.js";
import "./categoryAccent.css";

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
export function AudienceBadge({ value, compact = false }) {
  if (!["public", "internal"].includes(value)) return null;
  return (
    <span className={`ui-audience ui-audience--${value}`}>
      {value === "public"
        ? compact
          ? "Public"
          : "Public request"
        : compact
          ? "Internal"
          : "Internal request"}
    </span>
  );
}
export function IssueIcon({ icon, size = "compact", categoryId }) {
  return (
    <span
      className={`ui-issue-icon ui-issue-icon--${["compact", "large"].includes(size) ? size : "compact"}${categoryId ? ` category-accent-${categoryAccent(categoryId)}` : ""}`}
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
export function ReferenceDisplay({ value, compact = false }) {
  return (
    <span className="ui-reference">
      <span className={compact ? "visually-hidden" : undefined}>
        {compact ? "Reference" : "Request #"}
      </span>{" "}
      <span className="ui-reference-value">{value}</span>
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
