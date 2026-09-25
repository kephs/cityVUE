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
}) {
  let hostname = "";
  try {
    hostname = new URL(draft.destination).hostname;
  } catch {
    /* Incomplete draft. */
  }
  const canManage =
    !readOnly &&
    issue?.canManageHandling &&
    issue.availability === "EXTERNAL_ONLY";
  return (
    <section className="issue-handling">
      <h3 className="h5">Availability</h3>
      {issue ? (
        <p>{availabilityLabels[issue.availability] || "Unavailable"}</p>
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
      <h3 className="h5">Handling</h3>
      {canManage ? (
        <fieldset disabled={disabled}>
          <legend className="h6">
            How should external requests be handled?
          </legend>
          {[
            ["internal_intake", "Collect the request in Reqro"],
            ["external_redirect", "Send the requester to another service"],
          ].map(([value, label]) => (
            <label className="d-block" key={value}>
              <input
                type="radio"
                name="issue-handling"
                checked={draft.actionType === value}
                onChange={() => set("actionType", value)}
              />{" "}
              {label}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>
          {draft.actionType === "external_redirect"
            ? "External Redirect"
            : "Reqro Intake"}
        </p>
      )}
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
    </section>
  );
}
