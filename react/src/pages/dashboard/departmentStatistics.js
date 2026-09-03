import { serviceCatalog } from "../../catalog/serviceCatalog.js";

export const UNASSIGNED_DEPARTMENT = "Unassigned Department";

export function resolveIssueDepartment(issue, catalog = serviceCatalog) {
    const legacyCategory = typeof issue?.category === "string" ? issue.category.trim() : "";
    if (!legacyCategory) return UNASSIGNED_DEPARTMENT;

    const matchingCategories = (catalog?.categories || []).filter((category) =>
        category?.status === "active" && category.legacyCategory === legacyCategory
    );
    if (matchingCategories.length !== 1) return UNASSIGNED_DEPARTMENT;

    const category = matchingCategories[0];
    const owningDepartmentId = category.divisionId
        ? (catalog?.divisions || []).find((division) =>
            division?.id === category.divisionId && division.departmentId === category.departmentId
        )?.departmentId
        : category.departmentId;
    if (!owningDepartmentId) return UNASSIGNED_DEPARTMENT;

    const matchingDepartments = (catalog?.departments || []).filter((department) =>
        department?.status === "active" && department.id === owningDepartmentId
    );

    return matchingDepartments.length === 1
        ? matchingDepartments[0].name
        : UNASSIGNED_DEPARTMENT;
}

export function getDepartmentCounts(issues, catalog = serviceCatalog) {
    const counts = (issues || []).reduce((result, issue) => {
        const department = resolveIssueDepartment(issue, catalog);
        result.set(department, (result.get(department) || 0) + 1);
        return result;
    }, new Map());

    return [...counts.entries()]
        .map(([department, count]) => ({ department, count }))
        .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));
}
