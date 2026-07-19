import "../js/app.js";

import IssueService from "../services/IssueService.js";

import { initializeTheme } from "../components/theme.js";

// ======================================================
// Constants
// ======================================================

const RECENT_ISSUE_LIMIT = 5;

const STATUS_LABELS = [
    "Open",
    "In Progress",
    "Closed"
];

const PRIORITY_LABELS = [
    "High",
    "Medium",
    "Low"
];

// ======================================================
// DOM Elements
// ======================================================

const totalIssuesElement =
    document.querySelector("#totalIssues");

const openIssuesElement =
    document.querySelector("#openIssues");

const inProgressIssuesElement =
    document.querySelector("#inProgressIssues");

const closedIssuesElement =
    document.querySelector("#closedIssues");

const highPriorityElement =
    document.querySelector("#highPriority");

const mediumPriorityElement =
    document.querySelector("#mediumPriority");

const lowPriorityElement =
    document.querySelector("#lowPriority");

const recentIssuesList =
    document.querySelector("#recentIssues");

const statusChartCanvas =
    document.querySelector("#statusChart");

const priorityChartCanvas =
    document.querySelector("#priorityChart");

const categoryChartCanvas =
    document.querySelector("#categoryChart");

// ======================================================
// Chart Instances
// ======================================================

let statusChartInstance = null;
let priorityChartInstance = null;
let categoryChartInstance = null;

// ======================================================
// Initialize
// ======================================================

document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard
);

function initializeDashboard() {

    initializeTheme();

    try {

        const issues = getIssues();

        renderStatistics(issues);
        renderCharts(issues);
        renderRecentIssues(issues);

    }
    catch (error) {

        console.error(
            "Unable to initialize the dashboard:",
            error
        );

        renderDashboardError();

    }

}

// ======================================================
// Retrieve Issues
// ======================================================

function getIssues() {

    const storedIssues = IssueService.getIssues();

    if (!Array.isArray(storedIssues)) {

        console.warn(
            "IssueService.getIssues() did not return an array."
        );

        return [];

    }

    return storedIssues;

}

// ======================================================
// Statistics Cards
// ======================================================

function renderStatistics(issues) {

    const statusCounts = getStatusCounts(issues);

    const priorityCounts = getPriorityCounts(issues);

    setTextContent(
        totalIssuesElement,
        issues.length
    );

    setTextContent(
        openIssuesElement,
        statusCounts.open
    );

    setTextContent(
        inProgressIssuesElement,
        statusCounts.inProgress
    );

    setTextContent(
        closedIssuesElement,
        statusCounts.closed
    );

    setTextContent(
        highPriorityElement,
        priorityCounts.high
    );

    setTextContent(
        mediumPriorityElement,
        priorityCounts.medium
    );

    setTextContent(
        lowPriorityElement,
        priorityCounts.low
    );

}

// ======================================================
// Status Counts
// ======================================================

function getStatusCounts(issues) {

    return {

        open: issues.filter(
            issue => normalizeValue(issue.status) === "open"
        ).length,

        inProgress: issues.filter(
            issue =>
                normalizeValue(issue.status) ===
                "in progress"
        ).length,

        closed: issues.filter(
            issue => normalizeValue(issue.status) === "closed"
        ).length

    };

}

// ======================================================
// Priority Counts
// ======================================================

