// Trusted packaged defaults, not identity or permissions. F059.2 may replace this
// input through HomePresentationProvider without changing the rendering components.
export const homePresentation = Object.freeze({
  brandName: "Reqro",
  logo: "/branding/reqro/branding/reqro-mark-transparent.png",
  wordmark: "/branding/reqro/branding/reqro-wordmark-white-transparent.png",
  wordmarkSize: { width: 584, height: 250 },
  favicon: "/branding/reqro/reqro-favicon-32.png",
  title: "Reqro | A more connected community",
  description: "Connect with community services, report a concern or find emergency help.",
  theme: "reqro",
  navigation: {
    label: "Primary navigation", homeSuffix: "home", menu: "Menu",
    openMenu: "Open navigation menu", closeMenu: "Close navigation menu",
    links: [
      { id: "home", label: "Home", actionType: "internal", target: "/" },
      { id: "report", label: "Report a Concern", actionType: "internal", target: "/report" },
    ],
    staff: "Service Requests", staffTarget: "/staff/requests",
    signIn: "Staff sign in", signOut: "Sign out",
  },
  tagline: { words: ["People", "Requests", "Progress"], separator: "●", separatorTone: "accent" },
  hero: {
    image: "/branding/reqro/hero/reqro-home-background.png",
    width: 1920, height: 521, decorative: true, alt: "",
    headline: [
      { text: "A more connected community starts " },
      { text: "with you.", highlighted: true },
    ],
  },
  actionsTitle: "Resident Actions",
  actions: [
    { id: "report", enabled: true, order: 10, iconKey: "report", title: "Report a Concern", description: "Quickly submit a new community issue to let us know.", ctaLabel: "Report Issue", actionType: "internal", target: "/report", tone: "primary" },
    { id: "emergency", enabled: true, order: 20, iconKey: "emergency", title: "Police or Fire Emergency", description: "If this is a Police or Fire Emergency, call immediately.", ctaLabel: "Call 911", actionType: "phone", target: "911", tone: "danger" },
    { id: "water", enabled: true, order: 30, iconKey: "water", title: "Water/Sewer Emergency", description: "If this is a Water/Sewer Emergency, call the City immediately.", ctaLabel: "240-314-8567", actionType: "phone", target: "240-314-8567", tone: "warning" },
  ],
  benefitsLabel: "The value of connection",
  benefits: [
    { id: "residents", enabled: true, order: 10, iconKey: "residents", title: "Engaged Residents", description: "Easier ways to be heard" },
    { id: "services", enabled: true, order: 20, iconKey: "responsive", title: "Responsive Services", description: "The right request to the right team" },
    { id: "operations", enabled: true, order: 30, iconKey: "operations", title: "Efficient Operations", description: "Less friction, greater impact" },
    { id: "communities", enabled: true, order: 40, iconKey: "community", title: "Stronger Communities", description: "Together we make progress" },
  ],
  footer: {
    wordmark: "/branding/reqro/branding/reqro-wordmark-white-transparent.png",
    message: "Built for Today. Ready for a Stronger Tomorrow.",
    showThemeToggle: true, switchToDark: "Switch to dark mode", switchToLight: "Switch to light mode",
    links: [],
  },
});
