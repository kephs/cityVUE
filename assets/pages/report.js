import "../js/app.js";

import IssueService from "../services/IssueService.js";

import { initializeTheme } from "../components/theme.js";

import {
    initializeToast,
    showToast
} from "../components/toast.js";

// ======================================================
// DOM Elements
// ======================================================

const form = document.querySelector("#issueForm");

const titleInput = document.querySelector("#title");
const descriptionInput = document.querySelector("#description");
const categoryInput = document.querySelector("#category");
const priorityInput = document.querySelector("#priority");
const reportedByInput = document.querySelector("#reportedBy");
const locationInput = document.querySelector("#location");

const submitButton = form.querySelector("button[type='submit']");

// ======================================================
// Page State
// ======================================================

const params = new URLSearchParams(window.location.search);

const issueId = params.get("id");

let editing = false;
let currentIssue = null;

// ======================================================
// Initialize
// ======================================================

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {

    initializeTheme();
    initializeToast();

    if (issueId) {
        loadIssue();
    }

    form.addEventListener("submit", handleSubmit);

}

// ======================================================
// Load Existing Issue
// ======================================================

function loadIssue() {

    currentIssue = IssueService.getIssueById(issueId);

    if (!currentIssue) {

        showToast("Issue not found.", "danger");

        setTimeout(() => {

            window.location.href = "./issues.html";

        }, 1500);

        return;

    }

    editing = true;

    titleInput.value = currentIssue.title;
    descriptionInput.value = currentIssue.description;
    categoryInput.value = currentIssue.category;
    priorityInput.value = currentIssue.priority;
    reportedByInput.value = currentIssue.reportedBy;
    locationInput.value = currentIssue.location;

    submitButton.innerHTML = `
        <i class="bi bi-save me-2"></i>
        Update Issue
    `;

}

// ======================================================
// Submit Form
// ======================================================

function handleSubmit(event) {

    event.preventDefault();

    if (!form.checkValidity()) {

        showToast(
            "Please complete all required fields.",
            "warning"
        );

        form.reportValidity();

        return;

    }

    const issue = {

        id: editing
            ? currentIssue.id
            : undefined,

        title: titleInput.value.trim(),

        description: descriptionInput.value.trim(),

        category: categoryInput.value,

        priority: priorityInput.value,

        status: editing
            ? currentIssue.status
            : "Open",

        reportedBy: reportedByInput.value.trim(),

        location: locationInput.value.trim(),

        dateReported: editing
            ? currentIssue.dateReported
            : new Date().toISOString()

    };

    if (editing) {

        IssueService.updateIssue(issue);

        showToast(
            "Issue updated successfully."
        );

    }
    else {

        IssueService.saveIssue(issue);

        showToast(
            "Issue submitted successfully."
        );

    }

    form.reset();

    setTimeout(() => {

        window.location.href = "./issues.html";

    }, 2500);

}