function getPriorityCounts(issues) {

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
// Category Counts
// ======================================================

function getCategoryCounts(issues) {

    return issues.reduce(
        (counts, issue) => {

            const category =
                String(issue.category || "Uncategorized").trim() ||
                "Uncategorized";

            counts[category] =
                (counts[category] || 0) + 1;

            return counts;

        },
        {}
    );

}

// ======================================================
// Render All Charts
// ======================================================

function renderCharts(issues) {

    if (!isChartAvailable()) {

        console.warn(
            "Chart.js is unavailable. Dashboard charts were not rendered."
        );

        return;

    }

    const statusCounts = getStatusCounts(issues);

    const priorityCounts = getPriorityCounts(issues);

    const categoryCounts = getCategoryCounts(issues);

    renderStatusChart(statusCounts);

    renderPriorityChart(priorityCounts);

    renderCategoryChart(categoryCounts);

}

// ======================================================
// Status Chart
// ======================================================

function renderStatusChart(statusCounts) {

    if (!statusChartCanvas) {

        return;

    }

    statusChartInstance?.destroy();

    statusChartInstance = new Chart(
        statusChartCanvas,
        {

            type: "doughnut",

            data: {

                labels: STATUS_LABELS,

                datasets: [
                    {

                        label: "Issues",

                        data: [
                            statusCounts.open,
                            statusCounts.inProgress,
                            statusCounts.closed
                        ],

                        backgroundColor: [
                            "#198754",
                            "#ffc107",
                            "#6c757d"
                        ],

                        borderWidth: 1

                    }
                ]

            },

            options: getDoughnutChartOptions()

        }
    );

}

// ======================================================
// Priority Chart
// ======================================================

function renderPriorityChart(priorityCounts) {

    if (!priorityChartCanvas) {

        return;

    }

    priorityChartInstance?.destroy();

    priorityChartInstance = new Chart(
        priorityChartCanvas,
        {

            type: "pie",

            data: {

                labels: PRIORITY_LABELS,

                datasets: [
                    {

                        label: "Issues",

                        data: [
                            priorityCounts.high,
                            priorityCounts.medium,
                            priorityCounts.low
                        ],

                        backgroundColor: [
                            "#dc3545",
                            "#ffc107",
                            "#198754"
                        ],

                        borderWidth: 1

                    }
                ]

            },

            options: getDoughnutChartOptions()

        }
    );

}

// ======================================================
// Category Chart
// ======================================================
function renderCategoryChart(categoryCounts) {

    if (!categoryChartCanvas) {
        return;
    }

    if (typeof Chart === "undefined") {
        console.error(
            "Chart.js is unavailable. The category chart cannot be rendered."
        );

        return;
    }

    categoryChartInstance?.destroy();

    const labels = Object.keys(categoryCounts);
    const values = Object.values(categoryCounts);

    categoryChartInstance = new Chart(
        categoryChartCanvas,
        {
            type: "bar",

            data: {
                labels,

                datasets: [
                    {
                        label: "Number of Issues",
                        data: values,
                        backgroundColor: "#0d6efd",
                        borderColor: "#0d6efd",
                        borderWidth: 1
                    }
                ]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                onHover(event, chartElements) {

                    const canvas =
                        event.native?.target ||
                        categoryChartCanvas;

                    canvas.style.cursor =
                        chartElements.length > 0
                            ? "pointer"
                            : "default";

                },

                onClick(event, chartElements) {

                    if (chartElements.length === 0) {
                        return;
                    }

                    const clickedIndex =
                        chartElements[0].index;

                    const selectedCategory =
                        labels[clickedIndex];

                    if (!selectedCategory) {
                        return;
                    }

                    window.location.href =
                        `./issues.html#category=${encodeURIComponent(
                            selectedCategory
                        )}`;

                },

                plugins: {
                    legend: {
                        display: false
                    },

                    tooltip: {
                        enabled: true
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,

                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        }
    );
}

// ======================================================
// Shared Doughnut and Pie Options
// ======================================================

function getDoughnutChartOptions() {

    return {

        responsive: true,

        maintainAspectRatio: false,

        plugins: {

            legend: {

                position: "bottom"

            },

            tooltip: {

                enabled: true

            }

        }

    };

}

// ======================================================
// Recent Issues
// ======================================================

function renderRecentIssues(issues) {

    if (!recentIssuesList) {

        return;

    }

    recentIssuesList.replaceChildren();

    const recentIssues = getRecentIssues(issues);

    if (recentIssues.length === 0) {

        renderEmptyRecentIssues();

        return;

    }

    const fragment =
        document.createDocumentFragment();

    recentIssues.forEach(issue => {

        fragment.appendChild(
            createRecentIssueItem(issue)
        );

    });

    recentIssuesList.appendChild(fragment);

}

// ======================================================
// Get Recent Issues
// ======================================================

function getRecentIssues(issues) {

    return [...issues]
        .sort(
            (firstIssue, secondIssue) =>
                getTimestamp(secondIssue.dateReported) -
                getTimestamp(firstIssue.dateReported)
        )
        .slice(0, RECENT_ISSUE_LIMIT);

}

// ======================================================
// Create Recent Issue Item
// ======================================================

function createRecentIssueItem(issue) {

    const item = document.createElement("a");

    item.className =
        "list-group-item list-group-item-action " +
        "d-flex justify-content-between " +
        "align-items-start gap-3";

    item.href =
        `./report.html?id=${encodeURIComponent(
            String(issue.id || "")
        )}`;

    const content = document.createElement("div");

    content.className = "flex-grow-1";

    const title = document.createElement("div");

    title.className = "fw-semibold";

    title.textContent =
        issue.title || "Untitled Issue";

    const details = document.createElement("small");

    details.className = "text-body-secondary";

    details.textContent =
        `${issue.category || "Uncategorized"} • ` +
        `${formatDate(issue.dateReported)}`;

    const badge = document.createElement("span");

    badge.className =
        `badge ${getStatusBadgeClass(issue.status)}`;

    badge.textContent =
        issue.status || "Open";

    content.append(
        title,
        details
    );

    item.append(
        content,
        badge
    );

    return item;

}

// ======================================================
// Empty Recent Issues State
// ======================================================

function renderEmptyRecentIssues() {

    const emptyState =
        document.createElement("div");

    emptyState.className =
        "list-group-item text-center " +
        "text-body-secondary py-4";

    const icon =
        document.createElement("i");

    icon.className =
        "bi bi-inbox fs-3 d-block mb-2";

    const message =
        document.createElement("span");

    message.textContent =
        "No recent issues.";

    emptyState.append(
        icon,
        message
    );

    recentIssuesList.appendChild(emptyState);

}

// ======================================================
// Dashboard Error State
// ======================================================

function renderDashboardError() {

    const statisticElements = [
        totalIssuesElement,
        openIssuesElement,
        inProgressIssuesElement,
        closedIssuesElement,
        highPriorityElement,
        mediumPriorityElement,
        lowPriorityElement
    ];

    statisticElements.forEach(element => {

        setTextContent(element, "—");

    });

    if (!recentIssuesList) {

        return;

    }

    recentIssuesList.replaceChildren();

    const message =
        document.createElement("div");

    message.className =
        "list-group-item text-center text-danger py-4";

    message.textContent =
        "Dashboard information could not be loaded.";

    recentIssuesList.appendChild(message);

}

// ======================================================
// Helpers
// ======================================================

function setTextContent(element, value) {

    if (element) {

        element.textContent = String(value);

    }

}

function normalizeValue(value) {

    return String(value || "")
        .trim()
        .toLowerCase();

}

function getTimestamp(date) {

    const timestamp =
        new Date(date).getTime();

    return Number.isNaN(timestamp)
        ? 0
        : timestamp;

}

function formatDate(date) {

    if (!date) {

        return "Date unavailable";

    }

    const parsedDate =
        new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {

        return "Date unavailable";

    }

    return parsedDate.toLocaleDateString(
        "en-US",
        {

            month: "short",

            day: "numeric",

            year: "numeric"

        }
    );

}

function getStatusBadgeClass(status) {

    switch (normalizeValue(status)) {

        case "open":
            return "text-bg-success";

        case "in progress":
            return "text-bg-warning";

        case "closed":
            return "text-bg-secondary";

        default:
            return "text-bg-primary";

    }

}

function isChartAvailable() {

    return typeof Chart !== "undefined";

}