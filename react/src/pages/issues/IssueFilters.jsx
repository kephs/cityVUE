import { ISSUE_FILTER_OPTIONS } from "../../../../assets/js/utils/issueFilters.js";

const sortOptions = [
    ["newest", "Newest"],
    ["oldest", "Oldest"],
    ["titleAsc", "Title A–Z"],
    ["titleDesc", "Title Z–A"],
    ["priority", "Priority"]
];

function FilterSelect({ id, label, icon, value, options, allLabel, onChange }) {
    return (
        <div className="col-sm-6 col-lg-2">
            <label className="form-label" htmlFor={id}><i className={`bi ${icon}`} aria-hidden="true" />{label}</label>
            <select className="form-select" id={id} value={value} onChange={onChange}>
                <option value="">{allLabel}</option>
                {options.map((option) => <option value={option} key={option}>{option}</option>)}
            </select>
        </div>
    );
}

export default function IssueFilters({ filters, sortBy, hasActiveFilters, onFilterChange, onSortChange, onReset }) {
    return (
        <section className="card border-0 shadow-sm mb-4 issue-filter-card" aria-labelledby="issue-filters-heading">
            <div className="card-body p-3 p-md-4">
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <h2 className="h5 mb-0" id="issue-filters-heading"><i className="bi bi-funnel me-2" aria-hidden="true" />Search and filter</h2>
                    <button className="btn btn-sm btn-outline-secondary" type="button" onClick={onReset} disabled={!hasActiveFilters}>
                        Clear search and filters
                    </button>
                </div>
                <div className="row g-3">
                    <div className="col-lg-4">
                        <label className="form-label" htmlFor="issue-search"><i className="bi bi-search" aria-hidden="true" />Search</label>
                        <div className="input-group">
                            <span className="input-group-text" aria-hidden="true"><i className="bi bi-search"></i></span>
                            <input
                                className="form-control"
                                id="issue-search"
                                type="search"
                                autoComplete="off"
                                placeholder="Search issues..."
                                value={filters.search}
                                onChange={(event) => onFilterChange("search", event.target.value)}
                            />
                        </div>
                    </div>
                    <FilterSelect id="category-filter" label="Category" icon="bi-grid" value={filters.category} options={ISSUE_FILTER_OPTIONS.category} allLabel="All Categories" onChange={(event) => onFilterChange("category", event.target.value)} />
                    <FilterSelect id="priority-filter" label="Priority" icon="bi-flag" value={filters.priority} options={ISSUE_FILTER_OPTIONS.priority} allLabel="All Priorities" onChange={(event) => onFilterChange("priority", event.target.value)} />
                    <FilterSelect id="status-filter" label="Status" icon="bi-circle-half" value={filters.status} options={ISSUE_FILTER_OPTIONS.status} allLabel="All Statuses" onChange={(event) => onFilterChange("status", event.target.value)} />
                    <div className="col-sm-6 col-lg-2">
                        <label className="form-label" htmlFor="issue-sort"><i className="bi bi-sort-down" aria-hidden="true" />Sort By</label>
                        <select className="form-select" id="issue-sort" value={sortBy} onChange={(event) => onSortChange(event.target.value)}>
                            {sortOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </div>
                </div>
            </div>
        </section>
    );
}
