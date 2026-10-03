import { safeHomePresentation as p } from "../pages/home/safeHomePresentation.js";

// Blank authoring template: packaged generic content, no tenant contact defaults.
export function newResidentDraft() {
  return {
    schemaVersion: 1,
    presentation: {
      branding: {
        applicationName: p.brandName,
        organizationDisplayName: null,
        logoKey: "reqro-mark",
        wordmarkKey: "reqro-wordmark",
        faviconKey: "reqro-favicon",
        themeKey: "reqro",
      },
      metadata: { title: p.title, description: p.description },
      navigation: Object.fromEntries(
        Object.entries(structuredClone(p.navigation)).filter(
          ([key]) => key !== "staffTarget",
        ),
      ),
      hero: {
        taglineWords: [...p.tagline.words],
        headline: p.hero.headline.map((s) => ({
          text: s.text,
          highlighted: !!s.highlighted,
        })),
        assetKey: "reqro-scenery",
        decorative: true,
        alt: "",
      },
      actionsTitle: p.actionsTitle,
      benefitsLabel: p.benefitsLabel,
      footer: {
        tagline: p.footer.message,
        wordmarkKey: "reqro-wordmark",
        showThemeToggle: true,
        switchToDark: p.footer.switchToDark,
        switchToLight: p.footer.switchToLight,
        links: [],
      },
    },
    actions: [],
    benefits: structuredClone(p.benefits),
    contacts: [],
  };
}

export function normalizedPhone(display) {
  return display.replace(/[ ().-]/g, "");
}
export function draftErrors(draft) {
  const errors = [];
  for (const [label, rows] of [
    ["Actions", draft.actions],
    ["Benefits", draft.benefits],
  ]) {
    if (new Set(rows.map((r) => r.order)).size !== rows.length)
      errors.push(`${label}: use unique order numbers.`);
    if (rows.some((r) => !r.title.trim() || !r.description.trim()))
      errors.push(`${label}: title and description are required.`);
  }
  if (!draft.presentation.branding.applicationName.trim())
    errors.push("Public application name is required.");
  if (
    draft.actions.some(
      (a) =>
        !a.ctaLabel.trim() ||
        (a.actionType === "external" && !/^https:\/\//.test(a.target || "")) ||
        (a.actionType === "phone" &&
          !draft.contacts.some((c) => c.id === a.contactId)),
    )
  )
    errors.push("Actions need a CTA label and a valid destination or contact.");
  if (
    draft.contacts.some(
      (c) =>
        !/^\+?[0-9]{2,15}$/.test(c.phoneTarget) ||
        c.phoneTarget !== normalizedPhone(c.displayValue),
    )
  )
    errors.push(
      "Contacts need a valid phone number; its dialing target must match.",
    );
  return errors;
}
