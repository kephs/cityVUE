function FieldError({ id, message }) {
    return message ? <div className="invalid-feedback d-block" id={id}>{message}</div> : null;
}

function DynamicQuestion({ question, value = "", error, onChange }) {
    const common = {
        id: `question-${question.id}`,
        value,
        onChange: (event) => onChange(question.id, event.target.value),
        "aria-invalid": Boolean(error),
        "aria-errormessage": error ? `question-${question.id}-error` : undefined,
        className: `form-control${error ? " is-invalid" : ""}`,
        required: question.required
    };
    let control;
    if (question.type === "long-text") control = <textarea {...common} rows="4" />;
    else if (question.type === "single-select") control = <select {...common} className={`form-select${error ? " is-invalid" : ""}`}><option value="">Choose an option</option>{question.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    else if (question.type === "yes-no") control = <select {...common} className={`form-select${error ? " is-invalid" : ""}`}><option value="">Choose Yes or No</option><option value="yes">Yes</option><option value="no">No</option></select>;
    else control = <input {...common} type={question.type === "number" ? "number" : "text"} />;

    return <div className="mb-3"><label className="form-label" htmlFor={`question-${question.id}`}>{question.label} {question.required && <span aria-hidden="true">*</span>}</label>{question.helpText && <div className="form-text mb-2">{question.helpText}</div>}{control}<FieldError id={`question-${question.id}-error`} message={error} /></div>;
}

export default function IssueForm({ service, visibleQuestions, values, answers, errors, onValueChange, onAnswerChange, onContinue, onBack }) {
    const fieldProps = (name) => ({ id: name, value: values[name], onChange: (event) => onValueChange(name, event.target.value), "aria-invalid": Boolean(errors[name]), "aria-errormessage": errors[name] ? `${name}-error` : undefined, className: `form-control${errors[name] ? " is-invalid" : ""}` });
    const identified = values.reportingMode === "identified";
    return (
        <form noValidate onSubmit={(event) => { event.preventDefault(); onContinue(); }}>
            {visibleQuestions.length > 0 && <fieldset className="mb-4"><legend className="h5">A few details about {service.name}</legend>{visibleQuestions.map((question) => <DynamicQuestion key={question.id} question={question} value={answers[question.id]} error={errors[`question:${question.id}`]} onChange={onAnswerChange} />)}</fieldset>}
            <div className="mb-3"><label className="form-label" htmlFor="description">Tell us more about the concern <span aria-hidden="true">*</span></label><textarea {...fieldProps("description")} rows="5" required /><FieldError id="description-error" message={errors.description} /></div>
            {service.locationRequirement === "required" && <div className="mb-4"><label className="form-label" htmlFor="location">Location <span aria-hidden="true">*</span></label><input {...fieldProps("location")} type="text" placeholder="Enter the issue location" required /><FieldError id="location-error" message={errors.location} /></div>}
            <fieldset className="mb-4"><legend className="h5">How would you like to report this concern?</legend><div className="form-check mb-2"><input className="form-check-input" id="report-anonymous" type="radio" name="reportingMode" value="anonymous" checked={!identified} disabled={service.anonymousPolicy === "not-allowed"} onChange={(event) => onValueChange("reportingMode", event.target.value)} /><label className="form-check-label" htmlFor="report-anonymous">Report anonymously</label></div><div className="form-check"><input className="form-check-input" id="report-identified" type="radio" name="reportingMode" value="identified" checked={identified} onChange={(event) => onValueChange("reportingMode", event.target.value)} /><label className="form-check-label" htmlFor="report-identified">Provide my name</label></div>{service.anonymousPolicy === "not-allowed" && <p className="form-text">This service requires a reporter name.</p>}</fieldset>
            {identified && <div className="mb-4"><label className="form-label" htmlFor="reporterName">Your name <span aria-hidden="true">*</span></label><input {...fieldProps("reporterName")} type="text" required /><FieldError id="reporterName-error" message={errors.reporterName} /></div>}
            <p className="small text-body-secondary">Email updates and file attachments are not available in this prototype.</p>
            <div className="intake-actions action-footer"><button className="btn btn-outline-secondary" type="button" onClick={onBack}><i className="bi bi-arrow-left me-2" aria-hidden="true" />Back</button><button className="btn btn-primary" type="submit">Review request<i className="bi bi-arrow-right ms-2" aria-hidden="true" /></button></div>
        </form>
    );
}
