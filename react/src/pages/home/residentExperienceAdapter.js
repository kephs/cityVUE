import { safeHomePresentation } from "./safeHomePresentation.js";
import { themeChoice } from "./presentationPolicy.js";

// Role-specific packaged registry: DTO values can never become paths or CSS.
const assets = Object.freeze({
  logo: { key: "reqro-mark", path: safeHomePresentation.logo },
  wordmark: { key: "reqro-wordmark", path: safeHomePresentation.wordmark },
  favicon: { key: "reqro-favicon", path: safeHomePresentation.favicon },
  hero: { key: "reqro-scenery", path: safeHomePresentation.hero.image },
});
function invalid() {
  throw new Error("Invalid public resident experience");
}
function record(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
  return value;
}
function text(value, max, empty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[<>\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
  )
    invalid();
  return value;
}
function bool(value) {
  if (typeof value !== "boolean") invalid();
  return value;
}
function choice(value, allowed) {
  if (!allowed.includes(value)) invalid();
  return value;
}
function list(value, max) {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function id(value) {
  if (!/^[a-z][a-z0-9-]*$/.test(text(value, 48))) invalid();
  return value;
}
function order(value) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) invalid();
  return value;
}
function unique(items, ordered = false) {
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    (ordered && new Set(items.map((item) => item.order)).size !== items.length)
  )
    invalid();
  return ordered
    ? items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    : items;
}
function asset(key, role) {
  text(key, 48);
  const registered = Object.values(assets).find((entry) => entry.key === key);
  if (registered === assets[role]) return registered.path;
  // Unknown keys, including keys from another role, use only this role's fallback.
  return assets[role].path;
}
function destination(type, value) {
  const target = text(value, 2048);
  if (type === "internal") return choice(target, ["/", "/report"]);
  if (type === "phone") {
    if (!/^\+?[0-9]{2,15}$/.test(target)) invalid();
    return target;
  }
  let decoded = target;
  for (let depth = 0; depth < 5; depth++) {
    if (/[<>\\\p{Cc}\p{Cf}\p{Cs}]/u.test(decoded)) invalid();
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      invalid();
    }
    if (next === decoded) break;
    if (depth === 4) invalid();
    decoded = next;
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    invalid();
  }
  if (
    !target.startsWith("https://") ||
    /[\s\\]/u.test(target) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    target.slice(8).split(/[/?#]/)[0].includes("@")
  )
    invalid();
  const host = url.hostname.replace(/\.$/, "");
  // The server owns the full destination/IP policy; do not invent a second
  // narrower public URL contract here. Retain browser-side scheme/credential checks.
  if (/(^|\.)(localhost|local)$/.test(host)) invalid();
  return url.href;
}
function links(input) {
  return unique(
    list(input, 4).map((value) => {
      const link = record(value, ["id", "label", "actionType", "target"]);
      const type = choice(link.actionType, ["internal", "external"]);
      return {
        id: id(link.id),
        label: text(link.label, 80),
        actionType: type,
        target: destination(type, link.target),
      };
    }),
  );
}

/** Validate the entire wire object before constructing one complete provider value. */
export function adaptResidentExperience(value) {
  if (JSON.stringify(value)?.length > 65536) invalid();
  const dto = record(value, ["schemaVersion", "configuration"]);
  if (dto.schemaVersion !== 1) invalid();
  if (dto.configuration === null) return safeHomePresentation;
  const config = record(dto.configuration, [
    "presentation",
    "actions",
    "benefits",
  ]);
  const p = record(config.presentation, [
    "branding",
    "metadata",
    "navigation",
    "hero",
    "actionsTitle",
    "benefitsLabel",
    "footer",
  ]);
  const b = record(p.branding, [
    "applicationName",
    "organizationDisplayName",
    "logoKey",
    "wordmarkKey",
    "faviconKey",
    "themeKey",
  ]);
  const m = record(p.metadata, ["title", "description"]);
  const n = record(p.navigation, [
    "label",
    "homeSuffix",
    "menu",
    "openMenu",
    "closeMenu",
    "staff",
    "signIn",
    "signOut",
    "links",
  ]);
  const h = record(p.hero, [
    "taglineWords",
    "headline",
    "assetKey",
    "decorative",
    "alt",
  ]);
  const f = record(p.footer, [
    "tagline",
    "wordmarkKey",
    "showThemeToggle",
    "switchToDark",
    "switchToLight",
    "links",
  ]);
  const navigation = links(n.links);
  if (
    !navigation.length ||
    navigation[0].actionType !== "internal" ||
    navigation[0].target !== "/"
  )
    invalid();
  const words = list(h.taglineWords, 4).map((word) => text(word, 40));
  const headline = list(h.headline, 4).map((value) => {
    const s = record(value, ["text", "highlighted"]);
    return { text: text(s.text, 160), highlighted: bool(s.highlighted) };
  });
  if (
    !words.length ||
    !headline.length ||
    headline.reduce((sum, s) => sum + s.text.length, 0) > 200
  )
    invalid();
  const decorative = bool(h.decorative),
    alt = text(h.alt, 240, decorative);
  if (decorative && alt !== "") invalid();
  const actions = unique(
    list(config.actions, 6).map((value) => {
      const a = record(value, [
        "id",
        "enabled",
        "order",
        "iconKey",
        "title",
        "description",
        "ctaLabel",
        "actionType",
        "target",
        "tone",
      ]);
      const type = choice(a.actionType, ["internal", "external", "phone"]);
      const target = destination(type, a.target),
        label = text(a.ctaLabel, type === "phone" ? 113 : 80);
      if (
        type === "phone" &&
        label.replace(/\D/g, "") !== target.replace(/\D/g, "")
      )
        invalid();
      return {
        id: id(a.id),
        enabled: bool(a.enabled),
        order: order(a.order),
        iconKey: choice(a.iconKey, ["report", "emergency", "water"]),
        title: text(a.title, 100),
        description: text(a.description, 320),
        ctaLabel: label,
        actionType: type,
        target,
        tone: choice(a.tone, ["primary", "danger", "warning"]),
      };
    }),
    true,
  ).filter((a) => a.enabled);
  const benefits = unique(
    list(config.benefits, 4).map((value) => {
      const b = record(value, [
        "id",
        "enabled",
        "order",
        "iconKey",
        "title",
        "description",
      ]);
      return {
        id: id(b.id),
        enabled: bool(b.enabled),
        order: order(b.order),
        iconKey: choice(b.iconKey, [
          "residents",
          "responsive",
          "operations",
          "community",
        ]),
        title: text(b.title, 100),
        description: text(b.description, 240),
      };
    }),
    true,
  ).filter((b) => b.enabled);
  const appName = text(b.applicationName, 100);
  return {
    brandName:
      b.organizationDisplayName === null
        ? appName
        : text(b.organizationDisplayName, 100),
    logo: asset(b.logoKey, "logo"),
    wordmark: asset(b.wordmarkKey, "wordmark"),
    favicon: asset(b.faviconKey, "favicon"),
    wordmarkSize: { ...safeHomePresentation.wordmarkSize },
    title: text(m.title, 160),
    description: text(m.description, 320),
    theme: themeChoice(text(b.themeKey, 48)),
    navigation: {
      label: text(n.label, 80),
      homeSuffix: text(n.homeSuffix, 40),
      menu: text(n.menu, 40),
      openMenu: text(n.openMenu, 80),
      closeMenu: text(n.closeMenu, 80),
      staff: text(n.staff, 80),
      signIn: text(n.signIn, 80),
      signOut: text(n.signOut, 80),
      staffTarget: "/staff/requests",
      links: navigation,
    },
    tagline: {
      words,
      separator: safeHomePresentation.tagline.separator,
      separatorTone: "accent",
    },
    hero: {
      image: asset(h.assetKey, "hero"),
      width: 1920,
      height: 521,
      decorative,
      alt,
      headline,
    },
    actionsTitle: text(p.actionsTitle, 100),
    actions,
    benefitsLabel: text(p.benefitsLabel, 100),
    benefits,
    footer: {
      wordmark: asset(f.wordmarkKey, "wordmark"),
      message: text(f.tagline, 160),
      showThemeToggle: bool(f.showThemeToggle),
      switchToDark: text(f.switchToDark, 80),
      switchToLight: text(f.switchToLight, 80),
      links: links(f.links),
    },
  };
}
