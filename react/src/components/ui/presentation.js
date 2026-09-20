// Presentation only: these mappings never authorize an operation or transition.
export const statusPresentation = {
  open: { label: "Open", icon: "circle", tone: "open" },
  in_progress: { label: "In Progress", icon: "play-fill", tone: "work" },
  on_hold: { label: "On Hold", icon: "pause-fill", tone: "hold" },
  closed: { label: "Closed", icon: "check-lg", tone: "closed" },
  cancelled: { label: "Cancelled", icon: "slash-circle", tone: "cancelled" },
};
export const activityPresentation = {
  request_created: {
    label: "Request created",
    icon: "file-earmark-plus",
    tone: "created",
  },
  work_started: { label: "Work started", icon: "play-fill", tone: "work" },
  placed_on_hold: { label: "Placed on hold", icon: "pause-fill", tone: "hold" },
  work_resumed: { label: "Work resumed", icon: "play-fill", tone: "work" },
  request_closed: { label: "Request closed", icon: "check-lg", tone: "closed" },
  request_reopened: {
    label: "Request reopened",
    icon: "arrow-counterclockwise",
    tone: "open",
  },
  request_routed: {
    label: "Request routed",
    icon: "signpost-split",
    tone: "routing",
  },
  request_assigned: {
    label: "Request assigned",
    icon: "person-check",
    tone: "assignment",
  },
  request_reassigned: {
    label: "Request reassigned",
    icon: "people",
    tone: "assignment",
  },
  request_unassigned: {
    label: "Request unassigned",
    icon: "person-dash",
    tone: "assignment",
  },
  watcher_added: { label: "Watcher added", icon: "eye", tone: "watcher" },
  watcher_removed: {
    label: "Watcher removed",
    icon: "eye-slash",
    tone: "watcher",
  },
};

// Finite catalog vocabulary from existing catalog configuration, not Issue-name guesses.
const issueIcons = new Set([
  "file-earmark-text",
  "grid",
  "megaphone",
  "signpost-split",
  "lightbulb",
  "droplet",
  "recycle",
  "tree",
  "cone-striped",
  "water",
  "trash3",
  "tools",
  "building",
  "buildings",
  "sign-stop",
  "geo-alt",
  "exclamation-triangle",
]);
export function safeIssueIcon(value) {
  const key = typeof value === "string" ? value.replace(/^bi-/, "") : "";
  return issueIcons.has(key) ? `bi-${key}` : "bi-file-earmark-text";
}

export function normalizedStatus(value) {
  return typeof value === "string"
    ? value.toLowerCase().replaceAll(" ", "_")
    : "";
}
