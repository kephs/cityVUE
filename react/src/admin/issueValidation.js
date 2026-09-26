import { validQuestions } from "./FollowUpQuestions.jsx";
import { validHandoff } from "./IssueHandling.jsx";

export function creationErrors(draft) {
  const errors = [];
  const add = (key, selector, message) =>
    errors.push({ key, selector, message });
  if (!draft.category)
    add("category", '[role="combobox"]', "Select a Category.");
  const name = draft.name.trim(),
    description = draft.description.trim();
  const unsafe =
    /[<>\p{Cs}\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
  if (
    !name ||
    Array.from(name).length > 200 ||
    unsafe.test(name) ||
    /[\r\n\t]/u.test(name)
  )
    add(
      "name",
      "#issue-name",
      "Enter a plain-text Issue name of 1–200 characters.",
    );
  if (Array.from(description).length > 1000 || unsafe.test(description))
    add(
      "description",
      "#issue-description",
      "Use a plain-text description of no more than 1,000 characters.",
    );
  if (!["low", "medium", "high"].includes(draft.defaultPriority))
    add(
      "priority",
      "#issue-priority",
      "Select a Default Priority: Low, Medium or High.",
    );
  if (draft.copyExisting && (!draft.templateId || !draft.expectedSourceVersion))
    add(
      "source",
      '[name="issue-copy"]',
      draft.templateId
        ? "Refresh and review the changed source before creating this Issue."
        : "Select and review a source Issue, or start with a new configuration.",
    );
  if (!draft.availability)
    add(
      "availability",
      '[name="issue-availability"]',
      "Select where the Issue can be used.",
    );
  if (draft.actionType === "external_redirect") {
    if (draft.availability !== "EXTERNAL_ONLY")
      add(
        "handling",
        '[name="issue-handling"]',
        "Choose Reqro Intake, or select External only Availability.",
      );
    if (!draft.category?.canManageHandling)
      add(
        "authority",
        '[name="issue-availability"]',
        "Your access does not allow External Redirect for this Category. Choose Reqro Intake.",
      );
    if (!validHandoff({ ...draft, message: "Valid", label: "Continue" }))
      add(
        "destination",
        "#handoff-url",
        "Enter a valid HTTPS External Handoff destination without credentials.",
      );
    if (!draft.message.trim() || Array.from(draft.message.trim()).length > 500)
      add(
        "handoff-message",
        "#handoff-message",
        "Enter a handoff message of 1–500 characters.",
      );
    if (!draft.label.trim() || Array.from(draft.label.trim()).length > 80)
      add(
        "handoff-label",
        "#handoff-label",
        "Enter a handoff button label of 1–80 characters.",
      );
  }
  if (!draft.locationPolicy)
    add(
      "location",
      '[name="issue-location-policy"]',
      "Select a Service Location policy.",
    );
  if (!draft.geographicEligibilityMode)
    add(
      "geography",
      '[name="issue-geography"]',
      "Select Geographic Eligibility.",
    );
  if (!validQuestions(draft.questions))
    add(
      "questions",
      ".follow-up-questions input, .follow-up-questions textarea, .follow-up-questions button",
      "Complete the follow-up question prompts, choices and ordering.",
    );
  if (
    !/^\d+$/.test(draft.displayOrder) ||
    Number(draft.displayOrder) > 2147483647
  )
    add(
      "order",
      "#issue-order",
      "Enter a whole-number Display Order from 0 to 2147483647.",
    );
  return errors;
}

export function focusInvalid(form, error) {
  const node = form?.querySelector(error?.selector || '[role="alert"]');
  node?.focus();
  node?.scrollIntoView?.({ block: "center", behavior: "instant" });
}
