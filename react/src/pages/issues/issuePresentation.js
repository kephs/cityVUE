export function formatIssueDate(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";

    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

export function getStatusClassName(status) {
    switch (status) {
        case "Open":
            return "text-bg-success";
        case "In Progress":
            return "text-bg-warning";
        case "Closed":
            return "text-bg-secondary";
        default:
            return "text-bg-primary";
    }
}
