import { homePresentation } from "./homePresentation.js";

// Generic packaged visuals only. The three-action reference is never a public fallback.
export const safeHomePresentation = Object.freeze({
  ...homePresentation,
  description: "Connect with community services and report a concern.",
  actions: Object.freeze(
    homePresentation.actions.filter(
      (action) =>
        action.actionType === "internal" && action.target === "/report",
    ),
  ),
});
