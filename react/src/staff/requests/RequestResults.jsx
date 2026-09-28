import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudienceBadge,
  IssueIcon,
  LocationDisplay,
  ReferenceDisplay,
  StatusBadge,
} from "../../components/ui/RequestPresentation.jsx";
import { TargetLabel } from "./RequestOwnership.jsx";

/** The nine-column desktop table only fits comfortably at 1200px and wider. */
const listCardQuery = "(max-width: 1199.98px)";
const reported = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Unavailable"
    : parsed.toLocaleString();
};
function RequestTitle({ row, query, heading = false, reference = false }) {
  const Title = heading ? "h3" : "div";
  return (
    <>
      <Title className="request-result-title">
        <IssueIcon icon={row.issueIcon} categoryId={row.categoryId} />
        <Link
          to={`/staff/requests/${encodeURIComponent(row.serviceRequestId)}?${query}`}
        >
          {row.issueName}
        </Link>
      </Title>
      {reference && <ReferenceDisplay value={row.referenceNumber} compact />}
      {row.serviceLocation && <LocationDisplay value={row.serviceLocation} />}
    </>
  );
}
/** Presentation-only position. It is never a Service Request identifier. */
const position = (page, pageSize, rowIndex) =>
  (page - 1) * pageSize + rowIndex + 1;
function Routing({ row }) {
  return (
    <>
      {row.departmentName}
      {row.divisionName && (
        <span className="request-subline">{row.divisionName}</span>
      )}
    </>
  );
}
function Manage({ row, query }) {
  return (
    <Link
      className="btn btn-secondary request-manage-link"
      to={`/staff/requests/${encodeURIComponent(row.serviceRequestId)}?${query}`}
      aria-label={`Manage Request: ${row.issueName} ${row.referenceNumber}`}
    >
      Manage Request
    </Link>
  );
}
/** Responsive presentation only: both layouts consume the same bounded list. */
export default function RequestResults({
  items,
  page,
  pageSize,
  query,
  sort,
  direction,
  sortLabels,
  onSort,
}) {
  const [compact, setCompact] = useState(
    () => window.matchMedia?.(listCardQuery).matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.(listCardQuery);
    if (!media) return;
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (compact)
    return (
      <ul className="request-result-cards" aria-label="Service Request results">
        {items.map((row, rowIndex) => (
          <li key={row.serviceRequestId}>
            <article className="ui-card request-result-card">
              <p className="request-row-number request-card-position">
                <span className="visually-hidden">Result</span>
                {position(page, pageSize, rowIndex)}
              </p>
              <RequestTitle row={row} query={query} heading reference />
              <div className="request-result-badges">
                <AudienceBadge value={row.audience} compact />
                <StatusBadge value={row.status} />
              </div>
              <dl>
                <div>
                  <dt>Department / Division</dt>
                  <dd>
                    <Routing row={row} />
                  </dd>
                </div>
                <div>
                  <dt>Assigned to</dt>
                  <dd>
                    <TargetLabel target={row.assignment} />
                  </dd>
                </div>
                <div>
                  <dt>Reported</dt>
                  <dd>
                    <time dateTime={row.createdAt}>
                      {reported(row.createdAt)}
                    </time>
                  </dd>
                </div>
              </dl>
              <Manage row={row} query={query} />
            </article>
          </li>
        ))}
      </ul>
    );
  const heading = (key, label = sortLabels[key]) => (
    <th
      scope="col"
      aria-sort={
        sort === key
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="request-sort-button"
        onClick={() => onSort(key)}
        aria-label={`Sort by ${sortLabels[key]}; ${sort === key ? (direction === "asc" ? "ascending" : "descending") : "not currently sorted"}`}
      >
        {label}{" "}
        <span aria-hidden="true">
          {sort === key ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
  return (
    <table className="staff-request-table request-results-table">
      <caption className="visually-hidden">
        Service Requests available to you. Sorted by {sortLabels[sort]},{" "}
        {direction === "asc" ? "ascending" : "descending"}.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="request-row-number">
            #
          </th>
          {heading("issue", "Issue")}
          <th scope="col">Request #</th>
          <th scope="col">Audience</th>
          {heading("status")}
          {heading("department")}
          {heading("assignment")}
          {heading("created")}
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row, rowIndex) => (
          <tr key={row.serviceRequestId}>
            <td className="request-row-number">
              {position(page, pageSize, rowIndex)}
            </td>
            <th scope="row">
              <RequestTitle row={row} query={query} />
            </th>
            <td className="request-reference-cell">
              <ReferenceDisplay value={row.referenceNumber} labelled={false} />
            </td>
            <td>
              <AudienceBadge value={row.audience} compact />
            </td>
            <td>
              <StatusBadge value={row.status} />
            </td>
            <td>
              <Routing row={row} />
            </td>
            <td>
              <TargetLabel target={row.assignment} />
            </td>
            <td>
              <time dateTime={row.createdAt}>{reported(row.createdAt)}</time>
            </td>
            <td>
              <Manage row={row} query={query} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
