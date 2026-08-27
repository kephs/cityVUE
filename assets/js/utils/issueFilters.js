const SEARCH_FIELDS = [
    "title",
    "description",
    "category",
    "reportedBy",
    "location"
];

export const ISSUE_FILTER_OPTIONS = {
    category: [
        "Road",
        "Lighting",
        "Water",
        "Garbage",
        "Parks",
        "Other"
    ],
    priority: [
        "High",
        "Medium",
        "Low"
    ],
    status: [
        "Open",
        "In Progress",
        "Closed"
    ]
};

export function issueMatchesSearch(issue, search = "") {
    const normalizedSearch = search.trim().toLowerCase();

    return SEARCH_FIELDS.some(field =>
        (issue[field] || "")
            .toLowerCase()
            .includes(normalizedSearch)
    );
}

export function filterIssues(
    issues,
    {
        search = "",
        category = "",
        priority = "",
        status = ""
    } = {}
) {
    return issues.filter(issue =>
        issueMatchesSearch(issue, search) &&
        (!category || issue.category === category) &&
        (!priority || issue.priority === priority) &&
        (!status || issue.status === status)
    );
}

export function getIssueFiltersFromUrl(
    search = "",
    hash = "",
    filterOptions = ISSUE_FILTER_OPTIONS
) {
    const queryParams = new URLSearchParams(search);
    const hashParams = new URLSearchParams(
        hash.replace(/^#/, "")
    );

    return {
        status: getRecognizedFilterValue(
            hashParams.get("status") || queryParams.get("status"),
            filterOptions.status
        ),
        priority: getRecognizedFilterValue(
            hashParams.get("priority") || queryParams.get("priority"),
            filterOptions.priority
        ),
        category: getRecognizedFilterValue(
            hashParams.get("category") || queryParams.get("category"),
            filterOptions.category
        )
    };
}

function getRecognizedFilterValue(requestedValue, options) {
    if (!requestedValue) {
        return "";
    }

    const decodedValue = decodeURIComponent(requestedValue).trim();

    return options.find(
        option =>
            option.toLowerCase() === decodedValue.toLowerCase()
    ) || "";
}
