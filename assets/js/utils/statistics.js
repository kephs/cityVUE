
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
            issue => issue.status === "Open"
        ).length,

        inProgress: issues.filter(
            issue => issue.status === "In Progress"
        ).length,

        closed: issues.filter(
            issue => issue.status === "Closed"
        ).length

    };

}

// ======================================================

export function getPriorityCounts(issues) {

    return {

        high: issues.filter(
            issue => issue.priority === "High"
        ).length,

        medium: issues.filter(
            issue => issue.priority === "Medium"
        ).length,

        low: issues.filter(
            issue => issue.priority === "Low"
        ).length

    };

}

// ======================================================

export function getCategoryCounts(issues) {

    const categories = {};

    issues.forEach(issue => {

        const category = issue.category || "Other";

        categories[category] = (categories[category] || 0) + 1;

    });

    return categories;

}

// ======================================================

export function getRecentIssues(issues, limit = 5) {

    return [...issues]

        .sort(

            (a, b) =>

                new Date(b.dateReported) -

                new Date(a.dateReported)

        )

        .slice(0, limit);

}