import DynamicQuestion from "./DynamicQuestion.jsx";
import ServiceLocationInput from "../../residentIntake/ServiceLocationInput.jsx";
function FieldError({ id, message }) {
  return message ? (
    <div className="invalid-feedback d-block" id={id}>
      {message}
    </div>
  ) : null;
}

export default function IssueForm({
  service,
  visibleQuestions,
  values,
  answers,
  errors,
  onValueChange,
  onAnswerChange,
  onContinue,
  onBack,
  locationRepository,
  onLocationChange,
  attachmentControls,
  participationControls,
  attachmentsReady = true,
  continueLabel = "Review request",
}) {
  const fieldProps = (name) => ({
    id: name,
    value: values[name],
    onChange: (event) => onValueChange(name, event.target.value),
    "aria-invalid": Boolean(errors[name]),
    "aria-errormessage": errors[name] ? `${name}-error` : undefined,
    className: `form-control${errors[name] ? " is-invalid" : ""}`,
  });
  const identified = values.reportingMode === "identified";
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      {visibleQuestions.length > 0 && (
        <fieldset className="mb-4">
          <legend className="h5">A few details about {service.name}</legend>
          {visibleQuestions.map((question) => (
            <DynamicQuestion
              key={question.id}
              question={question}
              value={answers[question.id]}
              error={errors[`question:${question.id}`]}
              onChange={onAnswerChange}
            />
          ))}
        </fieldset>
      )}
      <div className="mb-3">
        <label className="form-label" htmlFor="description">
          Tell us more about the concern <span aria-hidden="true">*</span>
        </label>
        <textarea {...fieldProps("description")} rows="5" required />
        <FieldError id="description-error" message={errors.description} />
      </div>
      {onLocationChange && service.locationRequirement !== "not-applicable" ? (
        <ServiceLocationInput
          repository={locationRepository}
          text={values.location}
          point={values.locationPoint}
          onChange={onLocationChange}
          required={service.locationRequirement === "required"}
          geographicPolicy={service.geographicEligibilityMode}
          error={errors.location}
        />
      ) : (
        service.locationRequirement === "required" && (
          <div className="mb-4">
            <label className="form-label" htmlFor="location">
              Location <span aria-hidden="true">*</span>
            </label>
            <input
              {...fieldProps("location")}
              type="text"
              placeholder="Enter the issue location"
              required
            />
            <FieldError id="location-error" message={errors.location} />
          </div>
        )
      )}
      <fieldset
        className="mb-4"
        aria-describedby="requester-identity-help"
        aria-invalid={Boolean(errors.reportingMode)}
        aria-errormessage={
          errors.reportingMode ? "reportingMode-error" : undefined
        }
      >
        <legend className="h5">
          How would you like to report this concern?
        </legend>
        {service.anonymousPolicy !== "not-allowed" && (
          <div className="form-check mb-2">
            <input
              className="form-check-input"
              id="report-anonymous"
              type="radio"
              name="reportingMode"
              value="anonymous"
              checked={values.reportingMode === "anonymous"}
              onChange={(event) =>
                onValueChange("reportingMode", event.target.value)
              }
            />
            <label className="form-check-label" htmlFor="report-anonymous">
              Report anonymously
            </label>
          </div>
        )}
        <div className="form-check">
          <input
            className="form-check-input"
            id="report-identified"
            type="radio"
            name="reportingMode"
            value="identified"
            checked={identified}
            onChange={(event) =>
              onValueChange("reportingMode", event.target.value)
            }
          />
          <label className="form-check-label" htmlFor="report-identified">
            Provide my name
          </label>
        </div>
        {service.anonymousPolicy === "not-allowed" && (
          <p className="form-text">This issue requires a reporter name.</p>
        )}
        <p id="requester-identity-help" className="form-text">
          {service.anonymousPolicy === "not-allowed"
            ? "Contact information is required for this Issue. Your name is required; email is optional."
            : "Choose whether to provide contact information. If you submit anonymously, requester Contact will not be collected. Avoid identifying yourself in the description or evidence if you want to remain anonymous."}
        </p>
        {errors.reportingMode && (
          <div role="alert">
            <FieldError
              id="reportingMode-error"
              message={errors.reportingMode}
            />
          </div>
        )}
      </fieldset>
      {identified && (
        <div className="mb-4">
          <label className="form-label" htmlFor="reporterName">
            Your name <span aria-hidden="true">*</span>
          </label>
          <input {...fieldProps("reporterName")} type="text" required />
          <FieldError id="reporterName-error" message={errors.reporterName} />
        </div>
      )}
      {participationControls}
      {attachmentControls}
      <p className="small text-body-secondary">
        Email updates are not available in this prototype.
      </p>
      <div className="intake-actions action-footer">
        <button
          className="btn btn-outline-secondary"
          type="button"
          onClick={onBack}
        >
          <i className="bi bi-arrow-left me-2" aria-hidden="true" />
          Back
        </button>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!attachmentsReady}
        >
          {continueLabel}
          <i className="bi bi-arrow-right ms-2" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
