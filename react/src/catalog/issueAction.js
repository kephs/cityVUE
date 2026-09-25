export function normalizeIssueAction(row) {
  const actionType = row.actionType ?? "internal_intake";
  if (actionType === "internal_intake")
    return { actionType, actionRevision: row.actionRevision };
  const destination = row.redirect?.destination;
  if (
    actionType !== "external_redirect" ||
    typeof destination !== "string" ||
    !destination.startsWith("https://") ||
    destination[8] === "/" ||
    destination.slice(8).split(/[/?#]/)[0]?.includes("@") ||
    /[\s\\\u0000-\u001f\u007f]/u.test(destination) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(destination)
  )
    throw new Error("This service is temporarily unavailable.");
  let url;
  try {
    url = new URL(destination);
  } catch {
    throw new Error("This service is temporarily unavailable.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error("This service is temporarily unavailable.");
  return {
    actionType,
    actionRevision: row.actionRevision,
    redirect: {
      destination: url.href,
      hostname: url.hostname,
      message:
        row.redirect.message ||
        "This service is handled through another online service.",
      label: row.redirect.label || "Continue to External Service",
    },
  };
}
