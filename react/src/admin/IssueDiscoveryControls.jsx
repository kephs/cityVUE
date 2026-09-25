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
      "availability",
      "Availability",
      [
        ["all", "All availability"],
        ["INTERNAL_ONLY", "Internal only"],
        ["EXTERNAL_ONLY", "External only"],
        ["INTERNAL_AND_EXTERNAL", "Internal and external"],
      ],
    ],
    [
      "handling",
      "Handling",
      [
        ["all", "All handling"],
        ["internal_intake", "Reqro Intake"],
        ["external_redirect", "External Redirect"],
      ],
    ],
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
      "Requester Policy",
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
      "Sort By",
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
  ];
  return (
    <>
      <fieldset disabled={disabled} className="issue-discovery-controls">
        <legend className="visually-hidden">Find Issues</legend>
        <button
          type="button"
          className="btn btn-outline-primary issue-filter-toggle"
          aria-controls="issue-filter-grid"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide Filters" : "Filters"}
        </button>
        <div
          id="issue-filter-grid"
          className={`issue-filter-grid ${expanded ? "is-expanded" : ""}`}
        >
          {selects.map(([key, label, options], index) => (
            <div
              key={key}
              className={
                index < 4 ? "issue-filter-first-row" : "issue-filter-second-row"
              }
            >
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
          <button
            type="button"
            className="btn btn-link issue-clear-filters"
            onClick={clear}
          >
            Clear Filters
          </button>
        </div>
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
      <fieldset disabled={disabled} className="issue-workspace-search">
        <legend className="visually-hidden">Search Issues</legend>{" "}
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
          <button
            type="button"
            className="btn btn-link"
            disabled={!search}
            onClick={() => setSearch("")}
          >
            Clear Search
          </button>
          <p>Results update as you type.</p>
        </div>
      </fieldset>
    </>
  );
}
