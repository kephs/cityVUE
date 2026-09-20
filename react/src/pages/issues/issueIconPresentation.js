import { safeIssueIcon } from "../../components/ui/presentation.js";
import { matchLegacyIssueToService } from "../../catalog/legacyIssueMatching.js";

export const GENERIC_ISSUE_ICON = "bi-file-earmark-text";

export function resolveIssueIcon(match) {
    return safeIssueIcon(match?.service?.icon || match?.category?.icon);
}

export function getIssueIcon(issue) {
    return issue?.iconKey ? safeIssueIcon(issue.iconKey) : resolveIssueIcon(matchLegacyIssueToService(issue));
}
