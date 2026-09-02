export function mapIntakeToCreateServiceRequest({ service, answers, description, location, reportingMode, reporterName }) {
    const visibleIds = new Set((service.questions || []).map((question) => question.id));
    return {
        serviceDefinitionId: service.id,
        serviceDefinitionVersionId: service.serviceDefinitionVersionId,
        description: description.trim(),
        reportingIdentity: reportingMode,
        answers: Object.entries(answers).filter(([questionId, value]) => visibleIds.has(questionId) && value !== "").map(([questionId, value]) => {
            const question = service.questions.find((candidate) => candidate.id === questionId);
            let typedValue = value;
            if (question.type === "number") typedValue = Number(value);
            if (question.type === "yes-no") typedValue = value === "yes";
            return { questionId, value: typedValue };
        }),
        ...(reportingMode === "identified" ? { contact: { name: reporterName.trim() } } : {}),
        ...(location.trim() ? { location: { enteredAddress: location.trim(), locationType: "entered_address" } } : {})
    };
}
