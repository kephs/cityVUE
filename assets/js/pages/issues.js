import IssueService from "../services/IssueService.js";
import {
    initializeToast,
    showToast
} from "../components/toast.js";

// ======================================================
// Constants
// ======================================================

const PRIORITY_ORDER = {
    High: 1,
    Medium: 2,
    Low: 3
};

// ======================================================
// DOM Elements
// ======================================================

const tableBody = document.querySelector("#issuesTable");
const issueCount = document.querySelector("#issueCount");

const searchInput = document.querySelector("#searchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const priorityFilter = document.querySelector("#priorityFilter");
const statusFilter = document.querySelector("#statusFilter");
const sortSelect = document.querySelector("#sortSelect");

// Delete Modal
const deleteModalElement = document.querySelector("#deleteModal");
const confirmDeleteBtn = document.querySelector("#confirmDeleteBtn");
const deleteIssueTitle = document.querySelector("#deleteIssueTitle");

// ======================================================
// Application State
// ======================================================

let issues = [];
let filteredIssues = [];

let issueToDelete = null;
let deleteModal = null;

// ======================================================
// Initialize
// ======================================================

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {

    initializeToast();

    if (deleteModalElement) {
        deleteModal = new bootstrap.Modal(deleteModalElement);
    }

    bindEvents();

    loadIssues();

}

// ======================================================
// Event Listeners
// ======================================================

function bindEvents() {

    searchInput?.addEventListener("input", applyFilters);

    categoryFilter?.addEventListener("change", applyFilters);

    priorityFilter?.addEventListener("change", applyFilters);

    statusFilter?.addEventListener("change", applyFilters);

    sortSelect?.addEventListener("change", applyFilters);

    tableBody?.addEventListener("click", handleTableClick);

    confirmDeleteBtn?.addEventListener(
        "click",
        confirmDelete
    );

}

// ======================================================
// Load Issues
// ======================================================

function loadIssues() {

    issues = IssueService.getIssues();

    applyFilters();

}

// ======================================================
// Search & Filter
// ======================================================

function applyFilters() {

    const search = searchInput?.value.trim().toLowerCase() || "";
    const category = categoryFilter?.value || "";
    const priority = priorityFilter?.value || "";
    const status = statusFilter?.value || "";

    filteredIssues = issues.filter(issue => {

        const matchesSearch =

            (issue.title || "").toLowerCase().includes(search) ||

            (issue.description || "").toLowerCase().includes(search) ||

            (issue.category || "").toLowerCase().includes(search) ||

            (issue.reportedBy || "").toLowerCase().includes(search) ||

            (issue.location || "").toLowerCase().includes(search);

        const matchesCategory =

            !category ||

            issue.category === category;

        const matchesPriority =

            !priority ||

            issue.priority === priority;

        const matchesStatus =

            !status ||

            issue.status === status;

        return (

            matchesSearch &&

            matchesCategory &&

            matchesPriority &&

            matchesStatus

        );

    });

    sortIssues();

}

// ======================================================
// Sort
// ======================================================

function sortIssues() {

    const sortBy = sortSelect?.value || "newest";

    switch (sortBy) {

        case "oldest":

            filteredIssues.sort((a, b) =>
                new Date(a.dateReported) -
                new Date(b.dateReported)
            );

            break;

        case "titleAsc":

            filteredIssues.sort((a, b) =>
                (a.title || "").localeCompare(b.title || "")
            );

            break;

        case "titleDesc":

            filteredIssues.sort((a, b) =>
                (b.title || "").localeCompare(a.title || "")
            );

            break;

        case "priority":

            filteredIssues.sort((a, b) =>
                PRIORITY_ORDER[a.priority] -
                PRIORITY_ORDER[b.priority]
            );

            break;

        default:

            filteredIssues.sort((a, b) =>
                new Date(b.dateReported) -
                new Date(a.dateReported)
            );

    }

    renderIssues();

}

// ======================================================
// Render Issues
// ======================================================

function renderIssues() {

    if (!tableBody) return;

    tableBody.innerHTML = "";

    if (filteredIssues.length === 0) {

        renderEmptyState();

        return;

    }

    const fragment = document.createDocumentFragment();

    filteredIssues.forEach(issue => {

        fragment.appendChild(
            createIssueRow(issue)
        );

    });

    tableBody.appendChild(fragment);

    if (issueCount) {

        issueCount.textContent =
            `${filteredIssues.length} issue(s)`;

    }

}

// ======================================================
// Create Table Row
// ======================================================

function createIssueRow(issue) {

    const row = document.createElement("tr");

    row.innerHTML = `

        <td>${issue.title || ""}</td>

        <td>${issue.category || ""}</td>

        <td>${issue.priority || ""}</td>

        <td>

            <span class="badge ${getStatusBadge(issue.status)}">

                ${issue.status || "Open"}

            </span>

        </td>

        <td>${issue.reportedBy || ""}</td>

        <td>${formatDate(issue.dateReported)}</td>

        <td>

            <a
                href="./report.html?id=${issue.id}"
                class="btn btn-sm btn-outline-primary me-2"
                title="Edit">

                <i class="bi bi-pencil"></i>

            </a>

            <button
                class="btn btn-sm btn-danger delete-btn"
                data-id="${issue.id}"
                title="Delete">

                <i class="bi bi-trash"></i>

            </button>

        </td>

    `;

    return row;

}

// ======================================================
// Empty State
// ======================================================

function renderEmptyState() {

    if (!tableBody) return;

    tableBody.innerHTML = `

        <tr>

            <td colspan="7" class="text-center py-5">

                <i class="bi bi-inbox display-1 text-secondary"></i>

                <h4 class="mt-3">

                    No Issues Found

                </h4>

                <p class="text-muted">

                    Try changing your search or filters.

                </p>

            </td>

        </tr>

    `;

    if (issueCount) {

        issueCount.textContent = "0 issue(s)";

    }

}

// ======================================================
// Table Events
// ======================================================

function handleTableClick(event) {

    const deleteButton = event.target.closest(".delete-btn");

    if (!deleteButton) {

        return;

    }

    const issue = issues.find(
        issue => issue.id === deleteButton.dataset.id
    );

    if (!issue) {

        return;

    }

    issueToDelete = issue.id;

    if (deleteIssueTitle) {

        deleteIssueTitle.textContent = issue.title;

    }

    deleteModal?.show();

}

// ======================================================
// Confirm Delete
// ======================================================

function confirmDelete() {

    if (!issueToDelete) {

        return;

    }

    IssueService.deleteIssue(issueToDelete);

    issueToDelete = null;

    deleteModal?.hide();

    showToast(
        "Issue deleted successfully."
    );

    loadIssues();

}

// ======================================================
// Helpers
// ======================================================

function getStatusBadge(status) {

    switch (status) {

        case "Open":
            return "bg-success";

        case "In Progress":
            return "bg-warning text-dark";

        case "Closed":
            return "bg-secondary";

        default:
            return "bg-primary";

    }

}

function formatDate(date) {

    if (!date) return "";

    return new Date(date).toLocaleDateString(
        "en-US",
        {
            year: "numeric",
            month: "short",
            day: "numeric"
        }
    );

}