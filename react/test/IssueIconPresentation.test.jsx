import { describe, expect, test } from "vitest";

import { GENERIC_ISSUE_ICON, getIssueIcon, resolveIssueIcon } from "../src/pages/issues/issueIconPresentation.js";

describe("Issue icon presentation", () => {
    test("an exact catalog-matched Issue uses its Service icon", () => {
        expect(getIssueIcon({ title: "Pothole", category: "Road" })).toBe("bi-cone-striped");
    });

    test("a missing Service icon falls back to its Category icon", () => {
        expect(resolveIssueIcon({ service: {}, category: { icon: "bi-tree" } })).toBe("bi-tree");
    });

    test("an unmatched legacy Issue uses the generic icon", () => {
        expect(getIssueIcon({ title: "Legacy concern", category: "Other" })).toBe(GENERIC_ISSUE_ICON);
    });
});
