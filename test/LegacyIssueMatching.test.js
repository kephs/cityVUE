import assert from "node:assert/strict";
import test from "node:test";

import { matchLegacyIssueToService } from "../react/src/catalog/legacyIssueMatching.js";
import { serviceCatalog } from "../react/src/catalog/serviceCatalog.js";

test("exact Service name and legacy Category match returns the catalog pair", () => {
    const match = matchLegacyIssueToService({ title: "Pothole", category: "Road" });
    assert.equal(match.service.id, "pothole");
    assert.equal(match.category.id, "roads");
});

test("wrong Category returns null", () => {
    assert.equal(matchLegacyIssueToService({ title: "Pothole", category: "Lighting" }), null);
});

test("unmatched issue returns null", () => {
    assert.equal(matchLegacyIssueToService({ title: "Historic concern", category: "Other" }), null);
});

test("ambiguous exact matches return null", () => {
    serviceCatalog.services.push({ ...serviceCatalog.services[0], id: "duplicate-pothole" });
    try {
        assert.equal(matchLegacyIssueToService({ title: "Pothole", category: "Road" }), null);
    } finally {
        serviceCatalog.services.pop();
    }
});

test("matching is deliberately case-sensitive", () => {
    assert.equal(matchLegacyIssueToService({ title: "pothole", category: "Road" }), null);
    assert.equal(matchLegacyIssueToService({ title: "Pothole", category: "road" }), null);
});

test("malformed Issue values do not throw and return null", () => {
    for (const issue of [null, undefined, {}, { title: 3, category: [] }]) {
        assert.doesNotThrow(() => matchLegacyIssueToService(issue));
        assert.equal(matchLegacyIssueToService(issue), null);
    }
});
