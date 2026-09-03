export function normalizeServiceRequestListRow(row) {
    return {
        id: row.serviceRequestId, referenceNumber: row.referenceNumber, issueName: row.issueName,
        department: { id: row.departmentId, name: row.departmentName },
        division: row.divisionId ? { id: row.divisionId, name: row.divisionName } : null,
        category: { id: row.categoryId, name: row.categoryName }, priority: row.priority,
        status: row.status, reportedAt: row.createdAt, source: "canonical"
    };
}

export function canonicalListQuery(filters, sort, page, pageSize = 25) {
    return { search: filters.search, department: filters.department, division: filters.division, category: filters.category,
        priority: filters.priority, status: filters.status, sort, page, pageSize };
}
