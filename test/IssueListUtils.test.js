import assert from "node:assert/strict";
import test from "node:test";

import {
    filterIssues,
    getIssueFiltersFromUrl,
    issueMatchesSearch
} from "../assets/js/utils/issueFilters.js";
import { sortIssues } from "../assets/js/utils/issueSort.js";

const issues = [
    {
        id: "issue-1",
        title: "Broken Streetlight",
        description: "Lamp flickers after dark",
        category: "Lighting",
        priority: "High",
        status: "Open",
        reportedBy: "Jordan Lee",
        location: "Main Street",
        dateReported: "2026-03-01T12:00:00.000Z"
    },
    {
        id: "issue-2",
        title: "Pothole",
        description: "Deep hole in travel lane",
        category: "Road",
        priority: "Medium",
        status: "In Progress",
        reportedBy: "Casey",
        location: "Oak Avenue",
        dateReported: "2026-01-01T12:00:00.000Z"
    },
    {
        id: "issue-3",
        title: "Overflowing bin",
        description: null,
        category: "Garbage",
        priority: "Low",
        status: "Closed",
        reportedBy: null,
        location: null,
        dateReported: "2026-02-01T12:00:00.000Z"
    }
];

test("issue search covers every current searchable field", () => {
    const searchesByExpectedId = new Map([
        ["streetlight", "issue-1"],
        ["travel lane", "issue-2"],
        ["garbage", "issue-3"],
        ["jordan", "issue-1"],
        ["oak avenue", "issue-2"]
    ]);

    for (const [search, expectedId] of searchesByExpectedId) {
        assert.deepEqual(
            filterIssues(issues, { search }).map(issue => issue.id),
            [expectedId]
        );
    }
});

test("issue search is case-insensitive and trims the search text", () => {
    assert.equal(
        issueMatchesSearch(issues[0], "  FLICKERS AFTER  "),
        true
    );
});

test("empty search matches issues with missing or null searchable fields", () => {
    const issueWithMissingFields = { id: "issue-4" };

    assert.equal(issueMatchesSearch(issueWithMissingFields), true);
    assert.deepEqual(
        filterIssues([issues[2], issueWithMissingFields]),
        [issues[2], issueWithMissingFields]
    );
});

test("category, priority, and status filters match current exact values", () => {
    assert.deepEqual(
        filterIssues(issues, { category: "Road" }).map(issue => issue.id),
        ["issue-2"]
    );
    assert.deepEqual(
        filterIssues(issues, { priority: "Low" }).map(issue => issue.id),
        ["issue-3"]
    );
    assert.deepEqual(
        filterIssues(issues, { status: "Open" }).map(issue => issue.id),
        ["issue-1"]
    );
    assert.deepEqual(filterIssues(issues, { category: "road" }), []);
});

test("combined filters require every active criterion to match", () => {
    assert.deepEqual(
        filterIssues(issues, {
            search: "hole",
            category: "Road",
            priority: "Medium",
            status: "In Progress"
        }).map(issue => issue.id),
        ["issue-2"]
    );

    assert.deepEqual(
        filterIssues(issues, {
            category: "Road",
            status: "Closed"
        }),
        []
    );
});

test("no active filters returns a new collection with the same issues", () => {
    const result = filterIssues(issues);

    assert.deepEqual(result, issues);
    assert.notEqual(result, issues);
});

test("URL filters read recognized query parameters case-insensitively", () => {
    assert.deepEqual(
        getIssueFiltersFromUrl(
            "?status=in%20progress&priority=HIGH&category=road"
        ),
        {
            status: "In Progress",
            priority: "High",
            category: "Road"
        }
    );
});

test("hash filters take precedence while missing hash values fall back to query values", () => {
    assert.deepEqual(
        getIssueFiltersFromUrl(
            "?status=Open&priority=Low&category=Road",
            "#status=Closed&category=Lighting"
        ),
        {
            status: "Closed",
            priority: "Low",
            category: "Lighting"
        }
    );
});

test("empty hash filter values fall back to query values", () => {
    assert.deepEqual(
        getIssueFiltersFromUrl(
            "?status=Open&priority=High&category=Road",
            "#status=&priority=&category="
        ),
        {
            status: "Open",
            priority: "High",
            category: "Road"
        }
    );
});

test("an unrecognized non-empty hash value still takes precedence over a valid query value", () => {
    assert.deepEqual(
        getIssueFiltersFromUrl(
            "?status=Open&priority=High&category=Road",
            "#status=Resolved&priority=Urgent&category=Trees"
        ),
        {
            status: "",
            priority: "",
            category: ""
        }
    );
});

test("URL filters ignore invalid or unrecognized values", () => {
    assert.deepEqual(
        getIssueFiltersFromUrl(
            "?status=Resolved&priority=Urgent&category=Trees"
        ),
        {
            status: "",
            priority: "",
            category: ""
        }
    );
});

test("sortIssues supports newest and oldest date ordering", () => {
    assert.deepEqual(
        sortIssues(issues, "newest").map(issue => issue.id),
        ["issue-1", "issue-3", "issue-2"]
    );
    assert.deepEqual(
        sortIssues(issues, "oldest").map(issue => issue.id),
        ["issue-2", "issue-3", "issue-1"]
    );
});

test("sortIssues supports title ascending and descending with missing titles", () => {
    const titleIssues = [
        { id: "b", title: "Beta" },
        { id: "missing" },
        { id: "a", title: "Alpha" }
    ];

    assert.deepEqual(
        sortIssues(titleIssues, "titleAsc").map(issue => issue.id),
        ["missing", "a", "b"]
    );
    assert.deepEqual(
        sortIssues(titleIssues, "titleDesc").map(issue => issue.id),
        ["b", "a", "missing"]
    );
});

test("priority sorting puts known priorities first and preserves unknown priority order", () => {
    const priorityIssues = [
        { id: "unknown", priority: "Urgent" },
        { id: "low", priority: "Low" },
        { id: "missing" },
        { id: "high", priority: "High" },
        { id: "medium", priority: "Medium" }
    ];

    assert.deepEqual(
        sortIssues(priorityIssues, "priority").map(issue => issue.id),
        ["high", "medium", "low", "unknown", "missing"]
    );
});

test("date sorting preserves current stable placement when invalid or missing dates compare as NaN", () => {
    const dateIssues = [
        { id: "invalid", dateReported: "not-a-date" },
        { id: "new", dateReported: "2026-01-01T00:00:00.000Z" },
        { id: "missing" },
        { id: "old", dateReported: "2024-01-01T00:00:00.000Z" }
    ];

    assert.deepEqual(
        sortIssues(dateIssues, "newest").map(issue => issue.id),
        ["invalid", "new", "missing", "old"]
    );
    assert.deepEqual(
        sortIssues(dateIssues, "oldest").map(issue => issue.id),
        ["invalid", "new", "missing", "old"]
    );
});

test("sortIssues does not mutate the caller's collection", () => {
    const source = [...issues];

    const result = sortIssues(source, "oldest");

    assert.deepEqual(source, issues);
    assert.notEqual(result, source);
});
