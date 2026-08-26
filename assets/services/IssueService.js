import Issue from "../models/Issue.js";

const STORAGE_KEY = "cityvueIssues";

export default class IssueService {

    // ======================================================
    // Get All Issues
    // ======================================================

    static getIssues() {

        try {

            const storedValue =
                localStorage.getItem(STORAGE_KEY);

            if (storedValue === null) {

                return [];

            }

            const issues = JSON.parse(storedValue);

            if (!Array.isArray(issues)) {

                console.error(
                    "Stored CityVUE issue data is invalid."
                );

                return [];

            }

            return issues;

        }
        catch (error) {

            console.error(
                "Unable to read stored CityVUE issues:",
                error
            );

            return [];

        }

    }

    // ======================================================
    // Save New Issue
    // ======================================================

    static saveIssue(issueData) {

        const issues = this.getIssues();

        const issue = new Issue(issueData);

        issues.push(issue);

        this.writeIssues(issues);

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

        this.writeIssues(issues);

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

        this.writeIssues(filteredIssues);

        return true;

    }

    // ======================================================
    // Clear All Issues
    // ======================================================

    static clearIssues() {

        try {

            localStorage.removeItem(STORAGE_KEY);

        }
        catch (error) {

            console.error(
                "Unable to clear stored CityVUE issues:",
                error
            );

            throw new Error(
                "CityVUE could not clear the stored issues.",
                { cause: error }
            );

        }

        return true;

    }

    // ======================================================
    // Persist Issues
    // ======================================================

    static writeIssues(issues) {

        try {

            const serializedIssues = JSON.stringify(issues);

            localStorage.setItem(
                STORAGE_KEY,
                serializedIssues
            );

        }
        catch (error) {

            console.error(
                "Unable to save CityVUE issues:",
                error
            );

            throw new Error(
                "CityVUE could not save the issue data.",
                { cause: error }
            );

        }

    }

}
