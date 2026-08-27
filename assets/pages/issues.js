import { Modal } from "bootstrap";
import "../js/app.js";

import IssueService from "../services/IssueService.js";

import {
    filterIssues,
    getIssueFiltersFromUrl
} from "../js/utils/issueFilters.js";

import {
    sortIssues as sortIssueCollection
} from "../js/utils/issueSort.js";

import {
    initializeTheme
} from "../components/theme.js";

import {
    initializeToast,
    showToast
} from "../components/toast.js";

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
    initializeTheme();
    initializeToast();

    if (deleteModalElement) {
        deleteModal =
            Modal.getOrCreateInstance(
                deleteModalElement
            );
    }

    bindEvents();
    applyUrlFilters();
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

    const search = searchInput?.value || "";
    const category = categoryFilter?.value || "";
    const priority = priorityFilter?.value || "";
    const status = statusFilter?.value || "";

    filteredIssues = filterIssues(issues, {
        search,
        category,
        priority,
        status
    });

    sortIssues();

}

// ======================================================
// Sort
// ======================================================

function sortIssues() {

    const sortBy = sortSelect?.value || "newest";

    filteredIssues = sortIssueCollection(
        filteredIssues,
        sortBy
    );

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

    row.append(
        createTextCell(issue.title),
        createTextCell(issue.category),
        createTextCell(issue.priority),
        createStatusCell(issue.status),
        createTextCell(issue.reportedBy),
        createTextCell(formatDate(issue.dateReported)),
        createActionsCell(issue.id)
    );

    return row;

}

function createTextCell(value) {

    const cell = document.createElement("td");

    cell.textContent = String(value || "");

    return cell;

}

function createStatusCell(status) {

    const cell = document.createElement("td");
    const badge = document.createElement("span");

    badge.className =
        `badge ${getStatusBadge(status)}`;

    badge.textContent = String(status || "Open");

    cell.appendChild(badge);

    return cell;

}

function createActionsCell(id) {

    const cell = document.createElement("td");
    const issueId = String(id || "");

    const editLink = document.createElement("a");

    editLink.href =
        `./report.html?id=${encodeURIComponent(issueId)}`;

    editLink.className =
        "btn btn-sm btn-outline-primary me-2";

    editLink.title = "Edit";

    const editIcon = document.createElement("i");

    editIcon.className = "bi bi-pencil";

    editLink.appendChild(editIcon);

    const deleteButton = document.createElement("button");

    deleteButton.type = "button";
    deleteButton.className =
        "btn btn-sm btn-danger delete-btn";
    deleteButton.dataset.id = issueId;
    deleteButton.title = "Delete";

    const deleteIcon = document.createElement("i");

    deleteIcon.className = "bi bi-trash";

    deleteButton.appendChild(deleteIcon);

    cell.append(
        editLink,
        deleteButton
    );

    return cell;

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
// Apply URL Filters
// Supports both:
// issues.html?status=Open
// issues.html#status=Open
// ======================================================

function applyUrlFilters() {
    const filters = getIssueFiltersFromUrl(
        window.location.search,
        window.location.hash
    );

    if (statusFilter && filters.status) {
        statusFilter.value = filters.status;
    }

    if (priorityFilter && filters.priority) {
        priorityFilter.value = filters.priority;
    }

    if (categoryFilter && filters.category) {
        categoryFilter.value = filters.category;
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
        issue => String(issue.id) === deleteButton.dataset.id
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

    try {

        const deleted =
            IssueService.deleteIssue(issueToDelete);

        if (!deleted) {

            showToast(
                "Issue could not be found.",
                "warning"
            );

            return;

        }

    }
    catch (error) {

        console.error(
            "Unable to delete the issue:",
            error
        );

        showToast(
            "The issue could not be deleted. Please try again.",
            "danger"
        );

        return;

    }

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

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
        return "Unknown";
    }

    return parsedDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}
