const PRIORITY_ORDER = {
    High: 1,
    Medium: 2,
    Low: 3
};

export function sortIssues(issues, sortBy = "newest") {
    const sortedIssues = [...issues];

    switch (sortBy) {
        case "oldest":
            return sortedIssues.sort((a, b) =>
                new Date(a.dateReported) -
                new Date(b.dateReported)
            );

        case "titleAsc":
            return sortedIssues.sort((a, b) =>
                (a.title || "").localeCompare(b.title || "")
            );

        case "titleDesc":
            return sortedIssues.sort((a, b) =>
                (b.title || "").localeCompare(a.title || "")
            );

        case "priority":
            return sortedIssues.sort((a, b) =>
                (PRIORITY_ORDER[a.priority] ?? 99) -
                (PRIORITY_ORDER[b.priority] ?? 99)
            );

        default:
            return sortedIssues.sort((a, b) =>
                new Date(b.dateReported) -
                new Date(a.dateReported)
            );
    }
}
