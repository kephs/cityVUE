import { matchLegacyIssueToService } from "../../catalog/legacyIssueMatching.js";

export const GENERIC_ISSUE_ICON = "bi-file-earmark-text";

export function resolveIssueIcon(match) {
    return match?.service?.icon || match?.category?.icon || GENERIC_ISSUE_ICON;
}

export function getIssueIcon(issue) {
    return resolveIssueIcon(matchLegacyIssueToService(issue));
}
