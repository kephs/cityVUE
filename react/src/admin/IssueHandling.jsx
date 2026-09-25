export const availabilityLabels = {
  INTERNAL_ONLY: "Internal only",
  EXTERNAL_ONLY: "External only",
  INTERNAL_AND_EXTERNAL: "Internal and external",
};
export function handlingPayload(draft) {
  return draft.actionType === "external_redirect"
    ? {
        actionType: draft.actionType,
        destination: draft.destination,
        message: draft.message.trim(),
        label: draft.label.trim(),
      }
    : { actionType: "internal_intake" };
}
export function validHandoff(draft) {
  if (draft.actionType !== "external_redirect") return true;
  try {
    const url = new URL(draft.destination);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      draft.destination.length <= 2048 &&
      url.href.length <= 2048 &&
      !/[\s\\]/u.test(draft.destination) &&
      !!draft.message.trim() &&
      Array.from(draft.message.trim()).length <= 500 &&
      !!draft.label.trim() &&
      Array.from(draft.label.trim()).length <= 80
    );
  } catch {
    return false;
  }
}
export default function IssueHandling({
  issue,
  draft,
  set,
  disabled,
  readOnly = false,
  creationCapability = false,
  creationCategorySelected = false,
  creationPolicies = null,
}) {
  let hostname = "";
  try {
    hostname = new URL(draft.destination).hostname;
  } catch {
    /* Incomplete draft. */
  }
  const canManage =
    !readOnly &&
    (issue ? issue.canManageHandling : creationCapability) &&
    (issue ? issue.availability : draft.availability) === "EXTERNAL_ONLY";
  return (
    <section className="issue-handling">
      <h4 className="h5">Availability</h4>
      {issue ? (
        <div className="issue-availability-summary">
          <strong>
            {availabilityLabels[issue.availability] || "Unavailable"}
          </strong>
          <p>Availability is set when the Issue is created.</p>
        </div>
      ) : (
        <fieldset disabled={disabled}>
          <legend className="h6">Where can this Issue be used?</legend>
          {Object.entries(availabilityLabels).map(([value, label]) => (
            <label className="d-block" key={value}>
              <input
                required
                type="radio"
                name="issue-availability"
                checked={draft.availability === value}
                onChange={() => set("availability", value)}
              />{" "}
              {label}
            </label>
          ))}
          <p>Choose once when creating the Issue.</p>
        </fieldset>
      )}
      <h4 className="h5">Handling</h4>
      {canManage ? (
        <fieldset disabled={disabled}>
          <legend className="h6">
            How should external requests be handled?
          </legend>
          {[
            ["internal_intake", "Collect the request in Reqro"],
            ["external_redirect", "Send the requester to another service"],
          ].map(([value, label]) => (
            <label
              className={`issue-handling-choice${draft.actionType === value ? " is-selected" : ""}`}
              key={value}
            >
              <input
                type="radio"
                name="issue-handling"
                checked={draft.actionType === value}
                onChange={() => set("actionType", value)}
              />{" "}
              {label}
              {draft.actionType === value && (
                <span className="issue-handling-selected" aria-hidden="true">
                  ✓ Selected
                </span>
              )}
            </label>
          ))}
        </fieldset>
      ) : !issue && !readOnly ? (
        <p>
          {!draft.availability
            ? "Choose Availability above to see the available Handling options."
            : draft.availability !== "EXTERNAL_ONLY"
              ? "Internal only and Internal and external Issues use Reqro Intake. External Redirect is available only for External only Issues."
              : !creationCategorySelected
                ? "Select a Category under General to check available Handling options."
                : "Your current access does not allow External Redirect configuration for this Category."}
        </p>
      ) : null}
      <div className="issue-handling-summary">
        <strong>
          <span aria-hidden="true">
            {draft.actionType === "external_redirect" ? "↗ " : "✓ "}
          </span>
          {draft.actionType === "external_redirect"
            ? "External Redirect"
            : "Reqro Intake"}
        </strong>
        <p>
          {draft.actionType === "external_redirect"
            ? "Users continue in an external service."
            : "Requests are created and managed in Reqro."}
        </p>
      </div>
      {draft.actionType === "external_redirect" && (
        <>
          <p>
            People will see a handoff page before continuing to the external
            service.
          </p>
          <p>
            Existing follow-up questions are retained but are not shown while
            this Issue redirects to another service.
          </p>
          {canManage && (
            <fieldset disabled={disabled}>
              <legend className="h6">External handoff</legend>
              <label htmlFor="handoff-url">Destination URL</label>
              <input
                className="form-control"
                id="handoff-url"
                type="url"
                required
                maxLength={2048}
                value={draft.destination}
                onChange={(e) => set("destination", e.target.value)}
                aria-describedby="handoff-validation"
              />
              <label htmlFor="handoff-message">Handoff message</label>
              <textarea
                className="form-control"
                id="handoff-message"
                required
                maxLength={500}
                value={draft.message}
                onChange={(e) => set("message", e.target.value)}
                aria-describedby="handoff-message-help handoff-validation"
              />
              <p id="handoff-message-help">
                Briefly explain why this request continues on another website.
              </p>
              <label htmlFor="handoff-label">Button label</label>
              <input
                className="form-control"
                id="handoff-label"
                required
                maxLength={80}
                value={draft.label}
                onChange={(e) => set("label", e.target.value)}
                aria-describedby="handoff-validation"
              />
              <p id="handoff-validation">
                {validHandoff(draft)
                  ? "The destination will be validated when you save."
                  : "Enter a valid HTTPS destination, handoff message and button label."}
              </p>
            </fieldset>
          )}
          {hostname && (
            <p>
              Destination:{" "}
              <strong style={{ overflowWrap: "anywhere" }}>{hostname}</strong>
            </p>
          )}
        </>
      )}
      {creationPolicies}
    </section>
  );
}
