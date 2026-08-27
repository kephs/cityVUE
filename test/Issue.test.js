import assert from "node:assert/strict";
import test from "node:test";

import Issue from "../assets/models/Issue.js";

test("creating an Issue preserves supplied fields and applies defaults", () => {
    const beforeCreation = Date.now();
    const issue = new Issue({
        title: "Pothole on Main Street",
        description: "Large pothole near the crosswalk",
        reportedBy: "Resident",
        location: "100 Main Street"
    });
    const afterCreation = Date.now();

    assert.equal(issue.title, "Pothole on Main Street");
    assert.equal(issue.description, "Large pothole near the crosswalk");
    assert.equal(issue.category, "General");
    assert.equal(issue.priority, "Medium");
    assert.equal(issue.status, "Open");
    assert.equal(issue.reportedBy, "Resident");
    assert.equal(issue.location, "100 Main Street");
    assert.match(issue.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(Date.parse(issue.dateReported) >= beforeCreation);
    assert.ok(Date.parse(issue.dateReported) <= afterCreation);
});

test("creating an Issue preserves explicitly supplied values", () => {
    const supplied = {
        id: "issue-123",
        title: "Broken streetlight",
        description: "Light does not turn on",
        category: "Streetlight",
        priority: "High",
        status: "In Progress",
        reportedBy: "Alex",
        dateReported: "2026-08-01T12:00:00.000Z",
        location: "200 Oak Avenue"
    };

    const issue = new Issue(supplied);

    assert.ok(issue instanceof Issue);
    assert.deepEqual({ ...issue }, supplied);
});
