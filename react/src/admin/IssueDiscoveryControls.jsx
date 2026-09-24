import { useState } from "react";
export default function IssueDiscoveryControls({
  query,
  search,
  setSearch,
  update,
  clear,
  categories,
  categoryError,
  retryCategories,
  disabled,
}) {
  const [expanded, setExpanded] = useState(false);
  const selects = [
    [
      "status",
      "Status",
      [
        ["all", "All statuses"],
        ["active", "Active"],
        ["inactive", "Inactive"],
      ],
    ],
    [
      "category",
      "Category",
      [["", "All Categories"], ...categories.map((c) => [c.id, c.name])],
    ],
    [
      "requesterPolicy",
      "Requester policy",
      [
        ["all", "All policies"],
        ["IDENTIFIED_REQUIRED", "Identification required"],
        ["ANONYMOUS_ALLOWED", "Anonymous allowed"],
      ],
    ],
    [
      "assignmentState",
      "Assignment",
      [
        ["all", "All assignments"],
        ["assigned", "Assigned"],
        ["none", "None"],
      ],
    ],
    [
      "sort",
      "Sort by",
      [
        ["default", "Configured order"],
        ["name", "Name"],
        ["category", "Category"],
        ["order", "Display order"],
        ["status", "Status"],
        ["policy", "Requester policy"],
        ["assignment", "Assignment name"],
      ],
    ],
    [
      "direction",
      "Direction",
      [
        ["asc", "Ascending"],
        ["desc", "Descending"],
      ],
    ],
    [
      "pageSize",
      "Issues per page",
      [25, 50, 100, 250, 500].map((n) => [String(n), String(n)]),
    ],
  ];
  return (
    <fieldset disabled={disabled} className="issue-discovery-controls">
      <legend className="visually-hidden">Find Issues</legend>
      <div className="issue-search">
        <label htmlFor="issue-search">Search Issues</label>
        <input
          id="issue-search"
          type="search"
          className="form-control"
          value={search}
          maxLength={100}
          placeholder="Issue or Category name"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn-outline-primary issue-filter-toggle"
        aria-controls="issue-filter-grid"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded
          ? "Hide filters, sort & page size"
          : "Filters, sort & page size"}
      </button>
      <div
        id="issue-filter-grid"
        className={`issue-filter-grid ${expanded ? "is-expanded" : ""}`}
      >
        {selects.map(([key, label, options]) => (
          <div key={key}>
            <label htmlFor={`issue-filter-${key}`}>{label}</label>
            <select
              id={`issue-filter-${key}`}
              className="form-select"
              value={query[key]}
              onChange={(e) => update({ [key]: e.target.value, page: "1" })}
            >
              {key === "category" &&
                query.category &&
                !categories.some((c) => c.id === query.category) && (
                  <option value={query.category}>
                    Selected Category unavailable
                  </option>
                )}
              {options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-link" onClick={clear}>
        Clear filters
      </button>
      {categoryError && (
        <p role="alert">
          Categories could not be loaded.{" "}
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={retryCategories}
          >
            Retry Categories
          </button>
        </p>
      )}
    </fieldset>
  );
}
