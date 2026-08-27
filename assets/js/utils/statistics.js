
// ======================================================
// Statistics Utility
// ======================================================

export function getTotalIssues(issues) {

    return issues.length;

}

// ======================================================

export function getStatusCounts(issues) {

    return {

        open: issues.filter(
            issue => normalizeValue(issue.status) === "open"
        ).length,

        inProgress: issues.filter(
            issue => normalizeValue(issue.status) === "in progress"
        ).length,

        closed: issues.filter(
            issue => normalizeValue(issue.status) === "closed"
        ).length

    };

}

// ======================================================

export function getPriorityCounts(issues) {

    return {

        high: issues.filter(
            issue => normalizeValue(issue.priority) === "high"
        ).length,

        medium: issues.filter(
            issue => normalizeValue(issue.priority) === "medium"
        ).length,

        low: issues.filter(
            issue => normalizeValue(issue.priority) === "low"
        ).length

    };

}

// ======================================================

export function getCategoryCounts(issues) {

    return issues.reduce(
        (counts, issue) => {
            const category =
                String(issue.category || "Uncategorized").trim() ||
                "Uncategorized";

            counts[category] = (counts[category] || 0) + 1;

            return counts;
        },
        {}
    );

}

// ======================================================

export function getRecentIssues(issues, limit = 5) {

    return [...issues]

        .sort(

            (a, b) =>

                getTimestamp(b.dateReported) -

                getTimestamp(a.dateReported)

        )

        .slice(0, limit);

}

function normalizeValue(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function getTimestamp(date) {
    const timestamp = new Date(date).getTime();

    return Number.isNaN(timestamp) ? 0 : timestamp;
}
