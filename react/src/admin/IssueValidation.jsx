import { useEffect } from "react";
import { focusInvalid } from "./issueValidation.js";

export default function IssueValidation({ errors, form }) {
  // Associate inline messages with dynamically authored controls as well as fixed fields.
  useEffect(() => {
    const originals = new Map();
    const messages = [];
    for (const error of errors) {
      const controls = [
        ...(form.current?.querySelectorAll(error.selector) || []),
      ];
      const control = controls[0];
      if (!control) continue;
      const id = `issue-error-${error.key}`;
      for (const node of control.type === "radio" ? controls : [control]) {
        if (!originals.has(node))
          originals.set(node, {
            described: node.getAttribute("aria-describedby"),
            invalid: node.getAttribute("aria-invalid"),
          });
        node.setAttribute(
          "aria-describedby",
          [node.getAttribute("aria-describedby"), id].filter(Boolean).join(" "),
        );
        node.setAttribute("aria-invalid", "true");
      }
      const message = document.createElement("p");
      message.id = id;
      message.className = "issue-field-error";
      message.textContent = error.message;
      const anchor =
        control.type === "radio" ? control.closest("fieldset") : control;
      anchor?.insertAdjacentElement("afterend", message);
      messages.push(message);
    }
    return () => {
      messages.forEach((message) => message.remove());
      for (const [control, previous] of originals) {
        if (previous.described === null)
          control.removeAttribute("aria-describedby");
        else control.setAttribute("aria-describedby", previous.described);
        if (previous.invalid === null) control.removeAttribute("aria-invalid");
        else control.setAttribute("aria-invalid", previous.invalid);
      }
    };
  }, [errors, form]);
  if (!errors.length) return null;
  return (
    <div className="issue-validation-summary" role="alert" tabIndex={-1}>
      <p>Complete the required information before creating this Issue.</p>
      <ul>
        {errors.map((error) => (
          <li key={error.key}>
            <button
              type="button"
              className="btn btn-link"
              onClick={() => focusInvalid(form.current, error)}
            >
              {error.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
