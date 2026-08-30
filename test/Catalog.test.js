import assert from "node:assert/strict";
import { test } from "node:test";
import { getActiveCategories, getServicesByCategory, getServiceById, getVisibleQuestions, searchServices } from "../react/src/catalog/catalogService.js";
import { formatCompatibilityDescription, mapIntakeToLegacyIssue } from "../react/src/catalog/intakeCompatibility.js";

test("active categories are ordered and retain valid Department relationships", () => {
    const categories = getActiveCategories();
    assert.ok(categories.length >= 4);
    assert.equal(categories.some((category) => category.status !== "active"), false);
    assert.ok(categories.every((category) => category.departmentId));
});

test("services are filtered by Category and invalid categories return no services", () => {
    assert.deepEqual(getServicesByCategory("roads").map((service) => service.id), ["pothole", "damaged-sign"]);
    assert.deepEqual(getServicesByCategory("missing"), []);
    assert.equal(getServiceById("missing"), null);
});

test("service search is trimmed, case-insensitive, and matches names, aliases, and keywords", () => {
    assert.deepEqual(searchServices("roads", "  POTHOLE ").map((service) => service.id), ["pothole"]);
    assert.deepEqual(searchServices("roads", "hole in road").map((service) => service.id), ["pothole"]);
    assert.deepEqual(searchServices("roads", "broken asphalt").map((service) => service.id), ["pothole"]);
    assert.deepEqual(searchServices("roads", ""), getServicesByCategory("roads"));
});

test("conditional visibility uses deterministic equality rules", () => {
    const service = getServiceById("pothole");
    assert.deepEqual(getVisibleQuestions(service, { roadBlocked: "no" }).map((question) => question.id), ["approximateSize", "roadBlocked"]);
    assert.deepEqual(getVisibleQuestions(service, { roadBlocked: "yes" }).map((question) => question.id), ["approximateSize", "roadBlocked", "blockageDetails"]);
});

test("compatibility description includes only visible answered questions in display order", () => {
    const service = getServiceById("pothole");
    const description = formatCompatibilityDescription({ service, description: "Large pothole.", answers: { approximateSize: "2", roadBlocked: "no", blockageDetails: "stale" } });
    assert.equal(description, "Resident description:\nLarge pothole.\n\nAdditional details:\n- Approximate size in feet: 2\n- Is the roadway blocked?: No");
    assert.equal(description.includes("stale"), false);
});

test("compatibility mapper produces the exact legacy Issue shape without routing metadata", () => {
    const service = getServiceById("pothole");
    const category = getActiveCategories().find((item) => item.id === "roads");
    const mapped = mapIntakeToLegacyIssue({ category, service, answers: { roadBlocked: "no" }, description: "Road concern", location: " Main St ", reportingMode: "anonymous", reporterName: "", dateReported: "2026-08-29T18:00:00.000Z" });
    assert.deepEqual(mapped, { title: "Pothole", description: "Resident description:\nRoad concern\n\nAdditional details:\n- Is the roadway blocked?: No", category: "Road", priority: "Medium", status: "Open", reportedBy: "Anonymous", location: "Main St", dateReported: "2026-08-29T18:00:00.000Z" });
    assert.equal(mapped.departmentId, undefined);
    assert.equal(mapped.defaultGroup, undefined);
});
