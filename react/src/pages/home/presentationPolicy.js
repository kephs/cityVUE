// Presentation allowlists, not authorization. Routes/APIs retain their guards.
const icons = Object.freeze({
  report: "actions/action-report.svg", emergency: "actions/action-emergency.svg",
  water: "actions/action-water.svg", residents: "benefits/benefit-residents.svg",
  responsive: "benefits/benefit-responsive.svg", operations: "benefits/benefit-operations.svg",
  community: "benefits/benefit-community.svg", moon: "ui/ui-theme-moon.svg",
});
export const iconAsset = (key) => Object.hasOwn(icons, key) ? `/branding/reqro/icons/${icons[key]}` : null;
export const themeChoice = (key) => key === "reqro" ? key : "reqro";
export const toneChoice = (key) => ["primary", "danger", "warning"].includes(key) ? key : "primary";
export const localAsset = (path) => typeof path === "string" && /^\/branding\/[a-zA-Z0-9_/-]+\.(png|svg|webp|avif|ico)$/.test(path) ? path : undefined;
export const orderedEnabled = (items = []) => items.filter((item) => item.enabled === true)
  .sort((a, b) => (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0));

export function actionHref({ actionType, target }) {
  if (typeof target !== "string" || /[\u0000-\u0020\u007f\\]/.test(target)) return null;
  if (actionType === "internal") return /^\/(?!\/)/.test(target) ? target : null;
  if (actionType === "phone") return /^\+?\d[\d().-]*$/.test(target) ? `tel:${target.replace(/[().-]/g, "")}` : null;
  if (actionType === "external") {
    try {
      const url = new URL(target);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  return null;
}
