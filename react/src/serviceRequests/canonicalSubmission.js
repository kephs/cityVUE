export function mapIntakeToCreateServiceRequest({
  service,
  answers,
  description,
  location,
  locationPoint,
  reportingMode,
  reporterName,
  attachments,
  participation,
}) {
  const visibleIds = new Set(
    (service.questions || [])
      .filter((question) => question.type !== "information")
      .map((question) => question.id),
  );
  return {
    ...(participation
      ? {
          participation: {
            state: participation.state,
            ...(participation.state === "PROVIDED"
              ? { areaId: participation.areaId }
              : {}),
          },
        }
      : {}),
    ...(attachments ? { attachments } : {}),
    serviceDefinitionId: service.id,
    serviceDefinitionVersionId: service.serviceDefinitionVersionId,
    description: description.trim(),
    reportingIdentity: reportingMode,
    answers: Object.entries(answers)
      .filter(
        ([questionId, value]) =>
          visibleIds.has(questionId) &&
          value !== "" &&
          (!Array.isArray(value) || value.length > 0),
      )
      .map(([questionId, value]) => {
        const question = service.questions.find(
          (candidate) => candidate.id === questionId,
        );
        let typedValue = value;
        if (question.type === "multi-select")
          return {
            questionId,
            optionKeys: question.options
              .filter(
                (option) =>
                  Array.isArray(value) && value.includes(option.value),
              )
              .map((option) => option.value),
          };
        if (question.type === "number") typedValue = Number(value);
        if (question.type === "yes-no") typedValue = value === "yes";
        return { questionId, value: typedValue };
      }),
    ...(reportingMode === "identified"
      ? { contact: { name: reporterName.trim() } }
      : {}),
    ...(location.trim()
      ? {
          location: {
            enteredAddress: location.trim(),
            locationType: locationPoint ? "other" : "entered_address",
            ...(locationPoint
              ? {
                  latitude: locationPoint.latitude,
                  longitude: locationPoint.longitude,
                }
              : {}),
          },
        }
      : {}),
  };
}
