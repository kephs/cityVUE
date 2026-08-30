import { getActiveCategories, getServicesByCategory } from "./catalogService.js";

export function matchLegacyIssueToService(issue) {
    if (!issue || typeof issue !== "object") return null;
    const title = typeof issue.title === "string" ? issue.title.trim() : "";
    const legacyCategory = typeof issue.category === "string" ? issue.category.trim() : "";
    if (!title || !legacyCategory) return null;

    const matches = getActiveCategories().flatMap((category) =>
        category.legacyCategory === legacyCategory
            ? getServicesByCategory(category.id)
                .filter((service) => service.name === title)
                .map((service) => ({ category, service }))
            : []
    );

    return matches.length === 1 ? matches[0] : null;
}
