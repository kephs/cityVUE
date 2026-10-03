import { homePresentation as reference } from "../../src/pages/home/homePresentation.js";

// Explicit test/reference publication; never imported by runtime fallback code.
export function publishedExperienceFixture() {
  return {
    schemaVersion: 1,
    configuration: {
      presentation: {
        branding: {
          applicationName: reference.brandName,
          organizationDisplayName: null,
          logoKey: "reqro-mark",
          wordmarkKey: "reqro-wordmark",
          faviconKey: "reqro-favicon",
          themeKey: "reqro",
        },
        metadata: {
          title: reference.title,
          description: reference.description,
        },
        navigation: Object.fromEntries(
          Object.entries(structuredClone(reference.navigation)).filter(
            ([key]) => key !== "staffTarget",
          ),
        ),
        hero: {
          taglineWords: [...reference.tagline.words],
          headline: reference.hero.headline.map((s) => ({
            text: s.text,
            highlighted: s.highlighted === true,
          })),
          assetKey: "reqro-scenery",
          decorative: true,
          alt: "",
        },
        actionsTitle: reference.actionsTitle,
        benefitsLabel: reference.benefitsLabel,
        footer: {
          tagline: reference.footer.message,
          wordmarkKey: "reqro-wordmark",
          showThemeToggle: true,
          switchToDark: reference.footer.switchToDark,
          switchToLight: reference.footer.switchToLight,
          links: [],
        },
      },
      actions: reference.actions.map((a) => ({
        ...a,
        target:
          a.actionType === "phone" ? a.target.replace(/\D/g, "") : a.target,
      })),
      benefits: structuredClone(reference.benefits),
    },
  };
}

// Explicit approved Reqro fixture only, never an automatic tenant default.
// This snapshot also exercises the backend projection in the local preview.
export function publishedSnapshotFixture() {
  const { configuration } = publishedExperienceFixture();
  return {
    schemaVersion: 1,
    presentation: configuration.presentation,
    actions: configuration.actions.map((a) => ({
      ...a,
      ctaLabel:
        a.actionType === "phone"
          ? a.id === "water"
            ? "{phone}"
            : "Call"
          : a.ctaLabel,
      target: a.actionType === "phone" ? null : a.target,
      contactId: a.actionType === "phone" ? a.id : null,
    })),
    benefits: configuration.benefits,
    contacts: reference.actions
      .filter((a) => a.actionType === "phone")
      .map((a) => ({
        id: a.id,
        kind: "phone",
        classification: "emergency",
        displayValue: a.target,
        phoneTarget: a.target.replace(/\D/g, ""),
        guidance: "",
      })),
  };
}
