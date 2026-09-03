import { describe, expect, test } from "vitest";

import {
    getDepartmentCounts,
    resolveIssueDepartment,
    UNASSIGNED_DEPARTMENT
} from "../src/pages/dashboard/departmentStatistics.js";

const catalog = {
    departments: [
        { id: "public-works", name: "Public Works", status: "active" },
        { id: "parks", name: "Parks & Recreation", status: "active" }
    ],
    divisions: [
        { id: "forestry", departmentId: "parks", status: "active" }
    ],
    categories: [
        { id: "roads", departmentId: "public-works", legacyCategory: "Road", status: "active" },
        { id: "trees", departmentId: "parks", divisionId: "forestry", legacyCategory: "Trees", status: "active" }
    ]
};

describe("Department statistics", () => {
    test("resolves an exact legacy Category to its owning Department", () => {
        expect(resolveIssueDepartment({ category: "Road" }, catalog)).toBe("Public Works");
        expect(resolveIssueDepartment({ category: "road" }, catalog)).toBe(UNASSIGNED_DEPARTMENT);
    });

    test("resolves a Category under a Division to the Division's owning Department", () => {
        expect(resolveIssueDepartment({ category: "Trees" }, catalog)).toBe("Parks & Recreation");
    });

    test.each([
        [{ category: "Unknown" }, "an unmatched Category"],
        [{ category: null }, "a null Category"],
        [{}, "a missing Category"]
    ])("returns Unassigned Department for %s", (issue) => {
        expect(resolveIssueDepartment(issue, catalog)).toBe(UNASSIGNED_DEPARTMENT);
    });

    test("aggregates by Department, sorts descending, and alphabetizes ties without mutation", () => {
        const issues = [
            { id: "1", category: "Road" },
            { id: "2", category: "Trees" },
            { id: "3", category: "Road" },
            { id: "4", category: "Unknown" },
            { id: "5", category: "Trees" }
        ];
        const snapshot = structuredClone(issues);

        expect(getDepartmentCounts(issues, catalog)).toEqual([
            { department: "Parks & Recreation", count: 2 },
            { department: "Public Works", count: 2 },
            { department: UNASSIGNED_DEPARTMENT, count: 1 }
        ]);
        expect(issues).toEqual(snapshot);
    });
});
