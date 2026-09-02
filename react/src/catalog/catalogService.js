import { serviceCatalog } from "./serviceCatalog.js";

export function getCatalogNotice() {
    return serviceCatalog.fixtureNotice;
}

export function getActiveCategories() {
    return serviceCatalog.categories
        .filter((category) => category.status === "active")
        .sort((a, b) => a.displayOrder - b.displayOrder);
}

export function searchCategories(query = "", categories = getActiveCategories()) {
    const normalizedQuery = String(query).trim().toLowerCase();
    const activeCategories = [...categories]
        .filter((category) => category?.status === "active")
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    if (!normalizedQuery) return activeCategories;

    return activeCategories.filter((category) => [
        category.name,
        category.description,
        ...(category.keywords || []),
        ...(category.aliases || [])
    ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));
}

export function getServicesByCategory(categoryId) {
    return serviceCatalog.services.filter((service) => service.status === "active" && service.categoryId === categoryId);
}

export function getServiceById(serviceId) {
    return serviceCatalog.services.find((service) => service.status === "active" && service.id === serviceId) || null;
}

export function getCategoryById(categoryId) {
    return getActiveCategories().find((category) => category.id === categoryId) || null;
}

export function searchServices(categoryId, query = "") {
    const normalizedQuery = String(query).trim().toLowerCase();
    const services = getServicesByCategory(categoryId);
    if (!normalizedQuery) return services;

    return services.filter((service) => [
        service.name,
        service.citizenDescription,
        ...(service.keywords || []),
        ...(service.aliases || [])
    ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));
}

export function isQuestionVisible(question, answers = {}) {
    if (!question.visibilityRule) return true;
    return answers[question.visibilityRule.field] === question.visibilityRule.equals;
}

export function getVisibleQuestions(service, answers = {}) {
    return [...(service?.questions || [])]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .filter((question) => isQuestionVisible(question, answers));
}
