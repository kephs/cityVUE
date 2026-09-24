import { useRef, useState } from "react";
export const questionTypeLabels = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  yes_no: "Yes / No",
  single_select: "Single choice",
};
export const questionPayload = (questions) =>
  questions.map(({ key, prompt, help, type, required, order, options }) => ({
    key,
    prompt,
    help,
    type,
    required,
    order: Number(order),
    options: options.map(({ key, label, order }) => ({
      key,
      label,
      order: Number(order),
    })),
  }));
const validOrder = (x) => /^\d+$/.test(String(x)) && Number(x) <= 2147483647;
export function validQuestions(questions) {
  const unique = (xs) => new Set(xs).size === xs.length;
  return (
    questions.length <= 25 &&
    questions.reduce((n, q) => n + q.options.length, 0) <= 200 &&
    new TextEncoder().encode(JSON.stringify(questionPayload(questions)))
      .length <= 65536 &&
    unique(questions.map((q) => Number(q.order))) &&
    questions.every(
      (q) =>
        q.prompt.trim() &&
        [...q.prompt.trim()].length <= 200 &&
        [...q.help.trim()].length <= 500 &&
        validOrder(q.order) &&
        questionTypeLabels[q.type] &&
        (q.type === "single_select"
          ? q.options.length >= 2 && q.options.length <= 25
          : q.options.length === 0) &&
        unique(q.options.map((o) => o.label.trim().toLowerCase())) &&
        unique(q.options.map((o) => Number(o.order))) &&
        q.options.every(
          (o) =>
            o.label.trim() &&
            [...o.label.trim()].length <= 100 &&
            validOrder(o.order),
        ),
    )
  );
}
export default function FollowUpQuestions({
  questions,
  onChange,
  disabled = false,
  readOnly = false,
}) {
  const [editing, setEditing] = useState(null),
    summary = useRef(null);
  const update = (i, change) =>
    onChange(questions.map((q, n) => (n === i ? { ...q, ...change } : q)));
  const add = () => {
    onChange([
      ...questions,
      {
        key: null,
        prompt: "",
        help: "",
        type: "short_text",
        required: false,
        order: Math.max(-1, ...questions.map((q) => Number(q.order))) + 1,
        options: [],
        condition: null,
      },
    ]);
    setEditing(questions.length);
  };
  const finish = () => {
    setEditing(null);
    summary.current?.focus();
  };
  return (
    <section
      className="my-4"
      aria-labelledby="follow-up-heading"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3 id="follow-up-heading" ref={summary} tabIndex={-1}>
        Follow-up questions
      </h3>
      <p>Ask for additional information needed to handle this Issue.</p>
      <p>
        Lower numbers appear first. Each question and each option must have a
        different order number.
      </p>
      <ol className="list-unstyled">
        {questions.map((q, i) => {
          const dependents = questions.filter(
            (x) => x.condition?.questionKey === q.key && q.key !== null,
          );
          const changeOption = (n, change) =>
            update(i, {
              options: q.options.map((o, k) =>
                k === n ? { ...o, ...change } : o,
              ),
            });
          return (
            <li key={q.key ?? `new-${i}`} className="border rounded p-3 mb-3">
              <strong>{q.prompt || "New question"}</strong>
              <p>
                {questionTypeLabels[q.type]} ·{" "}
                {q.required ? "Required" : "Optional"} · Order {q.order}
                {q.type === "single_select"
                  ? ` · ${q.options.length} options`
                  : ""}
              </p>
              {q.condition && <p>Conditional behavior inherited</p>}
              {!readOnly && (
                <div className="d-flex gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    disabled={disabled}
                    aria-label={`Edit question ${i + 1}`}
                    onClick={() => setEditing(i)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    disabled={disabled}
                    aria-label={`Change order for question ${i + 1}`}
                    onClick={() => {
                      setEditing(i);
                      setTimeout(
                        () =>
                          document.getElementById(`follow-${i}-order`)?.focus(),
                        0,
                      );
                    }}
                  >
                    Change order
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    disabled={disabled || dependents.length > 0}
                    aria-label={`Remove question ${i + 1}`}
                    onClick={() => {
                      onChange(questions.filter((_, n) => n !== i));
                      setEditing(null);
                    }}
                  >
                    Remove question
                  </button>
                </div>
              )}
              {dependents.length > 0 && (
                <p className="form-text">
                  This question is used by inherited conditional behavior and
                  cannot be removed.
                </p>
              )}
              {!readOnly && editing === i && (
                <fieldset disabled={disabled} className="mt-3">
                  <legend className="h5">Edit follow-up question</legend>
                  <label htmlFor={`follow-${i}-type`}>Type</label>
                  <select
                    className="form-select"
                    id={`follow-${i}-type`}
                    value={q.type}
                    disabled={q.key !== null}
                    onChange={(e) =>
                      update(i, { type: e.target.value, options: [] })
                    }
                  >
                    {Object.entries(questionTypeLabels).map(
                      ([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                  <label htmlFor={`follow-${i}-prompt`}>Question</label>
                  <input
                    className="form-control"
                    id={`follow-${i}-prompt`}
                    value={q.prompt}
                    required
                    aria-describedby="follow-up-validation"
                    onChange={(e) => update(i, { prompt: e.target.value })}
                  />
                  <label htmlFor={`follow-${i}-help`}>Help text</label>
                  <textarea
                    className="form-control"
                    id={`follow-${i}-help`}
                    value={q.help}
                    onChange={(e) => update(i, { help: e.target.value })}
                  />
                  <label className="d-block my-2">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) =>
                        update(i, { required: e.target.checked })
                      }
                    />{" "}
                    Required
                  </label>
                  <label htmlFor={`follow-${i}-order`}>Display order</label>
                  <input
                    className="form-control"
                    id={`follow-${i}-order`}
                    type="number"
                    min="0"
                    max="2147483647"
                    step="1"
                    value={q.order}
                    onChange={(e) => update(i, { order: e.target.value })}
                  />
                  {q.type === "single_select" && (
                    <fieldset className="mt-3">
                      <legend className="h6">Options</legend>
                      {q.options.map((o, n) => (
                        <div
                          key={o.key ?? `new-${n}`}
                          className="border rounded p-2 mb-2"
                        >
                          <label htmlFor={`follow-${i}-option-${n}`}>
                            Option {n + 1}
                          </label>
                          <input
                            className="form-control"
                            id={`follow-${i}-option-${n}`}
                            value={o.label}
                            onChange={(e) =>
                              changeOption(n, { label: e.target.value })
                            }
                          />
                          <label htmlFor={`follow-${i}-option-order-${n}`}>
                            Option display order
                          </label>
                          <input
                            className="form-control"
                            id={`follow-${i}-option-order-${n}`}
                            type="number"
                            min="0"
                            step="1"
                            value={o.order}
                            onChange={(e) =>
                              changeOption(n, { order: e.target.value })
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-outline-danger mt-2"
                            disabled={
                              o.key !== null &&
                              dependents.some(
                                (d) => d.condition.value === o.key,
                              )
                            }
                            onClick={() =>
                              update(i, {
                                options: q.options.filter((_, k) => k !== n),
                              })
                            }
                          >
                            Remove option {n + 1}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={q.options.length >= 25}
                        onClick={() =>
                          update(i, {
                            options: [
                              ...q.options,
                              {
                                key: null,
                                label: "",
                                order:
                                  Math.max(
                                    -1,
                                    ...q.options.map((o) => Number(o.order)),
                                  ) + 1,
                              },
                            ],
                          })
                        }
                      >
                        Add option
                      </button>
                    </fieldset>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary mt-3"
                    onClick={finish}
                  >
                    Done editing question
                  </button>
                </fieldset>
              )}
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || questions.length >= 25}
            onClick={add}
          >
            Add question
          </button>
          <p
            id="follow-up-validation"
            role={validQuestions(questions) ? undefined : "alert"}
          >
            {validQuestions(questions)
              ? "Question changes are saved only when you choose Save changes."
              : "Check question text, unique order numbers and options. Use 2–25 distinct options for each choice question. Prompts allow 200 characters, help 500 and option labels 100."}
          </p>
        </>
      )}
    </section>
  );
}
