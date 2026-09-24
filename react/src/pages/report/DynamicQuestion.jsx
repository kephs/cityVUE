export function displayAnswer(question, value) {
  if (question.type === "single-select")
    return question.options.find((o) => o.value === value)?.label ?? "";
  if (question.type === "yes-no")
    return value === true || value === "yes" ? "Yes" : "No";
  return String(value ?? "");
}
export default function DynamicQuestion({
  question,
  value = "",
  error,
  onChange,
}) {
  const id = `question-${question.id}`,
    help = `${id}-help`,
    errorId = `${id}-error`;
  const common = {
    id,
    value,
    onChange: (e) => onChange(question.id, e.target.value),
    required: question.required,
    "aria-invalid": Boolean(error),
    "aria-errormessage": error ? errorId : undefined,
    "aria-describedby":
      [question.helpText ? help : null, error ? errorId : null]
        .filter(Boolean)
        .join(" ") || undefined,
    className: `form-control${error ? " is-invalid" : ""}`,
  };
  const label = (
    <>
      {question.label}{" "}
      <span>{question.required ? "(Required)" : "(Optional)"}</span>
    </>
  );
  const assistance = (
    <>
      {question.helpText && (
        <p id={help} className="form-text">
          {question.helpText}
        </p>
      )}
      {error && (
        <p id={errorId} className="invalid-feedback d-block">
          {error}
        </p>
      )}
    </>
  );
  if (question.type === "yes-no")
    return (
      <fieldset className="mb-3" aria-describedby={common["aria-describedby"]}>
        <legend className="form-label">{label}</legend>
        {[
          ["yes", "Yes"],
          ["no", "No"],
        ].map(([v, l]) => (
          <label className="me-3" key={v}>
            <input
              type="radio"
              name={id}
              value={v}
              checked={value === v}
              required={question.required}
              aria-invalid={Boolean(error)}
              aria-errormessage={error ? errorId : undefined}
              onChange={() => onChange(question.id, v)}
            />{" "}
            {l}
          </label>
        ))}
        {assistance}
      </fieldset>
    );
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      {question.type === "long-text" ? (
        <textarea {...common} rows={4} maxLength={4000} />
      ) : question.type === "single-select" ? (
        <select {...common} className="form-select">
          <option value="">Choose an option</option>
          {question.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={question.type === "number" ? "number" : "text"}
          {...(question.type === "number"
            ? { step: "0.000001", min: -1000000000, max: 1000000000 }
            : { maxLength: 600 })}
        />
      )}
      {assistance}
    </div>
  );
}
