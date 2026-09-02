import { describe, expect, test, vi } from "vitest";
import { createApiClient } from "../src/api/apiClient.js";
import { normalizeApiDefinition } from "../src/catalog/catalogRepositories.js";
import { readResidentIntakeConfig } from "../src/config/runtimeConfig.js";
import { createResidentIntakeRepositories } from "../src/residentIntake/residentIntakeRepositories.js";
import { mapIntakeToCreateServiceRequest } from "../src/serviceRequests/canonicalSubmission.js";

const id = (end) => `10000000-0000-4000-8000-${end.padStart(12, "0")}`;

describe("resident intake data access", () => {
    test("defaults to legacy and validates API configuration", () => {
        expect(readResidentIntakeConfig({}).dataSource).toBe("legacy");
        expect(() => readResidentIntakeConfig({ VITE_CITYVUE_DATA_SOURCE: "api" })).toThrow(/BASE_URL/);
        expect(readResidentIntakeConfig({ VITE_CITYVUE_DATA_SOURCE: "api", VITE_CITYVUE_API_BASE_URL: "http://localhost:3000/api/v1/" }).apiBaseUrl).toBe("http://localhost:3000/api/v1");
    });
    test("selects repositories without requiring an API in legacy mode", async () => {
        const legacy = createResidentIntakeRepositories({ environment: {}, saveIssue: vi.fn() });
        expect(legacy.mode).toBe("legacy"); expect(legacy.catalog.initialCategories.length).toBe(5);
        const fetchImplementation = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => [] }));
        const api = createResidentIntakeRepositories({ environment: { VITE_CITYVUE_DATA_SOURCE: "api", VITE_CITYVUE_API_BASE_URL: "http://localhost:3000/api/v1" }, fetchImplementation });
        await api.catalog.loadCategories(); expect(fetchImplementation).toHaveBeenCalledOnce();
    });
    test("retains canonical version/question IDs and maps typed answers", () => {
        const service = normalizeApiDefinition({ id: id("1"), serviceDefinitionVersionId: id("2"), name: "Pothole", description: "Road", defaultPriority: "medium", locationPolicy: "required", anonymousReportingPolicy: "allowed", questions: [{ id: id("3"), key: "size", label: "Size", type: "number", required: true, options: [] }, { id: id("4"), key: "blocked", label: "Blocked", type: "yes_no", required: true, options: [], visibilityCondition: { questionKey: "size", value: 3 } }] }, "category");
        expect(service.questions[1].visibilityRule.field).toBe(id("3"));
        expect(mapIntakeToCreateServiceRequest({ service, answers: { [id("3")]: "3", [id("4")]: "no" }, description: " Resident text ", location: " Main St ", reportingMode: "identified", reporterName: " Alex " })).toEqual({ serviceDefinitionId: id("1"), serviceDefinitionVersionId: id("2"), description: "Resident text", reportingIdentity: "identified", answers: [{ questionId: id("3"), value: 3 }, { questionId: id("4"), value: false }], contact: { name: "Alex" }, location: { enteredAddress: "Main St", locationType: "entered_address" } });
    });
    test("normalizes server and network errors without leaking response bodies", async () => {
        const conflict = createApiClient({ baseUrl: "http://api", fetchImplementation: async () => ({ ok: false, status: 404, headers: new Headers() }) });
        await expect(conflict.get("/x")).rejects.toMatchObject({ code: "catalog-version" });
        const offline = createApiClient({ baseUrl: "http://api", fetchImplementation: async () => { throw new TypeError("database secret"); } });
        await expect(offline.get("/x")).rejects.toMatchObject({ code: "network", message: expect.not.stringContaining("database secret") });
    });
});
