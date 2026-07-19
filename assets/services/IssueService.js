import Issue from "../models/Issue.js";

import {
    load,
    save
} from "../js/storage.js";

const STORAGE_KEY = "cityvueIssues";

export default class IssueService {

    // ======================================================
    // Get All Issues
    // ======================================================

    static getIssues() {

        const issues = JSON.parse(
            localStorage.getItem(STORAGE_KEY)
        ) || [];

        return issues;

    }

    // ======================================================
    // Save New Issue
    // ======================================================

    static saveIssue(issueData) {

        const issues = this.getIssues();

        const issue = new Issue(issueData);

        issues.push(issue);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(issues)
        );

        return issue;

    }

    // ======================================================
    // Get Issue By ID
    // ======================================================

    static getIssueById(id) {

        return this.getIssues().find(
            issue => issue.id === id
        ) || null;

    }

    // ======================================================
    // Update Existing Issue
    // ======================================================

    static updateIssue(updatedIssue) {

        const issues = this.getIssues();

        const index = issues.findIndex(
            issue => issue.id === updatedIssue.id
        );

        if (index === -1) {

            return false;

        }

        issues[index] = new Issue(updatedIssue);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(issues)
        );

        return true;

    }

    // ======================================================
    // Delete Issue
    // ======================================================

    static deleteIssue(id) {

        const issues = this.getIssues();

        const filteredIssues = issues.filter(
            issue => issue.id !== id
        );

        if (filteredIssues.length === issues.length) {

            return false;

        }

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(filteredIssues)
        );

        return true;

    }

    // ======================================================
    // Clear All Issues
    // ======================================================

    static clearIssues() {

        localStorage.removeItem(STORAGE_KEY);

        return true;

    }

}