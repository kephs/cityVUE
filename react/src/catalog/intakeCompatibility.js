import { getVisibleQuestions } from "./catalogService.js";

function formatAnswer(question, value) {
    const option = question.options?.find((candidate) => candidate.value === value);
    if (option) return option.label;
    if (value === "yes") return "Yes";
    if (value === "no") return "No";
    return String(value ?? "").trim();
}

export function formatCompatibilityDescription({ service, answers, description }) {
    const lines = [`Resident description:\n${description.trim()}`];
    const answerLines = getVisibleQuestions(service, answers)
        .filter((question) => String(answers[question.id] ?? "").trim() !== "")
        .map((question) => `- ${question.label}: ${formatAnswer(question, answers[question.id])}`);

    if (answerLines.length) lines.push(`Additional details:\n${answerLines.join("\n")}`);
    return lines.join("\n\n");
}

export function mapIntakeToLegacyIssue({ category, service, answers, description, location, reportingMode, reporterName, dateReported }) {
    return {
        title: service.name,
        description: formatCompatibilityDescription({ service, answers, description }),
        category: category.legacyCategory,
        priority: service.defaultPriority || "Medium",
        status: "Open",
        reportedBy: reportingMode === "anonymous" ? "Anonymous" : reporterName.trim(),
        location: location.trim(),
        dateReported
    };
}
