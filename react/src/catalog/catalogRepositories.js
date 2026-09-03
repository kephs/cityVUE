import { getActiveCategories, getServicesByCategory, getServiceById } from "./catalogService.js";

const accents = ["blue", "amber", "cyan", "green", "emerald"];
const iconClass = (key, fallback) => key ? `bi-${key.replace(/^bi-/, "")}` : fallback;

export function createFixtureCatalogRepository() {
    const initialCategories = getActiveCategories();
    return {
        mode: "legacy",
        notice: "Prototype data — sample issue catalog for development.",
        initialCategories,
        loadCategories: () => initialCategories,
        loadIssues: (categoryId) => getServicesByCategory(categoryId),
        loadDefinition: (serviceId) => getServiceById(serviceId)
    };
}

export function normalizeApiCategories(rows) {
    return rows.map((row, index) => ({ id: row.id, name: row.name, description: row.description, icon: iconClass(row.iconKey, "bi-grid"), accent: accents[index % accents.length], aliases: row.aliases || [], keywords: row.keywords || [], status: "active", displayOrder: index, departmentId: row.departmentId, departmentName: row.departmentName, divisionId: row.divisionId || null, divisionName: row.divisionName || null }));
}

export function normalizeApiIssues(rows, categoryId) {
    return rows.map((row) => ({ id: row.id, categoryId, name: row.name, citizenDescription: row.description, icon: iconClass(row.iconKey, "bi-megaphone"), aliases: row.aliases || [], keywords: row.keywords || [], status: "active" }));
}

export function normalizeApiDefinition(row, categoryId) {
    const keyToId = new Map((row.questions || []).map((question) => [question.key, question.id]));
    return {
        id: row.id, categoryId, serviceDefinitionVersionId: row.serviceDefinitionVersionId,
        name: row.name, citizenDescription: row.description, icon: iconClass(row.iconKey, "bi-megaphone"),
        defaultPriority: row.defaultPriority, locationRequirement: row.locationPolicy.replaceAll("_", "-"),
        anonymousPolicy: row.anonymousReportingPolicy.replaceAll("_", "-"), status: "active",
        questions: (row.questions || []).map((question, index) => ({
            id: question.id, key: question.key, label: question.label, helpText: question.helpText,
            type: question.type.replaceAll("_", "-"), required: question.required, displayOrder: index,
            options: (question.options || []).map((option) => ({ id: option.id, value: option.key, label: option.label })),
            visibilityRule: question.visibilityCondition ? { field: keyToId.get(question.visibilityCondition.questionKey), equals: question.visibilityCondition.value } : undefined
        }))
    };
}

export function createApiCatalogRepository(apiClient) {
    return {
        mode: "api", notice: "Local API mode — catalog loaded from CityVUE PostgreSQL.",
        loadCategories: async ({ signal } = {}) => normalizeApiCategories(await apiClient.get("/catalog/categories", { signal })),
        loadIssues: async (categoryId, { signal } = {}) => normalizeApiIssues(await apiClient.get(`/catalog/categories/${encodeURIComponent(categoryId)}/issues`, { signal }), categoryId),
        loadDefinition: async (serviceId, categoryId, { signal } = {}) => normalizeApiDefinition(await apiClient.get(`/catalog/issues/${encodeURIComponent(serviceId)}`, { signal }), categoryId)
    };
}
