const copy = {
  "Change PUBLIC request ownership.":
    "Change who is responsible for public requests.",
  "Route PUBLIC requests within authorized scope.":
    "Move public requests between areas the staff member can work with.",
  "Submit staff-assisted requests through eligible catalog entries.":
    "Submit requests for available services on someone's behalf.",
  "Perform authorized INTERNAL operations.":
    "Perform allowed actions on internal requests.",
  "Issue, rotate and revoke PUBLIC tracking credentials.":
    "Create, replace or revoke tracking access for public requests.",
  "Read Organization administration configuration.":
    "View the organization's administration settings.",
  "Configure Organization intake settings.":
    "Manage how the organization receives requests.",
  "Configure Organization request reference numbering.":
    "Set up the organization's request reference numbers.",
  "Append eligible PUBLIC requester correspondence.":
    "Add correspondence to eligible public requests.",
  "Append staff-only request notes.": "Add staff-only notes to requests.",
  "Reserved AI administration authority.":
    "Access reserved for AI administrators.",
  "Inspect access configuration and history.":
    "View staff access settings and access history.",
  "Manage other staff operational access through governed commands.":
    "Manage access for other staff members.",
  "Read scoped Handling; Admin writes require additional permissions.":
    "View Issue Handling within the staff member's allowed areas. Changing it requires the permissions listed below.",
  "F057 authoring prerequisites; existing action-only scoped reads remain valid. Department and Division scope is separately enforced.":
    "The listed requirements apply when assigning this permission here. Staff who already have this permission can still view Handling within their allowed areas. Changes also depend on Department or Division access.",
  "Unified operations require INTERNAL read; legacy update-only admission is retained.":
    "Actions in the current request workspace also require Read internal requests. Earlier update tools retain their existing access rules.",
  "Requires the applicable PUBLIC or INTERNAL parent read permission and current request scope.":
    "The staff member must also be allowed to read the request, including access to its Department or Division where required.",
  "Provisioning controlled; no runtime delegation.":
    "Managed separately by an administrator; this permission cannot be assigned here.",
  "Read scoped, suppressed participation aggregates.":
    "View participation summaries for allowed areas, with small groups hidden to protect privacy.",
  "Disclose eligible requester contact with audit.":
    "View allowed requester contact details. Each view is recorded.",
  "Disclose historical submitted answers with audit.":
    "View previously submitted answers. Each view is recorded.",
  "Anonymous requests are ineligible; no delivery authority is implied.":
    "Not available for anonymous requests. This permission does not allow sending messages.",
  "No administration route is introduced.":
    "AI administration is not currently available in this interface.",
  "Deployment policy also applies.":
    "The organization's AI policy also applies.",
  "Read PUBLIC requests within operational scope.":
    "Read public requests within the staff member's allowed areas.",
  "Read INTERNAL requests within operational scope.":
    "Read internal requests within the staff member's allowed areas.",
};
export function accessText(text = "") {
  for (const [original, replacement] of Object.entries(copy))
    text = text.replaceAll(original, replacement);
  return text
    .replaceAll("PUBLIC", "public")
    .replaceAll("INTERNAL", "internal")
    .replace(
      "Anonymous contact remains prohibited.",
      "Contact details are unavailable for anonymous requests.",
    );
}
export function accessSource(managed, outside) {
  if (managed && outside)
    return [
      "Assigned from multiple sources",
      "You can remove the Access & Permissions assignment, but the staff member will still have this access from another source.",
    ];
  if (outside)
    return [
      "Assigned outside Access & Permissions",
      "This access is managed elsewhere and can't be changed here.",
    ];
  if (managed)
    return [
      "Managed in Access & Permissions",
      "You can change this access here.",
    ];
  return [
    "Not assigned",
    "Select this option to give the staff member this access.",
  ];
}
