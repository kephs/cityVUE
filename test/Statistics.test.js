import assert from "node:assert/strict";
import test from "node:test";

import {
    getCategoryCounts,
    getPriorityCounts,
    getRecentIssues,
    getStatusCounts,
    getTotalIssues
} from "../assets/js/utils/statistics.js";

test("dashboard statistics return zero values for an empty collection", () => {
    assert.equal(getTotalIssues([]), 0);
    assert.deepEqual(getStatusCounts([]), {
        open: 0,
        inProgress: 0,
        closed: 0
    });
    assert.deepEqual(getPriorityCounts([]), {
        high: 0,
        medium: 0,
        low: 0
    });
    assert.deepEqual(getCategoryCounts([]), {});
    assert.deepEqual(getRecentIssues([]), []);
});

test("dashboard total includes every issue regardless of field validity", () => {
    assert.equal(getTotalIssues([{}, { status: null }, { priority: 12 }]), 3);
});

test("dashboard status totals are trimmed and case-insensitive", () => {
    assert.deepEqual(
        getStatusCounts([
            { status: "Open" },
            { status: " open " },
            { status: "IN PROGRESS" },
            { status: "Closed" },
            { status: "Resolved" },
            { status: null },
            {}
        ]),
        {
            open: 2,
            inProgress: 1,
            closed: 1
        }
    );
});

test("dashboard priority totals are trimmed and case-insensitive", () => {
    assert.deepEqual(
        getPriorityCounts([
            { priority: "High" },
            { priority: " high " },
            { priority: "MEDIUM" },
            { priority: "low" },
            { priority: "Urgent" },
            { priority: null },
            {}
        ]),
        {
            high: 2,
            medium: 1,
            low: 1
        }
    );
});

test("dashboard category totals trim labels and use Uncategorized for missing or blank values", () => {
    assert.deepEqual(
        getCategoryCounts([
            { category: " Road " },
            { category: "Road" },
            { category: "road" },
            { category: "" },
            { category: "   " },
            { category: null },
            {}
        ]),
        {
            Road: 2,
            road: 1,
            Uncategorized: 4
        }
    );
});

test("recent issues are newest first, apply the requested limit, and do not mutate input", () => {
    const issues = [
        { id: "old", dateReported: "2024-01-01T00:00:00.000Z" },
        { id: "new", dateReported: "2026-01-01T00:00:00.000Z" },
        { id: "middle", dateReported: "2025-01-01T00:00:00.000Z" }
    ];
    const originalOrder = [...issues];

    assert.deepEqual(
        getRecentIssues(issues, 2).map(issue => issue.id),
        ["new", "middle"]
    );
    assert.deepEqual(issues, originalOrder);
});

test("recent issues treat invalid and missing dates as timestamp zero", () => {
    const issues = [
        { id: "invalid", dateReported: "not-a-date" },
        { id: "dated", dateReported: "2020-01-01T00:00:00.000Z" },
        { id: "missing" }
    ];

    assert.deepEqual(
        getRecentIssues(issues).map(issue => issue.id),
        ["dated", "invalid", "missing"]
    );
});
